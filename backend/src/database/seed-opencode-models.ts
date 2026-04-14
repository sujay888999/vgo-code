import "reflect-metadata";
import dataSource from "./data-source";
import { Channel, ChannelType } from "../modules/channel/channel.entity";
import { ChannelModel } from "../modules/channel/channel-model.entity";
import { getOpencodeZenRetailPricing } from "./opencode-zen-pricing";

type SeedRow = {
  channelName: string;
  channelType: ChannelType;
  baseUrl: string;
  modelName: string;
  protocol: string;
  inputPrice: number;
  outputPrice: number;
  cacheReadPrice: number;
  cacheWritePrice: number;
  isActive: boolean;
};

const SEED_ROWS: SeedRow[] = [
  {
    channelName: "local-ollama",
    channelType: ChannelType.CUSTOM,
    baseUrl: "http://vgo-customer-service:11434",
    modelName: "vgo-customer-service",
    protocol: "openai",
    inputPrice: 0,
    outputPrice: 0,
    cacheReadPrice: 0,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5.4",
    protocol: "openai-responses",
    inputPrice: 5.6,
    outputPrice: 33.1,
    cacheReadPrice: 0.58,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5.4-pro",
    protocol: "openai-responses",
    inputPrice: 47.22,
    outputPrice: 282.93,
    cacheReadPrice: 47.16,
    cacheWritePrice: 0,
    isActive: false,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5.4-mini",
    protocol: "openai-responses",
    inputPrice: 2.51,
    outputPrice: 14.29,
    cacheReadPrice: 0.29,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5.4-nano",
    protocol: "openai-responses",
    inputPrice: 0.78,
    outputPrice: 4.08,
    cacheReadPrice: 0.1,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5.3-codex",
    protocol: "openai-responses",
    inputPrice: 4.39,
    outputPrice: 34.34,
    cacheReadPrice: 0.47,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5.3-codex-spark",
    protocol: "openai-responses",
    inputPrice: 4.39,
    outputPrice: 34.34,
    cacheReadPrice: 0.47,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5.2",
    protocol: "openai-responses",
    inputPrice: 3.96,
    outputPrice: 30.91,
    cacheReadPrice: 0.42,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5.2-codex",
    protocol: "openai-responses",
    inputPrice: 4.39,
    outputPrice: 34.34,
    cacheReadPrice: 0.47,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5.1",
    protocol: "openai-responses",
    inputPrice: 2.46,
    outputPrice: 18.81,
    cacheReadPrice: 0.27,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5.1-codex",
    protocol: "openai-responses",
    inputPrice: 2.73,
    outputPrice: 20.89,
    cacheReadPrice: 0.3,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5.1-codex-max",
    protocol: "openai-responses",
    inputPrice: 3.17,
    outputPrice: 24.56,
    cacheReadPrice: 0.35,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5.1-codex-mini",
    protocol: "openai-responses",
    inputPrice: 0.93,
    outputPrice: 6.43,
    cacheReadPrice: 0.13,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5",
    protocol: "openai-responses",
    inputPrice: 2.46,
    outputPrice: 18.81,
    cacheReadPrice: 0.27,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5-codex",
    protocol: "openai-responses",
    inputPrice: 2.73,
    outputPrice: 20.89,
    cacheReadPrice: 0.3,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-responses",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/responses",
    modelName: "gpt-5-nano",
    protocol: "openai-responses",
    inputPrice: 0.05,
    outputPrice: 0.2,
    cacheReadPrice: 0.02,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-gemini",
    channelType: ChannelType.CUSTOM,
    baseUrl: "https://opencode.ai/zen/v1/models/gemini-3-flash",
    modelName: "gemini-3-flash",
    protocol: "gemini",
    inputPrice: 1.72,
    outputPrice: 9.58,
    cacheReadPrice: 0.19,
    cacheWritePrice: 0,
    isActive: false,
  },
  {
    channelName: "opencode-chat",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/chat/completions",
    modelName: "minimax-m2.5-free",
    protocol: "openai",
    inputPrice: 0.05,
    outputPrice: 0.2,
    cacheReadPrice: 0.02,
    cacheWritePrice: 0,
    isActive: false,
  },
  {
    channelName: "opencode-chat",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/chat/completions",
    modelName: "glm-5",
    protocol: "openai",
    inputPrice: 3.29,
    outputPrice: 10.21,
    cacheReadPrice: 0.66,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-chat",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/chat/completions",
    modelName: "kimi-k2.5",
    protocol: "openai",
    inputPrice: 2.03,
    outputPrice: 9.58,
    cacheReadPrice: 0.35,
    cacheWritePrice: 0,
    isActive: true,
  },
  {
    channelName: "opencode-chat",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/chat/completions",
    modelName: "big-pickle",
    protocol: "openai",
    inputPrice: 0.05,
    outputPrice: 0.2,
    cacheReadPrice: 0.02,
    cacheWritePrice: 0,
    isActive: false,
  },
  {
    channelName: "opencode-chat",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/chat/completions",
    modelName: "mimo-v2-pro-free",
    protocol: "openai",
    inputPrice: 0.05,
    outputPrice: 0.2,
    cacheReadPrice: 0.02,
    cacheWritePrice: 0,
    isActive: false,
  },
  {
    channelName: "opencode-chat",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/chat/completions",
    modelName: "mimo-v2-omni-free",
    protocol: "openai",
    inputPrice: 0.05,
    outputPrice: 0.2,
    cacheReadPrice: 0.02,
    cacheWritePrice: 0,
    isActive: false,
  },
  {
    channelName: "opencode-chat",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/chat/completions",
    modelName: "qwen3.6-plus-free",
    protocol: "openai",
    inputPrice: 0.05,
    outputPrice: 0.2,
    cacheReadPrice: 0.02,
    cacheWritePrice: 0,
    isActive: false,
  },
  {
    channelName: "opencode-chat",
    channelType: ChannelType.OPENAI,
    baseUrl: "https://opencode.ai/zen/v1/chat/completions",
    modelName: "nemotron-3-super-free",
    protocol: "openai",
    inputPrice: 0.05,
    outputPrice: 0.2,
    cacheReadPrice: 0.02,
    cacheWritePrice: 0,
    isActive: false,
  },
];

for (const row of SEED_ROWS) {
  const pricing = getOpencodeZenRetailPricing(row.modelName);
  if (pricing) {
    row.inputPrice = pricing.inputPrice;
    row.outputPrice = pricing.outputPrice;
    row.cacheReadPrice = pricing.cacheReadPrice;
    row.cacheWritePrice = pricing.cacheWritePrice;
  }
}

async function main() {
  await dataSource.initialize();

  const channelRepo = dataSource.getRepository(Channel);
  const modelRepo = dataSource.getRepository(ChannelModel);

  const existingOpencode = await channelRepo.findOne({
    where: { name: "opencode" },
  });
  const sharedApiKey = existingOpencode?.apiKey || process.env.OPENCODE_API_KEY || "";
  if (!sharedApiKey) {
    throw new Error("Missing opencode API key. Existing channel 'opencode' or OPENCODE_API_KEY is required.");
  }

  const existingModels = await modelRepo.find();
  const existingModelNames = new Set(existingModels.map((item) => item.modelName));

  const channelRows = new Map<string, SeedRow[]>();
  for (const row of SEED_ROWS) {
    if (existingModelNames.has(row.modelName)) {
      continue;
    }
    const current = channelRows.get(row.channelName) || [];
    current.push(row);
    channelRows.set(row.channelName, current);
  }

  const created: string[] = [];
  const skipped: string[] = [];

  for (const [channelName, rows] of channelRows.entries()) {
    let channel = await channelRepo.findOne({
      where: { name: channelName },
      relations: ["modelConfigs"],
    });

    if (!channel) {
      channel = channelRepo.create({
        name: channelName,
        channelType: rows[0].channelType,
        baseUrl: rows[0].baseUrl,
        apiKey: sharedApiKey,
        models: [],
        priority: 1,
        priceRate: 1,
        balance: existingOpencode?.balance || 0,
        isActive: true,
      });
      channel = await channelRepo.save(channel);
    }

    const modelNames = new Set(channel.models || []);
    for (const row of rows) {
      modelNames.add(row.modelName);
    }
    channel.models = Array.from(modelNames);
    await channelRepo.save(channel);

    for (const row of rows) {
      const existing = await modelRepo.findOne({
        where: { channelId: channel.id, modelName: row.modelName },
      });
      if (existing) {
        skipped.push(row.modelName);
        continue;
      }

      await modelRepo.save(
        modelRepo.create({
          channelId: channel.id,
          modelName: row.modelName,
          protocol: row.protocol,
          inputPrice: row.inputPrice,
          outputPrice: row.outputPrice,
          cacheReadPrice: row.cacheReadPrice,
          cacheWritePrice: row.cacheWritePrice,
          isActive: row.isActive,
        }),
      );
      created.push(`${channelName}:${row.modelName}`);
    }
  }

  console.log(
    JSON.stringify(
      {
        created,
        skipped,
      },
      null,
      2,
    ),
  );

  await dataSource.destroy();
}

main().catch(async (error) => {
  console.error(error);
  if (dataSource.isInitialized) {
    await dataSource.destroy();
  }
  process.exit(1);
});
