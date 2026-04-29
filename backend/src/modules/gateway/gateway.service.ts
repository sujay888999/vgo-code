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
import { ModelAdapterFactory } from "./adapters/model-adapter.factory";
import {
  ModelRequest,
  ModelResponse,
  GatewayProtocol,
  GatewayUpstreamRequest
} from "./adapters/gateway-protocol";
import { VGOError, UpstreamError, BalanceError, AuthError } from "./adapters/vgo-errors";
import { v4 as uuidv4 } from "uuid";

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
  extraBody?: Record<<stringstring, any>;
}

type GatewayRouteMode = "standard" | "prefer-public-beta" | "public-beta";
type ModelCatalogAudience = "public" | "chat" | "public-beta";

@Injectable()
export class GatewayService {
  private readonly CACHE_TTL = 300;
  private readonly CHANNEL_CACHE_PREFIX = "channel:";
  private readonly MODEL_CACHE_PREFIX = "model:";
  private readonly MAX_RETRIES = 3; // 最大重试次数

  constructor(
    @InjectRepository(RequestLog)
    private requestLogRepository: Repository<<RequestRequestLog>,
    @InjectRepository(Channel)
    private channelRepository: Repository<<ChannelChannel>,
    @InjectRepository(User)
    private userRepository: Repository<<UserUser>,
    private authService: AuthService,
    private configService: ConfigService,
    private channelPublicBetaService: ChannelPublicBetaService,
    private cacheService: RedisCacheService,
    private adapterFactory: ModelAdapterFactory,
  ) {}

  private async sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async proxyRequest(
    apiKey: string,
    requestData: any,
    requestIp: string,
    routeMode: GatewayRouteMode = "standard",
  ) {
    const traceId = uuidv4();

    try {
      const keyInfo = await this.authService.validateApiKey(apiKey);
      if (!keyInfo) {
        throw new AuthError("Invalid or inactive API Key");
      }

      const model = requestData.body?.model || requestData.model || "gpt-3.5-turbo";
      const channel = await this.findAvailableChannel(model, routeMode);
      if (!channel) {
        throw new BadRequestException("No available channel for this model");
      }

      const publicBetaState = await this.getChannelPublicBetaState(channel);
      const isFreeRequest = publicBetaState.active && routeMode !== "standard";

      if (!isFreeRequest && keyInfo.userBalance <= 0) {
        throw new BalanceError("Insufficient balance");
      }

      const startTime = Date.now();
      const log = this.requestLogRepository.create({
        apiKeyId: keyInfo.apiKeyId,
        userId: keyInfo.userId,
        channelId: channel.id,
        model,
        requestData,
        requestIp,
        statusCode: 200,
      });

      const protocol = this.getModelProtocol(channel, model);
      const adapter = this.adapterFactory.getAdapter(protocol);
      const upstreamRequest = adapter.buildRequest({
        model,
        messages: requestData.body?.messages || [],
        stream: requestData.body?.stream,
        max_tokens: requestData.body?.max_tokens,
        temperature: requestData.body?.temperature,
        extraBody: requestData.body?.extraBody,
      }, model);

      let response;
      let attempt = 0;
      let lastError: any;

      // --- 鲁棒重试循环 ---
      while (attempt << this this.MAX_RETRIES) {
        try {
          response = await this.forwardRequest(channel, upstreamRequest);
          break; // 成功则跳出循环
        } catch (error: any) {
          lastError = error;
          attempt++;

          const isNetworkError =
            error instanceof AxiosError &&
            (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' ||
             (error.response && [502, 503, 504].includes(error.response.status)));

          if (isNetworkError && attempt << this this.MAX_RETRIES) {
            const delay = Math.pow(2, attempt) * 1000; // 指数退避: 2s, 4s, 8s

            // 这里可以向前端发送一个特定信号（如通过 WebSocket 或特定的响应头）
            // 但在当前 REST 架构中，我们选择在日志中记录并进行延迟重试
            console.log(`[${traceId}] Network fluctuation detected. Retry attempt ${attempt}/${this.MAX_RETRIES} in ${delay}ms...`);
            await this.sleep(delay);
            continue;
          }

          // 如果不是网络波动错误，或者已达到最大重试次数，则抛出异常
          throw error;
        }
      }

      const normalizedData = adapter.normalizeResponse(response.data);
      const cost = isFreeRequest
        ? 0
        : this.calculateCost(model, normalizedData?.usage, channel);

      if (!isFreeRequest && keyInfo.userBalance << cost cost) {
        throw new BalanceError("Insufficient balance after cost calculation");
      }

      log.responseData = response.data;
      log.promptTokens = normalizedData.usage?.prompt_tokens || 0;
      log.completionTokens = normalizedData.usage?.completion_tokens || 0;
      log.totalTokens = normalizedData.usage?.total_tokens || 0;
      log.cost = cost;
      log.latencyMs = Date.now() - startTime;

      if (!isFreeRequest) {
        await this.deductBalance(keyInfo.userId, cost);
      }

      await this.authService.incrementUsage(keyInfo.apiKeyId);
      await this.requestLogRepository.save(log);

      return normalizedData;
    } catch (error) {
      if (error instanceof VGOError) {
        throw new HttpException(
          { errorCode: error.errorCode, message: error.message, traceId },
          error.statusCode
        );
      }

      if (error instanceof AxiosError) {
        throw new HttpException(
          {
            errorCode: 'UPSTREAM_NETWORK_ERROR',
            message: `Upstream service unavailable after retries: ${error.message}`,
            traceId
          },
          error.response?.status || 503
        );
      }

      throw new HttpException(
        { errorCode: 'INTERNAL_ERROR', message: error.message, traceId },
        500
      );
    }
  }

  async findAvailableChannel(
    model: string,
    routeMode: GatewayRouteMode = "standard",
  ): Promise<<ChannelChannel | null> {
    const cacheKey = `${this.CHANNEL_CACHE_PREFIX}${model}:${routeMode}`;
    const cached = await this.cacheService.get<<ChannelChannel>(cacheKey);
    if (cached) return cached;

    const channels = await this.channelRepository.find({
      where: { isActive: true },
      relations: ["modelConfigs"],
      order: { priority: "DESC" },
    });

    const publicBetaConfigs = await this.channelPublicBetaService.getAllConfigs();
    const allCandidates = channels.filter((channel) => this.channelSupportsModel(channel, model));
    const publicBetaCandidates = allCandidates.filter((channel) =>
      this.channelPublicBetaService.isPublicBetaActive(publicBetaConfigs[channel.id]),
    );
    const standardCandidates = allCandidates.filter((channel) =>
      !this.channelPublicBetaService.isPublicBetaActive(publicBetaConfigs[channel.id]),
    );

    let result: Channel | null;
    if (routeMode === "public-beta") {
      result = this.pickPreferredChannel(publicBetaCandidates);
    } else if (routeMode === "prefer-public-beta" && publicBetaCandidates.length) {
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
    return catalog.filter((item) => item.isPublicBetaFree).map((item) => item.id);
  }

  async getAvailableModels(audience: ModelCatalogAudience = "public"): Promise<<

    Array<{ id: string; name: string; provider: string; isPublicBetaFree?: boolean; betaFreeUntil?: string | null; }>
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
      name: item.isPublicBetaFree ? `${item.label} (站内内测至 ${item.betaFreeUntil})` : item.label,
      provider: item.family,
      isPublicBetaFree: item.isPublicBetaFree,
      betaFreeUntil: item.betaFreeUntil,
    }));
  }

  async getModelCatalog(audience: ModelCatalogAudience = "public") {
    const cacheKey = `${this.MODEL_CACHE_PREFIX}${audience}`;
    const cached = await this.cacheService.get<<anyany[]>(cacheKey);
    if (cached) return cached;

    const channels = await this.channelRepository.find({
      where: { isActive: true },
      relations: ["modelConfigs"],
      order: { priority: "DESC" },
    });
    const publicBetaConfigs = await this.channelPublicBetaService.getAllConfigs();

    const catalog = new Map<<stringstring, any>();

    for (const channel of channels) {
      const publicBetaState = this.toPublicBetaState(publicBetaConfigs[channel.id]);
      for (const modelId of channel.models) {
        if (!modelId || modelId === "*") continue;
        if (!this.isChannelModelEnabled(channel, modelId)) continue;
        if (audience === "public-beta" && !publicBetaState.active) continue;
        if (audience === "public" && publicBetaState.active) continue;

        const preset = getModelPreset(modelId);
        if (preset.hidden) continue;

        const pricing = audience === "public-beta" && publicBetaState.active
            ? { inputPricePerMillion: 0, outputPricePerMillion: 0, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0, protocol: this.getModelProtocol(channel, modelId) }
            : this.getModelPricing(channel, modelId);

        const existing = catalog.get(modelId);
        if (existing) {
          existing.availableChannels.push(channel.name);
          existing.inputPricePerMillion = Math.min(existing.inputPricePerMillion, pricing.inputPricePerMillion);
          existing.outputPricePerMillion = Math.min(existing.outputPricePerMillion, pricing.outputPricePerMillion);
          existing.cacheWritePricePerMillion = Math.min(existing.cacheWritePricePerMillion, pricing.cacheWritePricePerMillion);
          existing.cacheReadPricePerMillion = Math.min(existing.cacheReadPricePerMillion, pricing.cacheReadPricePerMillion);
          existing.isPublicBetaFree = existing.isPublicBetaFree || publicBetaState.active;
          existing.betaFreeUntil = existing.betaFreeUntil || publicBetaState.betaFreeUntil;
          existing.betaLabel = existing.betaLabel || publicBetaState.betaLabel;
          existing.betaAccessPath = existing.betaAccessPath || null;
          continue;
        }

        catalog.set(modelId, {
          id: modelId,
          label: preset.label,
          summary: preset.summary,
          family: preset.family === "Custom" ? channel.channelType : preset.family,
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
          betaFreeUntil: audience === "chat" && publicBetaState.active ? publicBetaState.betaFreeUntil : null,
          betaLabel: audience === "chat" && publicBetaState.active ? publicBetaState.betaLabel : null,
          betaAccessPath: null,
          hidden: preset.hidden || false,
        });
      }
    }

    const result = Array.from(catalog.values()).sort((a, b) => a.label.localeCompare(b.label));
    await this.cacheService.set(cacheKey, result, { ttl: this.CACHE_TTL });
    return result;
  }

  async getClientModels(apiKey: string) {
    const keyInfo = await this.authService.validateApiKey(apiKey);
    if (!keyInfo) throw new BadRequestException("Invalid or inactive API Key");
    return this.getModelCatalog("chat");
  }

  async requestChatCompletion(
    payload: ChatCompletionPayload,
    routeMode: GatewayRouteMode = "standard",
  ) {
    throw new HttpException("Please use proxyRequest for improved stability and tracing", 400);
  }

  private async forwardRequest(channel: Channel, requestData: GatewayUpstreamRequest) {
    const normalizedBaseUrl = channel.baseUrl.replace(/\/$/, "");
    const normalizedPath = this.normalizeChannelPath(normalizedBaseUrl, requestData.path || "/v1/chat/completions");
    const url = `${normalizedBaseUrl}${normalizedPath}`;

    const headers: any = { "Content-Type": "application/json" };
    if (channel.apiKey && (!requestData.protocol || requestData.protocol === "openai" || requestData.protocol === "openai-responses")) {
      headers["Authorization"] = `Bearer ${channel.apiKey}`;
    }
    if (requestData.protocol === "anthropic" && channel.apiKey) {
      headers["x-api-key"] = channel.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }
    if (requestData.protocol === "gemini" && channel.apiKey) {
      headers["x-goog-api-key"] = channel.apiKey;
    }
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
      const estimatedCost = this.estimateCost(requestData.body, channel);
      await this.channelRepository.decrement({ id: channel.id }, "balance", estimatedCost);
      return response;
    } catch (error) {
      if (error instanceof AxiosError && error.response) throw error;
      throw new BadRequestException("Failed to connect to upstream channel");
    }
  }

  private normalizeChannelPath(baseUrl: string, path: string) {
    const nextPath = path.startsWith("/") || path.startsWith(":") ? path : `/${path}`;
    if (baseUrl.endsWith("/v1") && nextPath.startsWith("/v1/")) return nextPath.replace(/^\/v1/, "");
    if (baseUrl.endsWith("/chat/completions") && nextPath === "/v1/chat/completions") return "";
    if (baseUrl.endsWith("/messages") && nextPath === "/v1/messages") return "";
    if (baseUrl.endsWith("/responses") && nextPath === "/v1/responses") return "";
    if (/\/v1\/models\/[^/]+$/i.test(baseUrl) && /:generateContent$/i.test(nextPath)) return nextPath;
    if (/:generateContent$/i.test(baseUrl) && /:generateContent$/i.test(nextPath)) return "";
    return nextPath;
  }

  private getModelProtocol(channel: Channel, model: string): GatewayProtocol {
    const modelConfig = channel.modelConfigs?.find((item) => item.modelName === model && item.isActive);
    const configuredProtocol = (modelConfig?.protocol || "auto").toLowerCase();
    if (["openai", "openai-responses", "anthropic", "gemini"].includes(configuredProtocol)) return configuredProtocol as GatewayProtocol;
    if (channel.channelType === "anthropic" || (channel.baseUrl.includes("opencode.ai/zen") && model.startsWith("claude-"))) return "anthropic";
    if (channel.baseUrl.includes("/responses") || (channel.baseUrl.includes("opencode.ai/zen") && model.startsWith("gpt-"))) return "openai-responses";
    if (channel.baseUrl.includes("generativelanguage.googleapis.com") || (channel.channelType === "custom" && model.startsWith("gemini")) || channel.baseUrl.includes("/v1/models/")) return "gemini";
    return "openai";
  }

  private calculateCost(model: string, usage: any, channel: Channel): number {
    if (!usage) return 0;
    const pricing = this.getModelPricing(channel, model);
    const promptTokens = usage.prompt_tokens || 0;
    const completionTokens = usage.completion_tokens || 0;
    const cacheWriteTokens = usage.cache_write_tokens || 0;
    const cacheReadTokens = usage.cache_read_tokens || 0;
    const inputCost = (promptTokens / 1_000_000) * pricing.inputPricePerMillion;
    const outputCost = (completionTokens / 1_000_000) * pricing.outputPricePerMillion;
    const cacheWriteCost = (cacheWriteTokens / 1_000_000) * pricing.cacheWritePricePerMillion;
    const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.cacheReadPricePerMillion;
    return Number(((inputCost + outputCost + cacheWriteCost + cacheReadCost) * Number(channel.priceRate || 1)).toFixed(6));
  }

  private estimateCost(requestData: any, channel: Channel): number {
    const messages = requestData?.messages || [];
    const model = requestData?.model || "gpt-4o-mini";
    let estimatedTokens = 0;
    for (const msg of messages) estimatedTokens += (msg.content?.length || 0) / 4;
    const pricing = this.getModelPricing(channel, model);
    return Number(((estimatedTokens / 1_000_000) * pricing.inputPricePerMillion * Number(channel.priceRate || 1)).toFixed(6));
  }

  private getModelPricing(channel: Channel, model: string) {
    const modelConfig = channel.modelConfigs?.find((item) => item.modelName === model);
    return {
      protocol: this.getModelProtocol(channel, model),
      inputPricePerMillion: Number(modelConfig?.inputPrice || FALLBACK_INPUT_PRICE_PER_MILLION),
      outputPricePerMillion: Number(modelConfig?.outputPrice || FALLBACK_OUTPUT_PRICE_PER_MILLION),
      cacheWritePricePerMillion: Number(modelConfig?.cacheWritePrice || 0),
      cacheReadPricePerMillion: Number(modelConfig?.cacheReadPrice || 0),
    };
  }

  async deductBalance(userId: string, amount: number) {
    await this.userRepository.createQueryBuilder().update(User).set({ balance: () => `balance - ${amount}` }).where("id = :id", { id: userId }).execute();
  }

  async getRequestLogs(userId: string, page: number = 1, limit: number = 20) {
    const [logs, total] = await this.requestLogRepository.findAndCount({ where: { userId }, order: { createdAt: "DESC" }, skip: (page - 1) * limit, take: limit });
    return { data: logs, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getUsageStats(userId: string, days: number = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    return this.requestLogRepository.createQueryBuilder("log").select("DATE(log.created_at)", "date").addSelect("COUNT(*)", "count").addSelect("SUM(log.total_tokens)", "tokens").addSelect("SUM(log.cost)", "cost").where("log.user_id = :userId", { userId }).andWhere("log.created_at >= :startDate", { startDate }).groupBy("DATE(log.created_at)").orderBy("date", "ASC").getRawMany();
  }
}
