import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { getChatSkills } from "./chat-skill-registry";

interface SkillInstallStore {
  users: Record<string, string[]>;
}

@Injectable()
export class ChatSkillInstallService implements OnModuleInit {
  private readonly logger = new Logger(ChatSkillInstallService.name);
  private readonly storePath = join(
    process.cwd(),
    "data",
    "chat-skill-installs.json",
  );
  private writeQueue: Promise<void> = Promise.resolve();

  async onModuleInit() {
    await this.ensureStoreFile();
  }

  async getInstalledSkillIds(userId: string, isAdmin: boolean) {
    const store = await this.readStore();
    const savedSkillIds = store.users[userId] || [];
    return this.normalizeSkillIds(savedSkillIds, isAdmin);
  }

  async setInstalledSkillIds(
    userId: string,
    skillIds: string[],
    isAdmin: boolean,
  ) {
    const normalizedSkillIds = this.normalizeSkillIds(skillIds, isAdmin);

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      store.users[userId] = normalizedSkillIds;
      await this.writeStore(store);
    });

    return normalizedSkillIds;
  }

  private normalizeSkillIds(skillIds: string[], isAdmin: boolean) {
    const availableSkillIds = new Set(
      getChatSkills(isAdmin).map((skill) => skill.id),
    );
    const normalized = Array.from(
      new Set(["general-agent", ...(skillIds || [])]),
    ).filter((skillId) => availableSkillIds.has(skillId));

    return normalized.length ? normalized : ["general-agent"];
  }

  private async ensureStoreFile() {
    await mkdir(dirname(this.storePath), { recursive: true });

    try {
      await readFile(this.storePath, "utf8");
    } catch {
      await writeFile(
        this.storePath,
        JSON.stringify({ users: {} }, null, 2),
        "utf8",
      );
    }
  }

  private async readStore(): Promise<SkillInstallStore> {
    await this.ensureStoreFile();

    try {
      const raw = await readFile(this.storePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        users:
          typeof parsed?.users === "object" && parsed.users ? parsed.users : {},
      };
    } catch (error) {
      this.logger.warn(
        `Failed to read skill install store, falling back to empty store: ${String(error)}`,
      );
      return { users: {} };
    }
  }

  private async writeStore(store: SkillInstallStore) {
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(store, null, 2), "utf8");
  }

  private async enqueueWrite(task: () => Promise<void>) {
    this.writeQueue = this.writeQueue.then(task).catch((error) => {
      this.logger.error(`Failed to persist skill installs: ${String(error)}`);
    });

    await this.writeQueue;
  }
}
