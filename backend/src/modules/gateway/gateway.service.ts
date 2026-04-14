import { Injectable, BadRequestException, HttpException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import axios, { AxiosError } from "axios";
import { RequestLog } from "./request-log.entity";
import { Channel } from "../channel/channel.entity";
import {
  ChannelPublicBetaService,
  ChannelPublicBetaConfig,
} from "../channel/channel-public-beta.service";
import { User } from "../user/user.entity";
import { AuthService } from "../auth/auth.service";
import { ConfigService } from "@nestjs/config";
import { RedisCacheService } from "../../common/redis-cache.service";
import {
  FALLBACK_INPUT_PRICE_PER_MILLION,
  FALLBACK_OUTPUT_PRICE_PER_MILLION,
  getModelPreset,
} from "./model-catalog";

interface ChatCompletionPayload {
  model?: string;
  messages: Array<{
    role: string;
    content: string;
    tool_call_id?: string;
    tool_calls?: any[];
  }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
  extraBody?: Record<string, any>;
}

type GatewayProtocol =
  | "openai"
  | "openai-responses"
  | "anthropic"
  | "gemini";

interface GatewayUpstreamRequest {
  method: string;
  path: string;
  body: Record<string, any>;
  protocol?: GatewayProtocol;
}

type GatewayRouteMode = "standard" | "prefer-public-beta" | "public-beta";
type ModelCatalogAudience = "public" | "chat" | "public-beta";

@Injectable()
export class GatewayService {
  private readonly CACHE_TTL = 300;
  private readonly CHANNEL_CACHE_PREFIX = "channel:";
  private readonly MODEL_CACHE_PREFIX = "model:";

  constructor(
    @InjectRepository(RequestLog)
    private requestLogRepository: Repository<RequestLog>,
    @InjectRepository(Channel)
    private channelRepository: Repository<Channel>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private authService: AuthService,
    private configService: ConfigService,
    private channelPublicBetaService: ChannelPublicBetaService,
    private cacheService: RedisCacheService,
  ) {}

  async proxyRequest(
    apiKey: string,
    requestData: any,
    requestIp: string,
    routeMode: GatewayRouteMode = "standard",
  ) {
    // Validate API Key
    const keyInfo = await this.authService.validateApiKey(apiKey);
    if (!keyInfo) {
      throw new BadRequestException("Invalid or inactive API Key");
    }

    // Get model from request
    const model =
      requestData.body?.model || requestData.model || "gpt-3.5-turbo";

    // Find available channel
    const channel = await this.findAvailableChannel(model, routeMode);
    if (!channel) {
      throw new BadRequestException("No available channel for this model");
    }

    const publicBetaState = await this.getChannelPublicBetaState(channel);
    const isFreeRequest = publicBetaState.active && routeMode !== "standard";

    // Check user balance only for billable requests
    if (!isFreeRequest && keyInfo.userBalance <= 0) {
      throw new BadRequestException("Insufficient balance");
    }

    // Record start time for latency calculation
    const startTime = Date.now();

    // Create log entry
    const log = this.requestLogRepository.create({
      apiKeyId: keyInfo.apiKeyId,
      userId: keyInfo.userId,
      channelId: channel.id,
      model,
      requestData,
      requestIp,
      statusCode: 200,
    });

    try {
      // Forward request to upstream channel
      const response = await this.forwardRequest(channel, requestData);

      // Calculate cost based on token usage
      const cost = isFreeRequest
        ? 0
        : this.calculateCost(model, response.data?.usage, channel);

      // Check if user has enough balance
      if (!isFreeRequest && keyInfo.userBalance < cost) {
        throw new BadRequestException("Insufficient balance");
      }

      // Update log with response data
      log.responseData = response.data;
      log.promptTokens = response.data.usage?.prompt_tokens || 0;
      log.completionTokens = response.data.usage?.completion_tokens || 0;
      log.totalTokens = response.data.usage?.total_tokens || 0;
      log.cost = cost;
      log.latencyMs = Date.now() - startTime;

      // Deduct balance
      if (!isFreeRequest) {
        await this.deductBalance(keyInfo.userId, cost);
      }

      // Increment API key usage
      await this.authService.incrementUsage(keyInfo.apiKeyId);

      await this.requestLogRepository.save(log);

      return response.data;
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      log.latencyMs = latencyMs;
      log.statusCode = error.response?.status || 500;
      log.errorMessage = error.message;

      if (error.response?.data) {
        log.responseData = error.response.data;
      }

      await this.requestLogRepository.save(log);

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException(
        error.response?.data || { error: "Request failed" },
      );
    }
  }

  async findAvailableChannel(
    model: string,
    routeMode: GatewayRouteMode = "standard",
  ): Promise<Channel | null> {
    const cacheKey = `${this.CHANNEL_CACHE_PREFIX}${model}:${routeMode}`;

    const cached = await this.cacheService.get<Channel>(cacheKey);
    if (cached) return cached;

    const channels = await this.channelRepository.find({
      where: { isActive: true },
      relations: ["modelConfigs"],
      order: { priority: "DESC" },
    });

    const publicBetaConfigs =
      await this.channelPublicBetaService.getAllConfigs();
    const allCandidates = channels.filter((channel) =>
      this.channelSupportsModel(channel, model),
    );
    const publicBetaCandidates = allCandidates.filter((channel) =>
      this.channelPublicBetaService.isPublicBetaActive(
        publicBetaConfigs[channel.id],
      ),
    );
    const standardCandidates = allCandidates.filter(
      (channel) =>
        !this.channelPublicBetaService.isPublicBetaActive(
          publicBetaConfigs[channel.id],
        ),
    );

    let result: Channel | null;
    if (routeMode === "public-beta") {
      result = this.pickPreferredChannel(publicBetaCandidates);
    } else if (
      routeMode === "prefer-public-beta" &&
      publicBetaCandidates.length
    ) {
      result = this.pickPreferredChannel(publicBetaCandidates);
    } else {
      result = this.pickPreferredChannel(standardCandidates);
    }

    if (result) {
      await this.cacheService.set(cacheKey, result, { ttl: this.CACHE_TTL });
    }

    return result;
  }

  async isModelPublicBetaFree(model: string) {
    return Boolean(await this.findAvailableChannel(model, "public-beta"));
  }

  async getPublicBetaModelIds() {
    const catalog = await this.getModelCatalog("chat");
    return catalog
      .filter((item) => item.isPublicBetaFree)
      .map((item) => item.id);
  }

  async getAvailableModels(audience: ModelCatalogAudience = "public"): Promise<
    Array<{
      id: string;
      name: string;
      provider: string;
      isPublicBetaFree?: boolean;
      betaFreeUntil?: string | null;
    }>
  > {
    const catalog = await this.getModelCatalog(audience);

    if (!catalog.length) {
      return [
        { id: "gpt-4o-mini", name: "GPT-4o mini", provider: "default" },
        { id: "gpt-4.1", name: "GPT-4.1", provider: "default" },
      ];
    }

    return catalog.filter(item => !item.hidden).map((item) => ({
      id: item.id,
      name: item.isPublicBetaFree
        ? `${item.label} (站内内测至 ${item.betaFreeUntil})`
        : item.label,
      provider: item.family,
      isPublicBetaFree: item.isPublicBetaFree,
      betaFreeUntil: item.betaFreeUntil,
    }));
  }

  async getModelCatalog(audience: ModelCatalogAudience = "public") {
    const cacheKey = `${this.MODEL_CACHE_PREFIX}${audience}`;

    const cached = await this.cacheService.get<any[]>(cacheKey);
    if (cached) return cached;

    const channels = await this.channelRepository.find({
      where: { isActive: true },
      relations: ["modelConfigs"],
      order: { priority: "DESC" },
    });
    const publicBetaConfigs =
      await this.channelPublicBetaService.getAllConfigs();

    const catalog = new Map<
      string,
      {
        id: string;
        label: string;
        summary: string;
        family: string;
        tags: string[];
        protocol: string;
        inputPricePerMillion: number;
        outputPricePerMillion: number;
        cacheWritePricePerMillion: number;
        cacheReadPricePerMillion: number;
        routeType: "chat";
        availableChannels: string[];
        status: "active";
        isPublicBetaFree: boolean;
        betaFreeUntil: string | null;
        betaLabel: string | null;
        betaAccessPath: string | null;
        hidden?: boolean;
      }
    >();

    for (const channel of channels) {
      const publicBetaState = this.toPublicBetaState(
        publicBetaConfigs[channel.id],
      );

      for (const modelId of channel.models) {
        if (!modelId || modelId === "*") {
          continue;
        }

        if (!this.isChannelModelEnabled(channel, modelId)) {
          continue;
        }

        if (audience === "public-beta" && !publicBetaState.active) {
          continue;
        }

        if (audience === "public" && publicBetaState.active) {
          continue;
        }

        const preset = getModelPreset(modelId);
        
        if (preset.hidden) {
          continue;
        }

        const pricing =
          audience === "public-beta" && publicBetaState.active
            ? {
                inputPricePerMillion: 0,
                outputPricePerMillion: 0,
                cacheWritePricePerMillion: 0,
                cacheReadPricePerMillion: 0,
                protocol: this.getModelProtocol(channel, modelId),
              }
            : this.getModelPricing(channel, modelId);
        const existing = catalog.get(modelId);

        if (existing) {
          existing.availableChannels.push(channel.name);
          existing.inputPricePerMillion = Math.min(
            existing.inputPricePerMillion,
            pricing.inputPricePerMillion,
          );
          existing.outputPricePerMillion = Math.min(
            existing.outputPricePerMillion,
            pricing.outputPricePerMillion,
          );
          existing.cacheWritePricePerMillion = Math.min(
            existing.cacheWritePricePerMillion,
            pricing.cacheWritePricePerMillion,
          );
          existing.cacheReadPricePerMillion = Math.min(
            existing.cacheReadPricePerMillion,
            pricing.cacheReadPricePerMillion,
          );
          existing.isPublicBetaFree =
            existing.isPublicBetaFree || publicBetaState.active;
          existing.betaFreeUntil =
            existing.betaFreeUntil || publicBetaState.betaFreeUntil;
          existing.betaLabel = existing.betaLabel || publicBetaState.betaLabel;
          existing.betaAccessPath = existing.betaAccessPath || null;
          continue;
        }

        catalog.set(modelId, {
          id: modelId,
          label: preset.label,
          summary: preset.summary,
          family:
            preset.family === "Custom" ? channel.channelType : preset.family,
          tags: preset.tags,
          protocol: pricing.protocol,
          inputPricePerMillion: pricing.inputPricePerMillion,
          outputPricePerMillion: pricing.outputPricePerMillion,
          cacheWritePricePerMillion: pricing.cacheWritePricePerMillion,
          cacheReadPricePerMillion: pricing.cacheReadPricePerMillion,
          routeType: "chat",
          availableChannels: [channel.name],
          status: "active",
          isPublicBetaFree: audience === "chat" && publicBetaState.active,
          betaFreeUntil:
            audience === "chat" && publicBetaState.active
              ? publicBetaState.betaFreeUntil
              : null,
          betaLabel:
            audience === "chat" && publicBetaState.active
              ? publicBetaState.betaLabel
              : null,
          betaAccessPath: null,
          hidden: preset.hidden || false,
        });
      }
    }

    const result = Array.from(catalog.values()).sort((a, b) =>
      a.label.localeCompare(b.label),
    );

    await this.cacheService.set(cacheKey, result, { ttl: this.CACHE_TTL });

    return result;
  }

  async getClientModels(apiKey: string) {
    const keyInfo = await this.authService.validateApiKey(apiKey);
    if (!keyInfo) {
      throw new BadRequestException("Invalid or inactive API Key");
    }

    return this.getModelCatalog("chat");
  }

  async requestChatCompletion(
    payload: ChatCompletionPayload,
    routeMode: GatewayRouteMode = "standard",
  ) {
    const model = payload.model || "gpt-4o-mini";
    const channel = await this.findAvailableChannel(model, routeMode);

    if (!channel) {
      throw new BadRequestException("No available channel for this model");
    }

    const upstreamRequest = this.buildChatCompletionRequest(
      channel,
      payload,
      model,
    );

    let response;
    try {
      response = await this.forwardRequest(channel, upstreamRequest);
    } catch (error: any) {
      const canRetryWithoutTools =
        (upstreamRequest.protocol === "anthropic" ||
          upstreamRequest.protocol === "gemini") &&
        Array.isArray(payload.extraBody?.tools) &&
        (error?.response?.status || 0) >= 500;

      if (canRetryWithoutTools) {
        const retryPayload: ChatCompletionPayload = {
          ...payload,
          extraBody: {
            ...(payload.extraBody || {}),
          },
        };
        if (retryPayload.extraBody) {
          delete retryPayload.extraBody.tools;
          delete retryPayload.extraBody.tool_choice;
        }

        const retryRequest = this.buildChatCompletionRequest(
          channel,
          retryPayload,
          model,
        );
        try {
          response = await this.forwardRequest(channel, retryRequest);
        } catch (retryError: any) {
          error = retryError;
        }
      }

      if (error instanceof HttpException) {
        throw error;
      }

      const statusCode = error?.response?.status;
      const publicBetaState = await this.getChannelPublicBetaState(channel);
      const scopeLabel = publicBetaState.active ? "\u5f53\u524d\u5185\u6d4b\u6a21\u578b\u670d\u52a1" : "\u5f53\u524d\u6a21\u578b\u670d\u52a1";
      const message = statusCode
        ? `${scopeLabel} \u8fd4\u56de\u5f02\u5e38\uff08HTTP ${statusCode}\uff09\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u6216\u5207\u6362\u6a21\u578b`
        : `${scopeLabel} \u5f53\u524d\u4e0d\u53ef\u7528\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u6216\u5207\u6362\u6a21\u578b`;

      throw new BadRequestException(message);
    }

    const normalizedData = this.normalizeUpstreamResponse(
      upstreamRequest.protocol,
      response.data,
    );

    const publicBetaState = await this.getChannelPublicBetaState(channel);
    const cost =
      publicBetaState.active && routeMode !== "standard"
        ? 0
        : this.calculateCost(model, normalizedData?.usage, channel);

    return {
      channel,
      data: normalizedData,
      cost,
    };
  }

  private async forwardRequest(
    channel: Channel,
    requestData: GatewayUpstreamRequest,
  ) {
    const normalizedBaseUrl = channel.baseUrl.replace(/\/$/, "");
    const normalizedPath = this.normalizeChannelPath(
      normalizedBaseUrl,
      requestData.path || "/v1/chat/completions",
    );
    const url = `${normalizedBaseUrl}${normalizedPath}`;

    const headers: any = {
      "Content-Type": "application/json",
    };

    if (
      channel.apiKey &&
      (!requestData.protocol ||
        requestData.protocol === "openai" ||
        requestData.protocol === "openai-responses")
    ) {
      headers["Authorization"] = `Bearer ${channel.apiKey}`;
    }

    if (requestData.protocol === "anthropic" && channel.apiKey) {
      headers["x-api-key"] = channel.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }

    if (requestData.protocol === "gemini" && channel.apiKey) {
      headers["x-goog-api-key"] = channel.apiKey;
    }

    // Add channel-specific headers
    if (channel.channelType === "azure") {
      headers["api-key"] = channel.apiKey;
    }

    try {
      const response = await axios({
        method: requestData.method || "POST",
        url,
        data: requestData.body,
        headers,
        timeout: 120000,
      });

      // Deduct channel balance (mock implementation)
      const estimatedCost = this.estimateCost(requestData.body, channel);
      await this.channelRepository.decrement(
        { id: channel.id },
        "balance",
        estimatedCost,
      );

      return response;
    } catch (error) {
      if (error instanceof AxiosError && error.response) {
        throw error;
      }
      throw new BadRequestException("Failed to connect to upstream channel");
    }
  }

  private normalizeChannelPath(baseUrl: string, path: string) {
    const nextPath =
      path.startsWith("/") || path.startsWith(":") ? path : `/${path}`;

    if (baseUrl.endsWith("/v1") && nextPath.startsWith("/v1/")) {
      return nextPath.replace(/^\/v1/, "");
    }

    if (
      baseUrl.endsWith("/chat/completions") &&
      nextPath === "/v1/chat/completions"
    ) {
      return "";
    }

    if (baseUrl.endsWith("/messages") && nextPath === "/v1/messages") {
      return "";
    }

    if (baseUrl.endsWith("/responses") && nextPath === "/v1/responses") {
      return "";
    }

    if (/\/v1\/models\/[^/]+$/i.test(baseUrl) && /:generateContent$/i.test(nextPath)) {
      return nextPath;
    }

    if (
      /:generateContent$/i.test(baseUrl) &&
      /:generateContent$/i.test(nextPath)
    ) {
      return "";
    }

    return nextPath;
  }

  private buildChatCompletionRequest(
    channel: Channel,
    payload: ChatCompletionPayload,
    model: string,
  ): GatewayUpstreamRequest {
    const protocol = this.getModelProtocol(channel, model);

    if (protocol === "anthropic") {
      return {
        method: "POST",
        path: "/v1/messages",
        protocol: "anthropic",
        body: this.buildAnthropicRequestBody(payload, model),
      };
    }

    if (protocol === "gemini") {
      return {
        method: "POST",
        path: /\/v1\/models\/[^/]+$/i.test(channel.baseUrl)
          ? ":generateContent"
          : `/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        protocol: "gemini",
        body: this.buildGeminiRequestBody(payload, model),
      };
    }

    if (protocol === "openai-responses") {
      return {
        method: "POST",
        path: "/v1/responses",
        protocol: "openai-responses",
        body: this.buildOpenAIResponsesRequestBody(payload, model),
      };
    }

    return {
      method: "POST",
      path: "/v1/chat/completions",
      protocol: "openai",
      body: {
        model,
        messages: payload.messages,
        stream: payload.stream ?? false,
        ...(payload.max_tokens ? { max_tokens: payload.max_tokens } : {}),
        ...(payload.temperature !== undefined
          ? { temperature: payload.temperature }
          : {}),
        ...(payload.extraBody || {}),
      },
    };
  }

  private getModelProtocol(channel: Channel, model: string): GatewayProtocol {
    const modelConfig = channel.modelConfigs?.find(
      (item) => item.modelName === model && item.isActive,
    );
    const configuredProtocol = (modelConfig?.protocol || "auto").toLowerCase();

    if (
      configuredProtocol === "openai" ||
      configuredProtocol === "openai-responses" ||
      configuredProtocol === "anthropic" ||
      configuredProtocol === "gemini"
    ) {
      return configuredProtocol as GatewayProtocol;
    }

    if (
      channel.channelType === "anthropic" ||
      (channel.baseUrl.includes("opencode.ai/zen") && model.startsWith("claude-"))
    ) {
      return "anthropic";
    }

    if (
      channel.baseUrl.includes("/responses") ||
      (channel.baseUrl.includes("opencode.ai/zen") && model.startsWith("gpt-"))
    ) {
      return "openai-responses";
    }

    if (
      channel.baseUrl.includes("generativelanguage.googleapis.com") ||
      (channel.channelType === "custom" && model.startsWith("gemini")) ||
      channel.baseUrl.includes("/v1/models/")
    ) {
      return "gemini";
    }

    return "openai";
  }

  private buildAnthropicRequestBody(
    payload: ChatCompletionPayload,
    model: string,
  ) {
    const system = payload.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .filter(Boolean)
      .join("\n\n");

    const extraBody = payload.extraBody || {};
    const anthropicTools = Array.isArray(extraBody.tools)
      ? extraBody.tools
          .map((tool: any) => {
            if (tool?.type !== "function" || !tool.function?.name) {
              return null;
            }

            return {
              name: tool.function.name,
              description: tool.function.description,
              input_schema: tool.function.parameters || {
                type: "object",
                properties: {},
              },
            };
          })
          .filter(Boolean)
      : undefined;

    const body: Record<string, any> = {
      model,
      max_tokens: payload.max_tokens || 1024,
      messages: this.toAnthropicMessages(payload.messages),
      stream: payload.stream ?? false,
      ...(payload.temperature !== undefined
        ? { temperature: payload.temperature }
        : {}),
    };

    if (system) {
      body.system = system;
    }

    if (anthropicTools?.length) {
      body.tools = anthropicTools;
    }

    if (extraBody.tool_choice === "auto") {
      body.tool_choice = { type: "auto" };
    }

    return body;
  }

  private buildOpenAIResponsesRequestBody(
    payload: ChatCompletionPayload,
    model: string,
  ) {
    const instructions = payload.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .filter(Boolean)
      .join("\n\n");
    const extraBody = payload.extraBody || {};
    const normalizedTools = Array.isArray(extraBody.tools)
      ? extraBody.tools
          .map((tool: any) => {
            if (!tool) {
              return null;
            }

            if (tool.type === "function" && tool.function?.name) {
              return {
                type: "function",
                name: tool.function.name,
                description: tool.function.description,
                parameters: tool.function.parameters || {
                  type: "object",
                  properties: {},
                },
              };
            }

            if (tool.type === "function" && tool.name) {
              return {
                type: "function",
                name: tool.name,
                description: tool.description,
                parameters: tool.parameters || {
                  type: "object",
                  properties: {},
                },
              };
            }

            return tool;
          })
          .filter(Boolean)
      : undefined;

    return {
      model,
      input: this.toOpenAIResponsesInput(payload.messages),
      ...(instructions ? { instructions } : {}),
      ...(payload.max_tokens ? { max_output_tokens: payload.max_tokens } : {}),
      ...(payload.temperature !== undefined
        ? { temperature: payload.temperature }
        : {}),
      ...(payload.stream !== undefined ? { stream: payload.stream } : {}),
      ...extraBody,
      ...(normalizedTools ? { tools: normalizedTools } : {}),
    };
  }

  private toOpenAIResponsesInput(messages: ChatCompletionPayload["messages"]) {
    return messages
      .filter((message) => message.role !== "system")
      .map((message) => {
        if (message.role === "tool") {
          return {
            type: "function_call_output",
            call_id: message.tool_call_id,
            output: message.content || "",
          };
        }

        if (
          message.role === "assistant" &&
          Array.isArray(message.tool_calls) &&
          message.tool_calls.length
        ) {
          return [
            ...(message.content
              ? [
                  {
                    role: "assistant",
                    content: [{ type: "output_text", text: message.content }],
                  },
                ]
              : []),
            ...message.tool_calls.map((toolCall: any) => ({
              type: "function_call",
              call_id: toolCall.id,
              name: toolCall.function?.name,
              arguments: toolCall.function?.arguments || "{}",
            })),
          ];
        }

        return {
          role: message.role === "assistant" ? "assistant" : "user",
          content: [
            {
              type: message.role === "assistant" ? "output_text" : "input_text",
              text: message.content || "",
            },
          ],
        };
      })
      .flat();
  }

  private toAnthropicMessages(messages: ChatCompletionPayload["messages"]) {
    return messages
      .filter((message) => message.role !== "system")
      .map((message) => {
        if (message.role === "tool") {
          return {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: message.tool_call_id,
                content: message.content || "",
              },
            ],
          };
        }

        if (
          message.role === "assistant" &&
          Array.isArray(message.tool_calls) &&
          message.tool_calls.length
        ) {
          return {
            role: "assistant",
            content: [
              ...(message.content
                ? [{ type: "text", text: message.content }]
                : []),
              ...message.tool_calls.map((toolCall: any) => ({
                type: "tool_use",
                id: toolCall.id,
                name: toolCall.function?.name,
                input: this.safeParseJson(toolCall.function?.arguments),
              })),
            ],
          };
        }

        return {
          role: message.role,
          content: message.content
            ? [{ type: "text", text: message.content }]
            : [],
        };
      });
  }

  private buildGeminiRequestBody(
    payload: ChatCompletionPayload,
    model: string,
  ) {
    const extraBody = payload.extraBody || {};
    const systemInstruction = payload.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .filter(Boolean)
      .join("\n\n");
    const tools = Array.isArray(extraBody.tools)
      ? [
          {
            functionDeclarations: extraBody.tools
              .map((tool: any) => {
                if (tool?.type !== "function" || !tool.function?.name) {
                  return null;
                }

                return {
                  name: tool.function.name,
                  description: tool.function.description,
                  parameters: tool.function.parameters || {
                    type: "object",
                    properties: {},
                  },
                };
              })
              .filter(Boolean),
          },
        ].filter((item) => item.functionDeclarations.length)
      : undefined;

    return {
      ...(systemInstruction
        ? {
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
          }
        : {}),
      contents: this.toGeminiContents(payload.messages),
      generationConfig: {
        ...(payload.temperature !== undefined
          ? { temperature: payload.temperature }
          : {}),
        ...(payload.max_tokens ? { maxOutputTokens: payload.max_tokens } : {}),
      },
      ...(tools?.length ? { tools } : {}),
      ...(extraBody.tool_choice === "auto"
        ? { toolConfig: { functionCallingConfig: { mode: "AUTO" } } }
        : {}),
    };
  }

  private toGeminiContents(messages: ChatCompletionPayload["messages"]) {
    return messages
      .filter((message) => message.role !== "system" && message.role !== "tool")
      .map((message) => {
        const parts: Array<Record<string, any>> = [];

        if (
          message.role === "assistant" &&
          Array.isArray(message.tool_calls) &&
          message.tool_calls.length
        ) {
          if (message.content) {
            parts.push({ text: message.content });
          }
          for (const toolCall of message.tool_calls) {
            parts.push({
              functionCall: {
                name: toolCall.function?.name,
                args: this.safeParseJson(toolCall.function?.arguments),
              },
            });
          }
        } else if (message.content) {
          parts.push({ text: message.content });
        }

        return {
          role: message.role === "assistant" ? "model" : "user",
          parts,
        };
      });
  }

  private normalizeUpstreamResponse(
    protocol: GatewayUpstreamRequest["protocol"],
    data: any,
  ) {
    if (protocol === "gemini") {
      return this.normalizeGeminiResponse(data);
    }

    if (protocol === "openai-responses") {
      return this.normalizeOpenAIResponses(data);
    }

    if (protocol !== "anthropic") {
      return data;
    }

    const contentBlocks = Array.isArray(data?.content) ? data.content : [];
    const textContent = contentBlocks
      .filter((block: any) => block?.type === "text")
      .map((block: any) => block?.text || "")
      .join("\n\n")
      .trim();
    const toolCalls = contentBlocks
      .filter((block: any) => block?.type === "tool_use")
      .map((block: any) => ({
        id: block.id,
        type: "function",
        function: {
          name: block.name,
          arguments: JSON.stringify(block.input || {}),
        },
      }));
    const promptTokens = Number(data?.usage?.input_tokens || 0);
    const completionTokens = Number(data?.usage?.output_tokens || 0);
    const cacheWriteTokens = Number(
      data?.usage?.cache_creation_input_tokens || 0,
    );
    const cacheReadTokens = Number(data?.usage?.cache_read_input_tokens || 0);

    return {
      id: data?.id,
      model: data?.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: textContent,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason:
            data?.stop_reason === "tool_use"
              ? "tool_calls"
              : data?.stop_reason || "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cache_write_tokens: cacheWriteTokens,
        cache_read_tokens: cacheReadTokens,
        total_tokens: promptTokens + completionTokens,
      },
      raw: data,
    };
  }

  private normalizeGeminiResponse(data: any) {
    const candidate = Array.isArray(data?.candidates) ? data.candidates[0] : null;
    const parts = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
      : [];
    const textContent = parts
      .filter((part: any) => typeof part?.text === "string")
      .map((part: any) => part.text)
      .join("\n\n")
      .trim();
    const toolCalls = parts
      .filter((part: any) => part?.functionCall?.name)
      .map((part: any, index: number) => ({
        id: `gemini-tool-${index + 1}`,
        type: "function",
        function: {
          name: part.functionCall.name,
          arguments: JSON.stringify(part.functionCall.args || {}),
        },
      }));
    const promptTokens = Number(data?.usageMetadata?.promptTokenCount || 0);
    const completionTokens = Number(
      data?.usageMetadata?.candidatesTokenCount || 0,
    );
    const cacheReadTokens = Number(
      data?.usageMetadata?.cachedContentTokenCount || 0,
    );

    return {
      id: candidate?.index !== undefined ? `gemini-${candidate.index}` : undefined,
      model: data?.modelVersion,
      choices: [
        {
          message: {
            role: "assistant",
            content: textContent,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: candidate?.finishReason || "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cache_write_tokens: 0,
        cache_read_tokens: cacheReadTokens,
        total_tokens: promptTokens + completionTokens,
      },
      raw: data,
    };
  }

  private normalizeOpenAIResponses(data: any) {
    const outputItems = Array.isArray(data?.output) ? data.output : [];
    const assistantMessages = outputItems.filter(
      (item: any) => item?.type === "message",
    );
    const textContent = assistantMessages
      .flatMap((item: any) => (Array.isArray(item?.content) ? item.content : []))
      .filter((part: any) => typeof part?.text === "string")
      .map((part: any) => part.text)
      .join("\n\n")
      .trim();
    const toolCalls = outputItems
      .filter((item: any) => item?.type === "function_call" && item?.name)
      .map((item: any) => ({
        id: item.call_id || item.id || `resp-tool-${Math.random().toString(36).slice(2, 8)}`,
        type: "function",
        function: {
          name: item.name,
          arguments:
            typeof item.arguments === "string"
              ? item.arguments
              : JSON.stringify(item.arguments || {}),
        },
      }));
    const promptTokens = Number(
      data?.usage?.input_tokens ?? data?.usage?.prompt_tokens ?? 0,
    );
    const completionTokens = Number(
      data?.usage?.output_tokens ?? data?.usage?.completion_tokens ?? 0,
    );
    const cacheReadTokens = Number(data?.usage?.input_cached_tokens ?? 0);

    return {
      id: data?.id,
      model: data?.model,
      choices: [
        {
          message: {
            role: "assistant",
            content: data?.output_text || textContent,
            ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
          },
          finish_reason: data?.status || "stop",
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cache_write_tokens: 0,
        cache_read_tokens: cacheReadTokens,
        total_tokens: promptTokens + completionTokens,
      },
      raw: data,
    };
  }

  private safeParseJson(value: string | undefined) {
    if (!value) {
      return {};
    }

    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }

  private pickPreferredChannel(channels: Channel[]) {
    let fallbackChannel: Channel | null = null;

    for (const channel of channels) {
      if (Number(channel.balance) > 0) {
        return channel;
      }

      if (!fallbackChannel) {
        fallbackChannel = channel;
      }
    }

    return fallbackChannel;
  }

  private channelSupportsModel(channel: Channel, model: string) {
    if (channel.models.includes("*")) {
      return true;
    }

    if (channel.models.includes(model)) {
      return this.isChannelModelEnabled(channel, model);
    }

    return Boolean(
      channel.modelConfigs?.some(
        (item) => item.isActive && item.modelName === model,
      ),
    );
  }

  private isChannelModelEnabled(channel: Channel, model: string) {
    const modelConfig = channel.modelConfigs?.find(
      (item) => item.modelName === model,
    );

    if (modelConfig) {
      return Boolean(modelConfig.isActive);
    }

    return true;
  }

  private toPublicBetaState(config?: Partial<ChannelPublicBetaConfig> | null) {
    const active = this.channelPublicBetaService.isPublicBetaActive(config);

    return {
      active,
      betaFreeUntil: active ? config?.betaFreeUntil || null : null,
      betaLabel: active ? config?.betaLabel || null : null,
    };
  }

  private async getChannelPublicBetaState(channel: Channel) {
    return this.toPublicBetaState(
      await this.channelPublicBetaService.getChannelConfig(channel.id),
    );
  }

  calculateCost(
    model: string,
    usage:
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          cache_write_tokens?: number;
          cache_read_tokens?: number;
        }
      | undefined,
    channel: Channel,
  ): number {
    if (!usage) return 0;

    const pricing = this.getModelPricing(channel, model);
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const cacheWriteTokens = usage.cache_write_tokens || 0;
    const cacheReadTokens = usage.cache_read_tokens || 0;

    const inputCost = (promptTokens / 1_000_000) * pricing.inputPricePerMillion;
    const outputCost =
      (completionTokens / 1_000_000) * pricing.outputPricePerMillion;
    const cacheWriteCost =
      (cacheWriteTokens / 1_000_000) * pricing.cacheWritePricePerMillion;
    const cacheReadCost =
      (cacheReadTokens / 1_000_000) * pricing.cacheReadPricePerMillion;

    return Number(
      (
        (inputCost + outputCost + cacheWriteCost + cacheReadCost) *
        Number(channel.priceRate || 1)
      ).toFixed(6),
    );
  }

  private estimateCost(requestData: any, channel: Channel): number {
    // Rough estimation based on input tokens
    const messages = requestData?.messages || [];
    const model = requestData?.model || "gpt-4o-mini";
    let estimatedTokens = 0;

    for (const msg of messages) {
      estimatedTokens += (msg.content?.length || 0) / 4;
    }

    const pricing = this.getModelPricing(channel, model);
    return Number(
      (
        (estimatedTokens / 1_000_000) *
        pricing.inputPricePerMillion *
        Number(channel.priceRate || 1)
      ).toFixed(6),
    );
  }

  private getModelPricing(channel: Channel, model: string) {
    const modelConfig = channel.modelConfigs?.find(
      (item) => item.modelName === model,
    );

    return {
      protocol: this.getModelProtocol(channel, model),
      inputPricePerMillion: Number(
        modelConfig?.inputPrice || FALLBACK_INPUT_PRICE_PER_MILLION,
      ),
      outputPricePerMillion: Number(
        modelConfig?.outputPrice || FALLBACK_OUTPUT_PRICE_PER_MILLION,
      ),
      cacheWritePricePerMillion: Number(modelConfig?.cacheWritePrice || 0),
      cacheReadPricePerMillion: Number(modelConfig?.cacheReadPrice || 0),
    };
  }

  async deductBalance(userId: string, amount: number) {
    await this.userRepository
      .createQueryBuilder()
      .update(User)
      .set({ balance: () => `balance - ${amount}` })
      .where("id = :id", { id: userId })
      .execute();
  }

  async getRequestLogs(userId: string, page: number = 1, limit: number = 20) {
    const [logs, total] = await this.requestLogRepository.findAndCount({
      where: { userId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUsageStats(userId: string, days: number = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const stats = await this.requestLogRepository
      .createQueryBuilder("log")
      .select("DATE(log.created_at)", "date")
      .addSelect("COUNT(*)", "count")
      .addSelect("SUM(log.total_tokens)", "tokens")
      .addSelect("SUM(log.cost)", "cost")
      .where("log.user_id = :userId", { userId })
      .andWhere("log.created_at >= :startDate", { startDate })
      .groupBy("DATE(log.created_at)")
      .orderBy("date", "ASC")
      .getRawMany();

    return stats;
  }
}
