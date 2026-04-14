import "reflect-metadata";
import axios from "axios";
import dataSource from "./data-source";
import { Channel } from "../modules/channel/channel.entity";

type Protocol = "openai" | "openai-responses" | "anthropic" | "gemini";

const TARGET_CHANNELS = ["opencode", "opencode-chat", "opencode-responses", "opencode-gemini"];

function getProtocol(channel: Channel, model: string): Protocol {
  const configured = (
    channel.modelConfigs?.find((item) => item.modelName === model)?.protocol || "auto"
  ).toLowerCase();
  if (
    configured === "openai" ||
    configured === "openai-responses" ||
    configured === "anthropic" ||
    configured === "gemini"
  ) {
    return configured as Protocol;
  }
  if (channel.baseUrl.includes("/responses") || model.startsWith("gpt-")) {
    return "openai-responses";
  }
  if (channel.baseUrl.includes("/messages") || model.startsWith("claude-")) {
    return "anthropic";
  }
  if (channel.baseUrl.includes("/v1/models/") || model.startsWith("gemini-")) {
    return "gemini";
  }
  return "openai";
}

function buildRequest(channel: Channel, model: string) {
  const protocol = getProtocol(channel, model);
  const baseUrl = channel.baseUrl.replace(/\/$/, "");
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (protocol === "anthropic") {
    headers["x-api-key"] = channel.apiKey || "";
    headers["anthropic-version"] = "2023-06-01";
    return {
      url: baseUrl.includes("/v1/messages") ? baseUrl : `${baseUrl}/v1/messages`,
      headers,
      body: {
        model,
        max_tokens: 32,
        messages: [{ role: "user", content: [{ type: "text", text: "Hi" }] }],
      },
    };
  }

  if (protocol === "gemini") {
    headers["x-goog-api-key"] = channel.apiKey || "";
    return {
      url: /\/v1\/models\/[^/]+$/i.test(baseUrl)
        ? `${baseUrl}:generateContent`
        : `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers,
      body: {
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
        generationConfig: { maxOutputTokens: 32 },
      },
    };
  }

  headers.Authorization = `Bearer ${channel.apiKey || ""}`;

  if (protocol === "openai-responses") {
    return {
      url: baseUrl.includes("/v1/responses") ? baseUrl : `${baseUrl}/v1/responses`,
      headers,
      body: {
        model,
        input: [{ role: "user", content: [{ type: "input_text", text: "Hi" }] }],
        max_output_tokens: 32,
      },
    };
  }

  return {
    url: baseUrl.includes("/v1/chat/completions")
      ? baseUrl
      : `${baseUrl}/v1/chat/completions`,
    headers,
    body: {
      model,
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 32,
    },
  };
}

async function main() {
  await dataSource.initialize();
  const channelRepo = dataSource.getRepository(Channel);
  const channels = await channelRepo.find({
    where: TARGET_CHANNELS.map((name) => ({ name })) as any,
    relations: ["modelConfigs"],
    order: { name: "ASC" },
  });

  const results: Array<Record<string, any>> = [];

  for (const channel of channels) {
    for (const config of channel.modelConfigs || []) {
      if (!config.isActive) {
        continue;
      }

      const request = buildRequest(channel, config.modelName);

      try {
        const response = await axios.post(request.url, request.body, {
          headers: request.headers,
          timeout: 45000,
        });
        results.push({
          channel: channel.name,
          model: config.modelName,
          ok: true,
          status: response.status,
        });
      } catch (error: any) {
        results.push({
          channel: channel.name,
          model: config.modelName,
          ok: false,
          status: error?.response?.status || null,
          error:
            error?.response?.data ||
            error?.message ||
            "unknown_error",
        });
      }
    }
  }

  console.log(JSON.stringify(results, null, 2));
  await dataSource.destroy();
}

main().catch(async (error) => {
  console.error(error);
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
  process.exit(1);
});
