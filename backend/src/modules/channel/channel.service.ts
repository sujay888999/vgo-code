import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import axios from "axios";
import { Channel, ChannelStatus } from "./channel.entity";
import { ChannelModel } from "./channel-model.entity";
import { ChannelPublicBetaService } from "./channel-public-beta.service";

@Injectable()
export class ChannelService {
  constructor(
    @InjectRepository(Channel)
    private channelRepository: Repository<Channel>,
    @InjectRepository(ChannelModel)
    private channelModelRepository: Repository<ChannelModel>,
    private channelPublicBetaService: ChannelPublicBetaService,
  ) {}

  async findAll() {
    const channels = await this.channelRepository.find({
      order: { priority: "DESC" },
    });

    return this.channelPublicBetaService.attachConfigs(channels);
  }

  async findOne(id: string) {
    const channel = await this.channelRepository.findOne({
      where: { id },
      relations: ["modelConfigs"],
    });

    if (!channel) {
      throw new NotFoundException("Channel not found");
    }

    return this.channelPublicBetaService.attachConfig(channel);
  }

  async findActiveChannels() {
    return this.channelRepository.find({
      where: { isActive: true },
      order: { priority: "DESC" },
    });
  }

  async getAvailableModels(channelId: string) {
    return this.channelModelRepository.find({
      where: { channelId, isActive: true },
    });
  }

  async testChannel(id: string) {
    const channel = await this.findOne(id);

    // Update status to testing
    channel.status = ChannelStatus.TESTING;
    await this.channelRepository.save(channel);

    try {
      const testModel =
        channel.modelConfigs?.find((item) => item.isActive)?.modelName ||
        channel.models.find((item) => item && item !== "*") ||
        "gpt-3.5-turbo";
      const response = await this.runChannelTest(channel, testModel);

      // Success
      channel.status = ChannelStatus.ONLINE;
      channel.testAt = new Date();
      channel.testError = null;
      await this.channelRepository.save(channel);

      return {
        success: true,
        message: "Channel is working",
        response: response.data,
      };
    } catch (error: any) {
      // Failed
      channel.status = ChannelStatus.ERROR;
      channel.testAt = new Date();
      channel.testError = error.message || "Unknown error";
      await this.channelRepository.save(channel);

      return { success: false, message: error.message || "Test failed" };
    }
  }

  async testChannelModel(
    id: string,
    data: { modelName: string; protocol?: string; message?: string },
  ) {
    const channel = await this.findOne(id);
    if (!data?.modelName?.trim()) {
      throw new BadRequestException("modelName is required");
    }

    const modelName = data.modelName.trim();
    try {
      const response = await this.runChannelTest(
        channel,
        modelName,
        data.protocol,
        data.message,
      );

      return {
        success: true,
        modelName,
        protocol: this.resolveProtocol(channel, modelName, data.protocol),
        response: response.data,
      };
    } catch (error: any) {
      return {
        success: false,
        modelName,
        protocol: this.resolveProtocol(channel, modelName, data.protocol),
        status: error?.response?.status || null,
        message: error?.message || "Test failed",
        error: error?.response?.data || null,
      };
    }
  }

  private resolveProtocol(
    channel: Channel,
    modelName: string,
    protocolOverride?: string,
  ) {
    const configuredProtocol = (
      protocolOverride ||
      channel.modelConfigs?.find((item) => item.modelName === modelName)?.protocol ||
      "auto"
    ).toLowerCase();

    if (
      configuredProtocol === "anthropic" ||
      configuredProtocol === "gemini" ||
      configuredProtocol === "openai-responses" ||
      configuredProtocol === "openai"
    ) {
      return configuredProtocol;
    }

    if (
      channel.baseUrl.includes("/responses") ||
      (channel.baseUrl.includes("opencode.ai/zen") &&
        modelName.startsWith("gpt-"))
    ) {
      return "openai-responses";
    }

    if (
      channel.channelType === "anthropic" ||
      (channel.baseUrl.includes("opencode.ai/zen") &&
        modelName.startsWith("claude-"))
    ) {
      return "anthropic";
    }

    if (
      channel.baseUrl.includes("generativelanguage.googleapis.com") ||
      modelName.startsWith("gemini") ||
      channel.baseUrl.includes("/v1/models/")
    ) {
      return "gemini";
    }

    return "openai";
  }

  private async runChannelTest(
    channel: Channel,
    testModel: string,
    protocolOverride?: string,
    message?: string,
  ) {
    const protocol = this.resolveProtocol(channel, testModel, protocolOverride);
    const baseUrl = channel.baseUrl.replace(/\/$/, "");
    const testUrl =
      protocol === "anthropic"
        ? baseUrl.includes("/v1/messages")
          ? baseUrl
          : `${baseUrl}/v1/messages`
        : protocol === "gemini"
          ? /:generateContent$/i.test(baseUrl)
            ? baseUrl
            : /\/v1\/models\/[^/]+$/i.test(baseUrl)
              ? `${baseUrl}:generateContent`
              : `${baseUrl}/v1beta/models/${encodeURIComponent(testModel)}:generateContent`
          : protocol === "openai-responses"
            ? baseUrl.includes("/v1/responses")
              ? baseUrl
              : `${baseUrl}/v1/responses`
            : baseUrl.includes("/v1/chat/completions")
              ? baseUrl
              : `${baseUrl}/v1/chat/completions`;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (
      channel.apiKey &&
      (protocol === "openai" || protocol === "openai-responses")
    ) {
      headers.Authorization = `Bearer ${channel.apiKey}`;
    }

    if (protocol === "anthropic" && channel.apiKey) {
      headers["x-api-key"] = channel.apiKey;
      headers["anthropic-version"] = "2023-06-01";
    }

    if (protocol === "gemini" && channel.apiKey) {
      headers["x-goog-api-key"] = channel.apiKey;
    }

    return axios.post(
      testUrl,
      protocol === "anthropic"
        ? {
            model: testModel,
            max_tokens: 32,
            messages: [{ role: "user", content: message || "Hi" }],
          }
        : protocol === "gemini"
          ? {
              contents: [
                {
                  role: "user",
                  parts: [{ text: message || "Hi" }],
                },
              ],
              generationConfig: {
                maxOutputTokens: 32,
              },
            }
          : protocol === "openai-responses"
            ? {
                model: testModel,
                input: [
                  {
                    role: "user",
                    content: [{ type: "input_text", text: message || "Hi" }],
                  },
                ],
                max_output_tokens: 32,
              }
            : {
                model: testModel,
                messages: [{ role: "user", content: message || "Hi" }],
                max_tokens: 32,
              },
      {
        headers,
        timeout: 15000,
      },
    );
  }
}
