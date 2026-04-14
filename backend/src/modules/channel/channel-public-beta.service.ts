import { Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "fs";
import { dirname, resolve } from "path";

export interface ChannelPublicBetaConfig {
  isPublicBeta: boolean;
  betaFreeUntil: string | null;
  betaLabel: string | null;
}

type ChannelPublicBetaConfigMap = Record<string, ChannelPublicBetaConfig>;

export const DEFAULT_PUBLIC_BETA_DEADLINE = "2026-04-15";
export const DEFAULT_PUBLIC_BETA_LABEL = "内测免费";

@Injectable()
export class ChannelPublicBetaService {
  private readonly logger = new Logger(ChannelPublicBetaService.name);
  private readonly filePath =
    process.env.CHANNEL_PUBLIC_BETA_CONFIG_PATH ||
    (process.env.NODE_ENV === "production"
      ? "/app/data/channel-public-beta.json"
      : resolve(process.cwd(), "data", "channel-public-beta.json"));

  async getAllConfigs(): Promise<ChannelPublicBetaConfigMap> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(content) as ChannelPublicBetaConfigMap;
      return Object.fromEntries(
        Object.entries(parsed || {}).map(([channelId, entry]) => [
          channelId,
          this.normalizeConfig(entry),
        ]),
      );
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        this.logger.warn(`Failed to read public beta config: ${error.message}`);
      }
      return {};
    }
  }

  async getChannelConfig(channelId: string): Promise<ChannelPublicBetaConfig> {
    const configMap = await this.getAllConfigs();
    return this.normalizeConfig(configMap[channelId]);
  }

  async updateChannelConfig(
    channelId: string,
    patch?: Partial<ChannelPublicBetaConfig>,
  ) {
    const configMap = await this.getAllConfigs();
    const nextConfig = this.normalizeConfig(patch);

    if (!nextConfig.isPublicBeta) {
      delete configMap[channelId];
    } else {
      configMap[channelId] = nextConfig;
    }

    await this.writeConfig(configMap);
    return nextConfig;
  }

  async deleteChannelConfig(channelId: string) {
    const configMap = await this.getAllConfigs();
    delete configMap[channelId];
    await this.writeConfig(configMap);
  }

  async attachConfig<T extends { id: string }>(
    channel: T,
  ): Promise<T & ChannelPublicBetaConfig> {
    return {
      ...channel,
      ...(await this.getChannelConfig(channel.id)),
    };
  }

  async attachConfigs<T extends { id: string }>(
    channels: T[],
  ): Promise<Array<T & ChannelPublicBetaConfig>> {
    const configMap = await this.getAllConfigs();

    return channels.map((channel) => ({
      ...channel,
      ...this.normalizeConfig(configMap[channel.id]),
    }));
  }

  isPublicBetaActive(
    config?: Partial<ChannelPublicBetaConfig> | null,
    at: Date = new Date(),
  ) {
    const normalized = this.normalizeConfig(config);
    if (!normalized.isPublicBeta || !normalized.betaFreeUntil) {
      return false;
    }

    const deadline = new Date(`${normalized.betaFreeUntil}T23:59:59+08:00`);
    return (
      !Number.isNaN(deadline.getTime()) && at.getTime() <= deadline.getTime()
    );
  }

  private normalizeConfig(
    config?: Partial<ChannelPublicBetaConfig> | null,
  ): ChannelPublicBetaConfig {
    const isPublicBeta = Boolean(config?.isPublicBeta);
    const betaFreeUntil = isPublicBeta
      ? this.normalizeDate(config?.betaFreeUntil) ||
        DEFAULT_PUBLIC_BETA_DEADLINE
      : null;
    const betaLabel = isPublicBeta
      ? config?.betaLabel?.trim() || DEFAULT_PUBLIC_BETA_LABEL
      : null;

    return {
      isPublicBeta,
      betaFreeUntil,
      betaLabel,
    };
  }

  private normalizeDate(value?: string | null) {
    if (!value) {
      return null;
    }

    const nextValue = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(nextValue)) {
      return nextValue;
    }

    const parsed = new Date(nextValue);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString().slice(0, 10);
  }

  private async writeConfig(configMap: ChannelPublicBetaConfigMap) {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify(configMap, null, 2),
      "utf8",
    );
  }
}
