import "reflect-metadata";
import dataSource from "./data-source";
import { Channel } from "../modules/channel/channel.entity";
import { ChannelModel } from "../modules/channel/channel-model.entity";
import { getOpencodeZenRetailPricing } from "./opencode-zen-pricing";

async function main() {
  await dataSource.initialize();

  const channelRepo = dataSource.getRepository(Channel);
  const modelRepo = dataSource.getRepository(ChannelModel);

  const channels = await channelRepo.find({
    where: { isActive: true },
    relations: ["modelConfigs"],
  });

  const opencodeChannels = channels.filter((channel) =>
    /opencode\.ai\/zen/i.test(channel.baseUrl || "") || /^opencode/i.test(channel.name || ""),
  );

  let updated = 0;

  for (const channel of opencodeChannels) {
    for (const model of channel.modelConfigs || []) {
      const pricing = getOpencodeZenRetailPricing(model.modelName);
      if (!pricing) {
        continue;
      }

      model.inputPrice = pricing.inputPrice;
      model.outputPrice = pricing.outputPrice;
      model.cacheReadPrice = pricing.cacheReadPrice;
      model.cacheWritePrice = pricing.cacheWritePrice;
      await modelRepo.save(model);
      updated += 1;
    }
  }

  console.log(`[sync-opencode-zen-pricing] updated ${updated} model price rows`);
  await dataSource.destroy();
}

main().catch(async (error) => {
  console.error(error);
  try {
    await dataSource.destroy();
  } catch {}
  process.exit(1);
});
