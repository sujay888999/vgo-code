import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { ChatTeamRun, ChatTeamService } from "./chat-team.service";
import { ChatLocalBridgeService } from "./chat-local-bridge.service";

type TaskStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "running"
  | "completed"
  | "rejected";
type TaskPriority = "low" | "medium" | "high";
type ApprovalStatus = "not_required" | "pending" | "approved" | "rejected";

export interface WorkspaceTaskTemplate {
  id: string;
  name: string;
  description: string;
  suggestedTitle: string;
  suggestedBrief: string;
  suggestedPriority: TaskPriority;
  suggestedRequiresApproval: boolean;
  builtIn?: boolean;
}

interface CreateWorkspaceTaskInput {
  title?: string;
  brief?: string;
  priority?: TaskPriority;
  teamId?: string | null;
  requiresApproval?: boolean;
  ownerNote?: string;
  templateId?: string;
}

interface UpdateWorkspaceTaskInput extends CreateWorkspaceTaskInput {
  status?: TaskStatus;
}

const WORKSPACE_TEMPLATES: WorkspaceTaskTemplate[] = [
  {
    id: "research-brief",
    name: "Research Brief",
    description:
      "Use a team to research a topic, compare options, and produce a decision-ready brief.",
    suggestedTitle: "Research and recommendation brief",
    suggestedBrief:
      "Clarify the business question, compare the main options, identify risks, and return a short recommendation with next steps.",
    suggestedPriority: "medium",
    suggestedRequiresApproval: false,
  },
  {
    id: "ops-rollout",
    name: "Operations Rollout",
    description:
      "Plan and coordinate an execution-oriented rollout with timeline, owners, and checkpoints.",
    suggestedTitle: "Operations rollout plan",
    suggestedBrief:
      "Break the goal into rollout phases, owner responsibilities, timing, checkpoints, and a practical execution sequence.",
    suggestedPriority: "high",
    suggestedRequiresApproval: true,
  },
  {
    id: "customer-response",
    name: "Customer Response Pack",
    description:
      "Prepare a clear user-facing response with account context, options, and next actions.",
    suggestedTitle: "Customer guidance package",
    suggestedBrief:
      "Use available site context to explain the current situation, available options, recommended next actions, and user-facing wording.",
    suggestedPriority: "medium",
    suggestedRequiresApproval: false,
  },
  {
    id: "implementation-plan",
    name: "Implementation Plan",
    description:
      "Turn a product or engineering objective into an execution plan with dependencies and delivery order.",
    suggestedTitle: "Implementation execution plan",
    suggestedBrief:
      "Produce a structured implementation plan with milestones, dependencies, delivery order, testing, and risks.",
    suggestedPriority: "high",
    suggestedRequiresApproval: true,
  },
];

export interface WorkspaceTask {
  id: string;
  title: string;
  brief: string;
  priority: TaskPriority;
  status: TaskStatus;
  teamId: string | null;
  teamName: string | null;
  requiresApproval: boolean;
  approvalStatus: ApprovalStatus;
  ownerNote: string;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string | null;
  deliverableId?: string | null;
  latestSummary?: string | null;
}

export interface WorkspaceApproval {
  id: string;
  taskId: string;
  taskTitle: string;
  status: "pending" | "approved" | "rejected";
  requestedAt: string;
  decidedAt?: string | null;
  reviewerNote?: string;
}

export interface WorkspaceDeliverable {
  id: string;
  taskId: string;
  taskTitle: string;
  teamId: string | null;
  teamName: string | null;
  createdAt: string;
  updatedAt: string;
  summary: string;
  content: string;
  artifacts: Array<{
    id: string;
    label: string;
    type: "summary" | "plan" | "member-output";
    content: string;
  }>;
  steps: Array<{
    id: string;
    label: string;
    status: "completed" | "warning";
    summary: string;
    memberName?: string;
    toolLabels?: string[];
  }>;
  localActions: Array<{
    id: string;
    title: string;
    instruction: string;
    workingDirectory: string;
    source: "leader-plan" | "member-output" | "final-summary";
    status: "suggested" | "queued" | "running" | "completed" | "failed";
    bridgeId?: string | null;
    jobId?: string | null;
    resultSummary?: string | null;
    completedAt?: string | null;
    stdout?: string | null;
    stderr?: string | null;
    artifacts?: string[];
  }>;
  run: ChatTeamRun | null;
}

export interface WorkspaceActivity {
  id: string;
  taskId?: string | null;
  type:
    | "task_created"
    | "task_updated"
    | "approval_requested"
    | "approval_approved"
    | "approval_rejected"
    | "task_started"
    | "task_completed";
  message: string;
  createdAt: string;
}

interface WorkspaceUserBucket {
  tasks: WorkspaceTask[];
  approvals: WorkspaceApproval[];
  deliverables: WorkspaceDeliverable[];
  activity: WorkspaceActivity[];
}

interface WorkspaceStore {
  users: Record<string, WorkspaceUserBucket>;
}

interface WorkspaceTemplateStore {
  templates: WorkspaceTaskTemplate[];
}

@Injectable()
export class ChatWorkspaceService implements OnModuleInit {
  private readonly logger = new Logger(ChatWorkspaceService.name);
  private readonly storePath = join(
    process.cwd(),
    "data",
    "chat-workspace.json",
  );
  private readonly templateStorePath = join(
    process.cwd(),
    "data",
    "chat-workspace-templates.json",
  );
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly chatTeamService: ChatTeamService,
    private readonly chatLocalBridgeService: ChatLocalBridgeService,
  ) {}

  async onModuleInit() {
    await this.ensureStoreFile();
    await this.ensureTemplateStoreFile();
  }

  getTemplates() {
    return this.listTemplates();
  }

  async listTemplates() {
    const customTemplates = (await this.readTemplateStore()).templates;
    return [
      ...WORKSPACE_TEMPLATES.map((item) => ({ ...item, builtIn: true })),
      ...customTemplates.map((item) => ({ ...item, builtIn: false })),
    ];
  }

  async createTemplate(payload: Partial<WorkspaceTaskTemplate>) {
    const template = this.normalizeTemplate(payload);

    await this.enqueueWrite(async () => {
      const store = await this.readTemplateStore();
      store.templates.unshift(template);
      await this.writeTemplateStore(store);
    });

    return template;
  }

  async updateTemplate(
    templateId: string,
    payload: Partial<WorkspaceTaskTemplate>,
  ) {
    const store = await this.readTemplateStore();
    const existing = store.templates.find((item) => item.id === templateId);
    if (!existing) {
      throw new NotFoundException("Template not found.");
    }

    const updated = this.normalizeTemplate({
      ...existing,
      ...payload,
      id: existing.id,
    });

    await this.enqueueWrite(async () => {
      const writable = await this.readTemplateStore();
      writable.templates = writable.templates.map((item) =>
        item.id === templateId ? updated : item,
      );
      await this.writeTemplateStore(writable);
    });

    return updated;
  }

  async deleteTemplate(templateId: string) {
    const store = await this.readTemplateStore();
    const existing = store.templates.find((item) => item.id === templateId);
    if (!existing) {
      throw new NotFoundException("Template not found.");
    }

    await this.enqueueWrite(async () => {
      const writable = await this.readTemplateStore();
      writable.templates = writable.templates.filter(
        (item) => item.id !== templateId,
      );
      await this.writeTemplateStore(writable);
    });
  }

  private normalizeTemplate(
    payload: Partial<WorkspaceTaskTemplate>,
  ): WorkspaceTaskTemplate {
    const name = String(payload.name || "").trim();
    const description = String(payload.description || "").trim();
    const suggestedTitle = String(payload.suggestedTitle || "").trim();
    const suggestedBrief = String(payload.suggestedBrief || "").trim();

    if (!name || !description || !suggestedTitle || !suggestedBrief) {
      throw new BadRequestException(
        "Template name, description, title, and brief are required.",
      );
    }

    return {
      id: String(payload.id || randomUUID()),
      name,
      description,
      suggestedTitle,
      suggestedBrief,
      suggestedPriority: this.normalizePriority(payload.suggestedPriority),
      suggestedRequiresApproval: Boolean(payload.suggestedRequiresApproval),
    };
  }

  async getOverview(userId: string) {
    const bucket = await this.getBucket(userId);
    const pendingApprovals = bucket.approvals.filter(
      (item) => item.status === "pending",
    ).length;
    const runningTasks = bucket.tasks.filter(
      (item) => item.status === "running",
    ).length;
    const completedTasks = bucket.tasks.filter(
      (item) => item.status === "completed",
    ).length;

    return {
      metrics: {
        totalTasks: bucket.tasks.length,
        pendingApprovals,
        runningTasks,
        completedTasks,
        deliverables: bucket.deliverables.length,
        activeTeams: Array.from(
          new Set(bucket.tasks.map((item) => item.teamId).filter(Boolean)),
        ).length,
      },
      recentActivity: bucket.activity.slice(0, 10),
    };
  }

  async listTasks(userId: string) {
    const bucket = await this.getBucket(userId);
    return bucket.tasks;
  }

  async getTask(userId: string, taskId: string) {
    return this.findTask(userId, taskId);
  }

  async createTask(userId: string, payload: CreateWorkspaceTaskInput) {
    const task = await this.buildTask(userId, payload);
    const approval = task.requiresApproval ? this.buildApproval(task) : null;

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      const bucket = this.ensureUserBucket(store, userId);
      bucket.tasks.unshift(task);

      if (approval) {
        bucket.approvals.unshift(approval);
        bucket.activity.unshift(
          this.createActivity(
            task.id,
            "approval_requested",
            `Approval requested for "${task.title}".`,
          ),
        );
      }

      bucket.activity.unshift(
        this.createActivity(
          task.id,
          "task_created",
          `Task "${task.title}" created.`,
        ),
      );
      await this.writeStore(store);
    });

    return { task, approval };
  }

  async updateTask(
    userId: string,
    taskId: string,
    payload: UpdateWorkspaceTaskInput,
  ) {
    const existing = await this.findTask(userId, taskId);
    const team = payload.teamId
      ? await this.chatTeamService.getTeam(userId, payload.teamId)
      : null;
    const requiresApproval =
      typeof payload.requiresApproval === "boolean"
        ? payload.requiresApproval
        : existing.requiresApproval;
    const approvalStatus = requiresApproval
      ? existing.approvalStatus === "approved"
        ? "approved"
        : existing.approvalStatus === "rejected"
          ? "rejected"
          : "pending"
      : "not_required";

    const updated: WorkspaceTask = {
      ...existing,
      title: String(payload.title ?? existing.title).trim() || existing.title,
      brief: String(payload.brief ?? existing.brief).trim(),
      priority: (payload.priority as TaskPriority) || existing.priority,
      status:
        (payload.status as TaskStatus) ||
        this.deriveTaskStatus(
          existing.status,
          requiresApproval,
          approvalStatus,
        ),
      teamId:
        typeof payload.teamId === "undefined"
          ? existing.teamId
          : team?.id || null,
      teamName:
        typeof payload.teamId === "undefined"
          ? existing.teamName
          : team?.name || null,
      requiresApproval,
      approvalStatus,
      ownerNote: String(payload.ownerNote ?? (existing.ownerNote || "")).trim(),
      updatedAt: new Date().toISOString(),
    };

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      const bucket = this.ensureUserBucket(store, userId);
      bucket.tasks = bucket.tasks.map((item) =>
        item.id === taskId ? updated : item,
      );
      bucket.approvals = this.syncApprovalRecords(bucket.approvals, updated);
      bucket.activity.unshift(
        this.createActivity(
          taskId,
          "task_updated",
          `Task "${updated.title}" updated.`,
        ),
      );
      await this.writeStore(store);
    });

    return updated;
  }

  async runTask(userId: string, taskId: string) {
    const task = await this.findTask(userId, taskId);
    if (!task.teamId) {
      throw new BadRequestException(
        "Please assign a team before running this task.",
      );
    }
    if (task.requiresApproval && task.approvalStatus !== "approved") {
      throw new BadRequestException("This task is waiting for approval.");
    }

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      const bucket = this.ensureUserBucket(store, userId);
      bucket.tasks = bucket.tasks.map((item) =>
        item.id === taskId
          ? {
              ...item,
              status: "running",
              updatedAt: new Date().toISOString(),
              lastRunAt: new Date().toISOString(),
            }
          : item,
      );
      bucket.activity.unshift(
        this.createActivity(
          taskId,
          "task_started",
          `Task "${task.title}" started.`,
        ),
      );
      await this.writeStore(store);
    });

    const result = await this.chatTeamService.runTeamTask(
      userId,
      task.teamId,
      `${task.title}\n\n${task.brief}`.trim(),
    );
    const deliverable = this.buildDeliverable(
      task,
      result.team.name,
      result.run,
    );

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      const bucket = this.ensureUserBucket(store, userId);
      bucket.deliverables.unshift(deliverable);
      bucket.tasks = bucket.tasks.map((item) =>
        item.id === taskId
          ? {
              ...item,
              status: "completed",
              updatedAt: new Date().toISOString(),
              lastRunAt: deliverable.createdAt,
              deliverableId: deliverable.id,
              latestSummary: deliverable.summary,
            }
          : item,
      );
      bucket.activity.unshift(
        this.createActivity(
          taskId,
          "task_completed",
          `Task "${task.title}" completed.`,
        ),
      );
      await this.writeStore(store);
    });

    return {
      task: await this.findTask(userId, taskId),
      deliverable,
      run: result.run,
    };
  }

  async listApprovals(userId: string) {
    const bucket = await this.getBucket(userId);
    return bucket.approvals;
  }

  async decideApproval(
    userId: string,
    approvalId: string,
    decision: "approved" | "rejected",
    reviewerNote?: string,
  ) {
    const bucket = await this.getBucket(userId);
    const approval = bucket.approvals.find((item) => item.id === approvalId);
    if (!approval) {
      throw new NotFoundException("Approval not found.");
    }

    const decidedAt = new Date().toISOString();
    const updatedApproval: WorkspaceApproval = {
      ...approval,
      status: decision,
      decidedAt,
      reviewerNote: String(reviewerNote || "").trim(),
    };

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      const writableBucket = this.ensureUserBucket(store, userId);
      writableBucket.approvals = writableBucket.approvals.map((item) =>
        item.id === approvalId ? updatedApproval : item,
      );
      writableBucket.tasks = writableBucket.tasks.map((item) =>
        item.id === approval.taskId
          ? {
              ...item,
              approvalStatus: decision,
              status: decision === "approved" ? "approved" : "rejected",
              updatedAt: decidedAt,
            }
          : item,
      );
      writableBucket.activity.unshift(
        this.createActivity(
          approval.taskId,
          decision === "approved" ? "approval_approved" : "approval_rejected",
          `Task "${approval.taskTitle}" ${decision}.`,
        ),
      );
      await this.writeStore(store);
    });

    return updatedApproval;
  }

  async listDeliverables(userId: string) {
    const bucket = await this.getBucket(userId);
    return this.hydrateDeliverables(userId, bucket.deliverables);
  }

  async exportDeliverable(userId: string, deliverableId: string) {
    const deliverable = await this.getDeliverable(userId, deliverableId);

    const slug =
      deliverable.taskTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "workspace-deliverable";

    const lines = [
      `# ${deliverable.taskTitle}`,
      "",
      `- Team: ${deliverable.teamName || "Unassigned"}`,
      `- Created: ${deliverable.createdAt}`,
      "",
      "## Executive Summary",
      "",
      deliverable.content,
      "",
      "## Execution Steps",
      "",
      ...deliverable.steps.flatMap((step) => [
        `### ${step.label}`,
        `- Status: ${step.status}`,
        ...(step.memberName ? [`- Member: ${step.memberName}`] : []),
        ...(step.toolLabels?.length
          ? [`- Tools: ${step.toolLabels.join(", ")}`]
          : []),
        "",
        step.summary,
        "",
      ]),
      "## Artifacts",
      "",
      ...deliverable.artifacts.flatMap((artifact) => [
        `### ${artifact.label}`,
        `- Type: ${artifact.type}`,
        "",
        artifact.content,
        "",
      ]),
      "## Local Actions",
      "",
      ...deliverable.localActions.flatMap((action) => [
        `### ${action.title}`,
        `- Source: ${action.source}`,
        `- Status: ${action.status}`,
        `- Working directory: ${action.workingDirectory}`,
        ...(action.bridgeId ? [`- Bridge: ${action.bridgeId}`] : []),
        ...(action.jobId ? [`- Job: ${action.jobId}`] : []),
        "",
        action.instruction,
        "",
      ]),
    ];

    return {
      filename: `${slug}.md`,
      content: lines.join("\n").trim(),
    };
  }

  async getDeliverable(userId: string, deliverableId: string) {
    const bucket = await this.getBucket(userId);
    const deliverable = bucket.deliverables.find(
      (item) => item.id === deliverableId,
    );
    if (!deliverable) {
      throw new NotFoundException("Deliverable not found.");
    }
    const [hydrated] = await this.hydrateDeliverables(userId, [deliverable]);
    return hydrated;
  }

  async queueLocalActions(
    userId: string,
    deliverableId: string,
    bridgeId: string,
  ) {
    const deliverable = await this.getDeliverable(userId, deliverableId);
    const actionsToQueue = deliverable.localActions.filter(
      (item) => item.status === "suggested" || item.status === "failed",
    );
    if (!actionsToQueue.length) {
      throw new BadRequestException("No local actions are available to queue.");
    }

    const queued = [];
    for (const action of actionsToQueue) {
      const job = await this.chatLocalBridgeService.enqueueJob(
        userId,
        bridgeId,
        {
          title: action.title,
          instruction: action.instruction,
          workingDirectory: action.workingDirectory,
        },
      );
      queued.push({ actionId: action.id, jobId: job.id });
    }

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      const bucket = this.ensureUserBucket(store, userId);
      bucket.deliverables = bucket.deliverables.map((item) =>
        item.id === deliverableId
          ? {
              ...item,
              updatedAt: new Date().toISOString(),
              localActions: item.localActions.map((action) => {
                const matched = queued.find(
                  (queuedItem) => queuedItem.actionId === action.id,
                );
                if (!matched) return action;
                return {
                  ...action,
                  status: "queued" as const,
                  bridgeId,
                  jobId: matched.jobId,
                  resultSummary: null,
                  completedAt: null,
                  stdout: null,
                  stderr: null,
                  artifacts: [],
                };
              }),
            }
          : item,
      );
      bucket.activity.unshift(
        this.createActivity(
          deliverable.taskId,
          "task_updated",
          `Queued ${queued.length} local actions for "${deliverable.taskTitle}".`,
        ),
      );
      await this.writeStore(store);
    });

    return this.getDeliverable(userId, deliverableId);
  }

  private async buildTask(
    userId: string,
    payload: CreateWorkspaceTaskInput,
  ): Promise<WorkspaceTask> {
    const template = payload.templateId
      ? (await this.listTemplates()).find(
          (item) => item.id === payload.templateId,
        )
      : undefined;
    const title = String(
      payload.title || template?.suggestedTitle || "",
    ).trim();
    if (!title) {
      throw new BadRequestException("Task title is required.");
    }

    const team = payload.teamId
      ? await this.chatTeamService.getTeam(userId, payload.teamId)
      : null;
    const requiresApproval =
      typeof payload.requiresApproval === "boolean"
        ? payload.requiresApproval
        : Boolean(template?.suggestedRequiresApproval);
    const now = new Date().toISOString();

    return {
      id: randomUUID(),
      title,
      brief: String(payload.brief || template?.suggestedBrief || "").trim(),
      priority: this.normalizePriority(
        payload.priority || template?.suggestedPriority,
      ),
      status: requiresApproval ? "pending_approval" : "draft",
      teamId: team?.id || null,
      teamName: team?.name || null,
      requiresApproval,
      approvalStatus: requiresApproval ? "pending" : "not_required",
      ownerNote: String(payload.ownerNote || "").trim(),
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      deliverableId: null,
      latestSummary: null,
    };
  }

  private buildApproval(task: WorkspaceTask): WorkspaceApproval {
    return {
      id: randomUUID(),
      taskId: task.id,
      taskTitle: task.title,
      status: "pending",
      requestedAt: new Date().toISOString(),
      decidedAt: null,
      reviewerNote: "",
    };
  }

  private buildDeliverable(
    task: WorkspaceTask,
    teamName: string,
    run: ChatTeamRun,
  ): WorkspaceDeliverable {
    const now = new Date().toISOString();
    const artifacts: WorkspaceDeliverable["artifacts"] = [
      {
        id: randomUUID(),
        label: "Final summary",
        type: "summary",
        content: run.finalSummary,
      },
      {
        id: randomUUID(),
        label: "Leader plan",
        type: "plan",
        content: run.leaderPlan,
      },
      ...run.memberOutputs.map((item) => ({
        id: randomUUID(),
        label: `${item.name} - ${item.roleTitle}`,
        type: "member-output" as const,
        content: item.output,
      })),
    ];

    const steps: WorkspaceDeliverable["steps"] = [
      {
        id: randomUUID(),
        label: "Leader planning",
        status: "completed",
        summary: run.leaderPlan,
      },
      ...run.memberOutputs.map((item) => ({
        id: randomUUID(),
        label: `${item.roleTitle} execution`,
        status: item.output.startsWith("This member failed")
          ? ("warning" as const)
          : ("completed" as const),
        summary: item.executionNote || item.assignment,
        memberName: item.name,
        toolLabels:
          item.toolTraces?.map((trace) => trace.label).filter(Boolean) || [],
      })),
      {
        id: randomUUID(),
        label: "Final synthesis",
        status: "completed",
        summary: run.finalSummary.slice(0, 240),
      },
    ];

    const localActions: WorkspaceDeliverable["localActions"] =
      this.buildLocalActions(task, run);

    return {
      id: randomUUID(),
      taskId: task.id,
      taskTitle: task.title,
      teamId: task.teamId,
      teamName: teamName || task.teamName,
      createdAt: now,
      updatedAt: now,
      summary: run.finalSummary.slice(0, 280),
      content: run.finalSummary,
      artifacts,
      steps,
      localActions,
      run,
    };
  }

  private buildLocalActions(
    task: WorkspaceTask,
    run: ChatTeamRun,
  ): WorkspaceDeliverable["localActions"] {
    const workingDirectory = "E:\\api-platform网站平台";
    const actions: WorkspaceDeliverable["localActions"] = [
      {
        id: randomUUID(),
        title: `${task.title} - execution summary`,
        instruction: [
          `Use the approved deliverable for task "${task.title}".`,
          "Create a markdown file named workspace-deliverable-summary.md in the working directory.",
          "Summarize the final deliverable, member contributions, and next steps in Chinese.",
          "",
          run.finalSummary,
        ].join("\n"),
        workingDirectory,
        source: "final-summary",
        status: "suggested",
        bridgeId: null,
        jobId: null,
        resultSummary: null,
        completedAt: null,
        stdout: null,
        stderr: null,
        artifacts: [],
      },
      {
        id: randomUUID(),
        title: `${task.title} - leader plan breakdown`,
        instruction: [
          `Use the leader plan for task "${task.title}".`,
          "Create a markdown checklist file named workspace-action-checklist.md.",
          "Convert the plan into an ordered checklist with clear file outputs or follow-up steps.",
          "",
          run.leaderPlan,
        ].join("\n"),
        workingDirectory,
        source: "leader-plan",
        status: "suggested",
        bridgeId: null,
        jobId: null,
        resultSummary: null,
        completedAt: null,
        stdout: null,
        stderr: null,
        artifacts: [],
      },
      ...run.memberOutputs.slice(0, 3).map((item) => ({
        id: randomUUID(),
        title: `${task.title} - ${item.name} contribution`,
        instruction: [
          `Use the contribution from ${item.name} (${item.roleTitle}) for task "${task.title}".`,
          "Create a markdown note file for this member contribution and highlight concrete execution steps.",
          "If the contribution contains tools or models, preserve them as references.",
          "",
          item.output,
        ].join("\n"),
        workingDirectory,
        source: "member-output" as const,
        status: "suggested" as const,
        bridgeId: null,
        jobId: null,
        resultSummary: null,
        completedAt: null,
        stdout: null,
        stderr: null,
        artifacts: [],
      })),
    ];

    return actions;
  }

  private async hydrateDeliverables(
    userId: string,
    deliverables: WorkspaceDeliverable[],
  ) {
    const jobMap = await this.chatLocalBridgeService.getJobMap(userId);
    return deliverables.map((deliverable) => ({
      ...deliverable,
      localActions: deliverable.localActions.map((action) => {
        const job = action.jobId ? jobMap.get(action.jobId) : null;
        if (!job) {
          return action;
        }

        return {
          ...action,
          status: job.status,
          resultSummary: job.resultSummary || null,
          completedAt: job.completedAt || null,
          stdout: job.stdout || null,
          stderr: job.stderr || null,
          artifacts: Array.isArray(job.artifacts) ? job.artifacts : [],
        };
      }),
    }));
  }

  private deriveTaskStatus(
    currentStatus: TaskStatus,
    requiresApproval: boolean,
    approvalStatus: ApprovalStatus,
  ): TaskStatus {
    if (requiresApproval) {
      if (approvalStatus === "approved")
        return currentStatus === "completed" ? currentStatus : "approved";
      if (approvalStatus === "rejected") return "rejected";
      return "pending_approval";
    }
    if (
      currentStatus === "pending_approval" ||
      currentStatus === "approved" ||
      currentStatus === "rejected"
    ) {
      return "draft";
    }
    return currentStatus;
  }

  private syncApprovalRecords(
    approvals: WorkspaceApproval[],
    task: WorkspaceTask,
  ): WorkspaceApproval[] {
    const existing = approvals.find((item) => item.taskId === task.id);
    if (!task.requiresApproval) {
      return approvals.filter((item) => item.taskId !== task.id);
    }
    if (existing) {
      return approvals.map(
        (item): WorkspaceApproval =>
          item.taskId === task.id
            ? {
                ...item,
                taskTitle: task.title,
                status:
                  task.approvalStatus === "approved"
                    ? "approved"
                    : task.approvalStatus === "rejected"
                      ? "rejected"
                      : "pending",
              }
            : item,
      );
    }
    return [this.buildApproval(task), ...approvals];
  }

  private normalizePriority(priority?: string): TaskPriority {
    return priority === "low" || priority === "high" ? priority : "medium";
  }

  private createActivity(
    taskId: string | null,
    type: WorkspaceActivity["type"],
    message: string,
  ): WorkspaceActivity {
    return {
      id: randomUUID(),
      taskId,
      type,
      message,
      createdAt: new Date().toISOString(),
    };
  }

  private async findTask(userId: string, taskId: string) {
    const bucket = await this.getBucket(userId);
    const task = bucket.tasks.find((item) => item.id === taskId);
    if (!task) {
      throw new NotFoundException("Task not found.");
    }
    return task;
  }

  private async getBucket(userId: string) {
    const store = await this.readStore();
    return this.ensureUserBucket(store, userId);
  }

  private ensureUserBucket(store: WorkspaceStore, userId: string) {
    if (!store.users[userId]) {
      store.users[userId] = {
        tasks: [],
        approvals: [],
        deliverables: [],
        activity: [],
      };
    }
    return store.users[userId];
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

  private async ensureTemplateStoreFile() {
    await mkdir(dirname(this.templateStorePath), { recursive: true });

    try {
      await readFile(this.templateStorePath, "utf8");
    } catch {
      await writeFile(
        this.templateStorePath,
        JSON.stringify({ templates: [] }, null, 2),
        "utf8",
      );
    }
  }

  private async readStore(): Promise<WorkspaceStore> {
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
        `Failed to read workspace store, using empty store: ${String(error)}`,
      );
      return { users: {} };
    }
  }

  private async writeStore(store: WorkspaceStore) {
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(store, null, 2), "utf8");
  }

  private async readTemplateStore(): Promise<WorkspaceTemplateStore> {
    await this.ensureTemplateStoreFile();

    try {
      const raw = await readFile(this.templateStorePath, "utf8");
      const parsed = JSON.parse(raw);
      return {
        templates: Array.isArray(parsed?.templates) ? parsed.templates : [],
      };
    } catch (error) {
      this.logger.warn(
        `Failed to read workspace template store, using empty store: ${String(error)}`,
      );
      return { templates: [] };
    }
  }

  private async writeTemplateStore(store: WorkspaceTemplateStore) {
    await mkdir(dirname(this.templateStorePath), { recursive: true });
    await writeFile(
      this.templateStorePath,
      JSON.stringify(store, null, 2),
      "utf8",
    );
  }

  private async enqueueWrite(task: () => Promise<void>) {
    let writeError: unknown = null;

    this.writeQueue = this.writeQueue.then(task).catch((error) => {
      writeError = error;
      this.logger.error(`Failed to persist chat workspace: ${String(error)}`);
    });

    await this.writeQueue;

    if (writeError) {
      throw writeError;
    }
  }
}
