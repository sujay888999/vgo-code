import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  UnauthorizedException,
} from "@nestjs/common";
import { randomBytes, randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";

type BridgeStatus = "offline" | "idle" | "busy" | "error";
type JobStatus = "queued" | "running" | "completed" | "failed";

export interface LocalBridgeRecord {
  id: string;
  userId: string;
  name: string;
  platform: string;
  machineLabel: string;
  workingDirectory: string;
  status: BridgeStatus;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string | null;
  tokenPreview: string;
}

interface LocalBridgeSecretRecord extends LocalBridgeRecord {
  token: string;
}

export interface LocalBridgeJobRecord {
  id: string;
  bridgeId: string;
  userId: string;
  title: string;
  instruction: string;
  workingDirectory: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  resultSummary?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  artifacts?: string[];
}

interface LocalBridgeStore {
  bridges: LocalBridgeSecretRecord[];
  jobs: LocalBridgeJobRecord[];
}

@Injectable()
export class ChatLocalBridgeService implements OnModuleInit {
  private readonly logger = new Logger(ChatLocalBridgeService.name);
  private readonly storePath = join(
    process.cwd(),
    "data",
    "chat-local-bridge.json",
  );
  private writeQueue: Promise<void> = Promise.resolve();

  async onModuleInit() {
    await this.ensureStoreFile();
  }

  async listBridges(userId: string) {
    const store = await this.readStore();
    return store.bridges
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((item) => this.stripSecret(item));
  }

  async createBridge(
    userId: string,
    payload: {
      name?: string;
      platform?: string;
      machineLabel?: string;
      workingDirectory?: string;
    },
  ) {
    const now = new Date().toISOString();
    const secret: LocalBridgeSecretRecord = {
      id: randomUUID(),
      userId,
      name:
        String(payload.name || "My Local Bridge").trim() || "My Local Bridge",
      platform: String(payload.platform || "windows").trim() || "windows",
      machineLabel:
        String(payload.machineLabel || "Local Machine").trim() ||
        "Local Machine",
      workingDirectory:
        String(payload.workingDirectory || "E:\\").trim() || "E:\\",
      status: "offline",
      createdAt: now,
      updatedAt: now,
      lastSeenAt: null,
      token: this.generateToken(),
      tokenPreview: "",
    };
    secret.tokenPreview = this.maskToken(secret.token);

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      store.bridges.unshift(secret);
      await this.writeStore(store);
    });

    return {
      bridge: this.stripSecret(secret),
      token: secret.token,
    };
  }

  async enqueueJob(
    userId: string,
    bridgeId: string,
    payload: {
      title?: string;
      instruction?: string;
      workingDirectory?: string;
    },
  ) {
    const bridge = await this.findBridgeForUser(userId, bridgeId);
    const instruction = String(payload.instruction || "").trim();
    if (!instruction) {
      throw new BadRequestException("Instruction is required.");
    }

    const now = new Date().toISOString();
    const job: LocalBridgeJobRecord = {
      id: randomUUID(),
      bridgeId: bridge.id,
      userId,
      title:
        String(payload.title || "Local execution task").trim() ||
        "Local execution task",
      instruction,
      workingDirectory:
        String(
          payload.workingDirectory || bridge.workingDirectory || "E:\\",
        ).trim() || "E:\\",
      status: "queued",
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      resultSummary: null,
      stdout: null,
      stderr: null,
      artifacts: [],
    };

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      store.jobs.unshift(job);
      await this.writeStore(store);
    });

    return job;
  }

  async listJobs(userId: string, bridgeId?: string) {
    const store = await this.readStore();
    return store.jobs
      .filter(
        (item) =>
          item.userId === userId && (!bridgeId || item.bridgeId === bridgeId),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getJobMap(userId: string) {
    const jobs = await this.listJobs(userId);
    return new Map(jobs.map((item) => [item.id, item]));
  }

  async agentHeartbeat(payload: {
    bridgeId?: string;
    token?: string;
    status?: BridgeStatus;
  }) {
    const bridge = await this.authenticateBridge(
      payload.bridgeId,
      payload.token,
    );
    const nextStatus =
      payload.status || (bridge.status === "busy" ? "busy" : "idle");

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      store.bridges = store.bridges.map((item) =>
        item.id === bridge.id
          ? {
              ...item,
              status: nextStatus,
              lastSeenAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : item,
      );
      await this.writeStore(store);
    });

    return { ok: true };
  }

  async agentGetNextJob(payload: { bridgeId?: string; token?: string }) {
    const bridge = await this.authenticateBridge(
      payload.bridgeId,
      payload.token,
    );
    const store = await this.readStore();
    const job =
      store.jobs
        .filter(
          (item) => item.bridgeId === bridge.id && item.status === "queued",
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0] || null;
    return job;
  }

  async agentStartJob(payload: {
    bridgeId?: string;
    token?: string;
    jobId?: string;
  }) {
    const bridge = await this.authenticateBridge(
      payload.bridgeId,
      payload.token,
    );
    const job = await this.findBridgeJob(bridge.id, payload.jobId);

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      const now = new Date().toISOString();
      store.jobs = store.jobs.map((item) =>
        item.id === job.id
          ? {
              ...item,
              status: "running",
              startedAt: item.startedAt || now,
              updatedAt: now,
            }
          : item,
      );
      store.bridges = store.bridges.map((item) =>
        item.id === bridge.id
          ? {
              ...item,
              status: "busy",
              lastSeenAt: now,
              updatedAt: now,
            }
          : item,
      );
      await this.writeStore(store);
    });

    return { ok: true };
  }

  async agentCompleteJob(payload: {
    bridgeId?: string;
    token?: string;
    jobId?: string;
    resultSummary?: string;
    stdout?: string;
    stderr?: string;
    artifacts?: string[];
  }) {
    const bridge = await this.authenticateBridge(
      payload.bridgeId,
      payload.token,
    );
    const job = await this.findBridgeJob(bridge.id, payload.jobId);
    const now = new Date().toISOString();

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      store.jobs = store.jobs.map((item) =>
        item.id === job.id
          ? {
              ...item,
              status: "completed",
              completedAt: now,
              updatedAt: now,
              resultSummary:
                String(payload.resultSummary || "").trim() ||
                "Completed successfully.",
              stdout: payload.stdout || null,
              stderr: payload.stderr || null,
              artifacts: Array.isArray(payload.artifacts)
                ? payload.artifacts.slice(0, 20)
                : [],
            }
          : item,
      );
      store.bridges = store.bridges.map((item) =>
        item.id === bridge.id
          ? {
              ...item,
              status: "idle",
              lastSeenAt: now,
              updatedAt: now,
            }
          : item,
      );
      await this.writeStore(store);
    });

    return { ok: true };
  }

  async agentFailJob(payload: {
    bridgeId?: string;
    token?: string;
    jobId?: string;
    resultSummary?: string;
    stdout?: string;
    stderr?: string;
  }) {
    const bridge = await this.authenticateBridge(
      payload.bridgeId,
      payload.token,
    );
    const job = await this.findBridgeJob(bridge.id, payload.jobId);
    const now = new Date().toISOString();

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      store.jobs = store.jobs.map((item) =>
        item.id === job.id
          ? {
              ...item,
              status: "failed",
              completedAt: now,
              updatedAt: now,
              resultSummary:
                String(payload.resultSummary || "").trim() ||
                "Execution failed.",
              stdout: payload.stdout || null,
              stderr: payload.stderr || null,
            }
          : item,
      );
      store.bridges = store.bridges.map((item) =>
        item.id === bridge.id
          ? {
              ...item,
              status: "error",
              lastSeenAt: now,
              updatedAt: now,
            }
          : item,
      );
      await this.writeStore(store);
    });

    return { ok: true };
  }

  private stripSecret(item: LocalBridgeSecretRecord): LocalBridgeRecord {
    const { token, ...rest } = item;
    return rest;
  }

  private maskToken(token: string) {
    return `${token.slice(0, 6)}...${token.slice(-4)}`;
  }

  private generateToken() {
    return randomBytes(24).toString("hex");
  }

  private async findBridgeForUser(userId: string, bridgeId: string) {
    const store = await this.readStore();
    const bridge = store.bridges.find(
      (item) => item.id === bridgeId && item.userId === userId,
    );
    if (!bridge) {
      throw new NotFoundException("Bridge not found.");
    }
    return bridge;
  }

  private async authenticateBridge(bridgeId?: string, token?: string) {
    const store = await this.readStore();
    const bridge = store.bridges.find((item) => item.id === bridgeId);
    if (!bridge || !token || bridge.token !== token) {
      throw new UnauthorizedException("Invalid bridge token.");
    }
    return bridge;
  }

  private async findBridgeJob(bridgeId: string, jobId?: string) {
    if (!jobId) {
      throw new BadRequestException("jobId is required.");
    }
    const store = await this.readStore();
    const job = store.jobs.find(
      (item) => item.id === jobId && item.bridgeId === bridgeId,
    );
    if (!job) {
      throw new NotFoundException("Job not found.");
    }
    return job;
  }

  private async ensureStoreFile() {
    await mkdir(dirname(this.storePath), { recursive: true });

    try {
      await readFile(this.storePath, "utf-8");
    } catch {
      await writeFile(
        this.storePath,
        JSON.stringify(
          {
            bridges: [],
            jobs: [],
          } satisfies LocalBridgeStore,
          null,
          2,
        ),
        "utf-8",
      );
    }
  }

  private async readStore(): Promise<LocalBridgeStore> {
    const raw = await readFile(this.storePath, "utf-8");
    const parsed = JSON.parse(raw || "{}");
    return {
      bridges: Array.isArray(parsed.bridges) ? parsed.bridges : [],
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  }

  private async writeStore(store: LocalBridgeStore) {
    await writeFile(this.storePath, JSON.stringify(store, null, 2), "utf-8");
  }

  private async enqueueWrite(fn: () => Promise<void>) {
    this.writeQueue = this.writeQueue.then(fn, fn);
    await this.writeQueue;
  }
}
