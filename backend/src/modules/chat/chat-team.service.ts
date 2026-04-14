import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";
import { Repository } from "typeorm";
import { User } from "../user/user.entity";
import { GatewayService } from "../gateway/gateway.service";
import { AgentToolTrace, ChatAgentService } from "./chat-agent.service";
import { getChatSkillById } from "./chat-skill-registry";

interface TeamMemberInput {
  id?: string;
  name: string;
  roleTitle: string;
  model: string;
  skillId: string;
  responsibility?: string;
  isLead?: boolean;
}

export interface ChatTeamMember {
  id: string;
  name: string;
  roleTitle: string;
  model: string;
  skillId: string;
  responsibility: string;
  isLead: boolean;
}

export interface ChatTeamRunMemberOutput {
  memberId: string;
  name: string;
  roleTitle: string;
  model: string;
  skillId: string;
  assignment: string;
  output: string;
  cost: number;
  attemptedModels: string[];
  usedFallbackModel: boolean;
  executionNote?: string;
  executionMode: "completion" | "agent";
  toolTraces: AgentToolTrace[];
}

export interface ChatTeamRun {
  id: string;
  task: string;
  createdAt: string;
  leaderId: string;
  leaderPlan: string;
  assignments: Array<{ memberId: string; assignment: string }>;
  memberOutputs: ChatTeamRunMemberOutput[];
  finalSummary: string;
  totalCost: number;
  modelsUsed: string[];
}

export interface ChatTeamRecord {
  id: string;
  name: string;
  description: string;
  members: ChatTeamMember[];
  createdAt: string;
  updatedAt: string;
  lastRun?: ChatTeamRun | null;
}

interface TeamStore {
  users: Record<string, { teams: ChatTeamRecord[] }>;
}

interface PlanningResult {
  leaderPlan: string;
  assignments: Array<{ memberId: string; assignment: string }>;
}

interface ModelExecutionResult {
  content: string;
  model: string;
  cost: number;
  attemptedModels: string[];
  usedFallbackModel: boolean;
  executionNote?: string;
  executionMode: "completion" | "agent";
  toolTraces: AgentToolTrace[];
}

const MIN_TEAM_MEMBERS = 2;
const MAX_TEAM_MEMBERS = 6;
const MAX_MODEL_ATTEMPTS = 3;

@Injectable()
export class ChatTeamService implements OnModuleInit {
  private readonly logger = new Logger(ChatTeamService.name);
  private readonly storePath = join(process.cwd(), "data", "chat-teams.json");
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly gatewayService: GatewayService,
    private readonly chatAgentService: ChatAgentService,
  ) {}

  async onModuleInit() {
    await this.ensureStoreFile();
  }

  async listTeams(userId: string) {
    const store = await this.readStore();
    return store.users[userId]?.teams || [];
  }

  async getTeam(userId: string, teamId: string) {
    return this.findTeam(userId, teamId);
  }

  async createTeam(
    userId: string,
    payload: {
      name?: string;
      description?: string;
      members?: TeamMemberInput[];
    },
  ) {
    const team = this.buildTeamRecord(payload);

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      const bucket = this.ensureUserBucket(store, userId);
      bucket.teams.unshift(team);
      await this.writeStore(store);
    });

    return team;
  }

  async updateTeam(
    userId: string,
    teamId: string,
    payload: {
      name?: string;
      description?: string;
      members?: TeamMemberInput[];
    },
  ) {
    const existing = await this.findTeam(userId, teamId);
    const updated: ChatTeamRecord = {
      ...existing,
      name: this.normalizeName(payload.name ?? existing.name),
      description: String(
        payload.description ?? existing.description ?? "",
      ).trim(),
      members: this.normalizeMembers(payload.members ?? existing.members),
      updatedAt: new Date().toISOString(),
    };

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      const bucket = this.ensureUserBucket(store, userId);
      bucket.teams = bucket.teams.map((team) =>
        team.id === teamId ? updated : team,
      );
      await this.writeStore(store);
    });

    return updated;
  }

  async deleteTeam(userId: string, teamId: string) {
    await this.findTeam(userId, teamId);

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      const bucket = this.ensureUserBucket(store, userId);
      bucket.teams = bucket.teams.filter((team) => team.id !== teamId);
      await this.writeStore(store);
    });
  }

  async runTeamTask(userId: string, teamId: string, task: string) {
    const trimmedTask = String(task || "").trim();
    if (!trimmedTask) {
      throw new BadRequestException("Task content is required.");
    }

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new NotFoundException("User not found");
    }

    const team = await this.findTeam(userId, teamId);
    const leader =
      team.members.find((member) => member.isLead) || team.members[0];
    const planning = await this.buildPlan(user, team, leader, trimmedTask);

    const memberOutputs = await Promise.all(
      team.members.map(async (member) => {
        const assignment =
          planning.assignments.find((item) => item.memberId === member.id)
            ?.assignment ||
          `${member.roleTitle}: provide the part of the delivery that fits your responsibility.`;

        try {
          const completion = await this.executeMemberTask(
            user,
            team.name,
            trimmedTask,
            planning.leaderPlan,
            member,
            assignment,
          );

          return {
            memberId: member.id,
            name: member.name,
            roleTitle: member.roleTitle,
            model: completion.model,
            skillId: member.skillId,
            assignment,
            output: completion.content,
            cost: completion.cost,
            attemptedModels: completion.attemptedModels,
            usedFallbackModel: completion.usedFallbackModel,
            executionNote: completion.executionNote,
            executionMode: completion.executionMode,
            toolTraces: completion.toolTraces,
          } satisfies ChatTeamRunMemberOutput;
        } catch (error: any) {
          this.logger.warn(
            `Team member ${member.name} failed: ${String(error?.message || error)}`,
          );
          return {
            memberId: member.id,
            name: member.name,
            roleTitle: member.roleTitle,
            model: member.model,
            skillId: member.skillId,
            assignment,
            output: `This member failed during execution: ${String(error?.message || "model execution failed")}`,
            cost: 0,
            attemptedModels: [member.model],
            usedFallbackModel: false,
            executionNote:
              "No usable result was produced. Check the upstream model or switch this role to a more stable model.",
            executionMode: "completion",
            toolTraces: [],
          } satisfies ChatTeamRunMemberOutput;
        }
      }),
    );

    const finalCompletion = await this.requestModelWithFallback(leader.model, [
      {
        role: "system",
        content: this.buildLeaderSummaryPrompt(user.isAdmin, leader),
      },
      {
        role: "user",
        content: [
          `Team name: ${team.name}`,
          `Main task: ${trimmedTask}`,
          `Leader plan: ${planning.leaderPlan}`,
          "Member outputs:",
          ...memberOutputs.map(
            (item, index) =>
              `${index + 1}. ${item.name} / ${item.roleTitle}\nAssignment: ${item.assignment}\nModel: ${item.model}\nMode: ${item.executionMode}\nNote: ${item.executionNote || "-"}\nOutput:\n${item.output}`,
          ),
          "Please synthesize a final deliverable in Chinese with: overall conclusion, member contributions, recommended execution order, main risks, and next steps.",
        ].join("\n\n"),
      },
    ]);

    const run: ChatTeamRun = {
      id: randomUUID(),
      task: trimmedTask,
      createdAt: new Date().toISOString(),
      leaderId: leader.id,
      leaderPlan: planning.leaderPlan,
      assignments: planning.assignments,
      memberOutputs,
      finalSummary: finalCompletion.content,
      totalCost: Number(
        (
          memberOutputs.reduce((sum, item) => sum + Number(item.cost || 0), 0) +
          Number(finalCompletion.cost || 0)
        ).toFixed(6),
      ),
      modelsUsed: Array.from(
        new Set(
          memberOutputs
            .flatMap((item) => item.attemptedModels)
            .concat(finalCompletion.attemptedModels),
        ),
      ),
    };

    const updatedTeam: ChatTeamRecord = {
      ...team,
      updatedAt: new Date().toISOString(),
      lastRun: run,
    };

    await this.enqueueWrite(async () => {
      const store = await this.readStore();
      const bucket = this.ensureUserBucket(store, userId);
      bucket.teams = bucket.teams.map((item) =>
        item.id === teamId ? updatedTeam : item,
      );
      await this.writeStore(store);
    });

    return {
      team: updatedTeam,
      run,
    };
  }

  private async buildPlan(
    user: User,
    team: ChatTeamRecord,
    leader: ChatTeamMember,
    task: string,
  ): Promise<PlanningResult> {
    const completion = await this.requestModelWithFallback(leader.model, [
      {
        role: "system",
        content: this.buildLeaderPlanningPrompt(user.isAdmin, leader),
      },
      {
        role: "user",
        content: [
          `Team name: ${team.name}`,
          `Team description: ${team.description || "None"}`,
          `Goal: ${task}`,
          "Members:",
          ...team.members.map(
            (member) =>
              `- memberId=${member.id}; name=${member.name}; role=${member.roleTitle}; responsibility=${member.responsibility || member.roleTitle}; skill=${member.skillId}; model=${member.model}`,
          ),
          "Return strict JSON only with this format:",
          JSON.stringify(
            {
              leaderPlan: "1-3 sentence execution plan",
              assignments: team.members.map((member) => ({
                memberId: member.id,
                assignment: `${member.roleTitle} should handle the part that matches the role`,
              })),
            },
            null,
            2,
          ),
        ].join("\n"),
      },
    ]);

    return this.parsePlanningResult(completion.content, team.members);
  }

  private parsePlanningResult(
    content: string,
    members: ChatTeamMember[],
  ): PlanningResult {
    const fallbackAssignments = members.map((member) => ({
      memberId: member.id,
      assignment: `${member.roleTitle}: push the task forward from the angle of ${member.responsibility || member.roleTitle}.`,
    }));

    try {
      const parsed = JSON.parse(this.extractJson(content));
      const assignments = Array.isArray(parsed?.assignments)
        ? members.map((member) => {
            const matched = parsed.assignments.find(
              (item: any) => item?.memberId === member.id,
            );
            return {
              memberId: member.id,
              assignment:
                String(matched?.assignment || "").trim() ||
                `${member.roleTitle}: push the task forward from the angle of ${member.responsibility || member.roleTitle}.`,
            };
          })
        : fallbackAssignments;

      return {
        leaderPlan:
          String(parsed?.leaderPlan || "").trim() ||
          "The leader has decomposed the task and distributed work.",
        assignments,
      };
    } catch {
      return {
        leaderPlan:
          content.trim() ||
          "The leader has decomposed the task and distributed work.",
        assignments: fallbackAssignments,
      };
    }
  }

  private extractJson(content: string) {
    const trimmed = String(content || "").trim();
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return trimmed.slice(start, end + 1);
    }
    return trimmed;
  }

  private buildLeaderPlanningPrompt(isAdmin: boolean, member: ChatTeamMember) {
    const skill = getChatSkillById(member.skillId, isAdmin);
    return [
      `You are the team lead ${member.name}, role ${member.roleTitle}.`,
      isAdmin
        ? "The current owner is an admin, so planning can include platform operations or diagnostics."
        : "The current owner is a regular user, so planning should stay practical and business-focused.",
      skill.teamRolePrompt || "",
      "Your job is to decompose the work, assign it clearly, and keep the team output deliverable-focused.",
      "Do not do all the work yourself in this step.",
      ...(skill.teamOutputRules || []).map((item) => `Rule: ${item}`),
    ]
      .filter(Boolean)
      .join(" ");
  }

  private buildLeaderSummaryPrompt(isAdmin: boolean, member: ChatTeamMember) {
    const skill = getChatSkillById(member.skillId, isAdmin);
    return [
      `You are the team lead ${member.name}, role ${member.roleTitle}.`,
      skill.teamRolePrompt || "",
      "Combine all member contributions into one final delivery in Chinese.",
      "Be concrete, structured, and execution-oriented.",
      "If one member failed, say so clearly and suggest a fallback path.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  private buildMemberSystemPrompt(isAdmin: boolean, member: ChatTeamMember) {
    const skill = getChatSkillById(member.skillId, isAdmin);

    return [
      `You are digital employee ${member.name}.`,
      `Your role is ${member.roleTitle}.`,
      `Your responsibility is ${member.responsibility || member.roleTitle}.`,
      skill.teamRolePrompt || "",
      `Style reference skill "${skill.name}": ${skill.systemPrompt}`,
      "You are part of a team. Complete only your assigned portion of the work.",
      ...(skill.teamOutputRules || []).map((item) => `Output rule: ${item}`),
      "Avoid filler. Return concrete conclusions, plans, or structured output.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  private async executeMemberTask(
    user: User,
    teamName: string,
    trimmedTask: string,
    leaderPlan: string,
    member: ChatTeamMember,
    assignment: string,
  ): Promise<ModelExecutionResult> {
    const skill = getChatSkillById(member.skillId, user.isAdmin);
    if (!skill.allowedTools.length) {
      return this.requestModelWithFallback(member.model, [
        {
          role: "system",
          content: this.buildMemberSystemPrompt(user.isAdmin, member),
        },
        {
          role: "user",
          content: this.buildMemberTaskPrompt(
            teamName,
            trimmedTask,
            leaderPlan,
            member,
            assignment,
          ),
        },
      ]);
    }

    const fallbackCandidates = await this.buildFallbackModelList(member.model);
    const attemptedModels: string[] = [];
    const errors: string[] = [];

    for (const model of fallbackCandidates) {
      attemptedModels.push(model);

      try {
        const result = await this.chatAgentService.runAgent({
          user,
          model,
          skillId: member.skillId,
          messages: [
            {
              role: "user",
              content: [
                `You are working inside a digital employee team.`,
                `Team name: ${teamName}`,
                `Main task: ${trimmedTask}`,
                `Leader plan: ${leaderPlan}`,
                `Your role: ${member.roleTitle}`,
                `Your responsibility: ${member.responsibility || member.roleTitle}`,
                `Assigned work: ${assignment}`,
                `Use tools when useful and return your real contribution in Chinese.`,
              ].join("\n"),
            },
          ],
        });

        return {
          content: result.content,
          model: result.model || model,
          cost: Number(result.cost || 0),
          attemptedModels: [...attemptedModels],
          usedFallbackModel: model !== member.model,
          executionNote:
            model !== member.model
              ? `Primary worker model ${member.model} failed, switched to ${result.model || model}.`
              : result.usedTools?.length
                ? `Worker used ${result.usedTools.length} tool call(s).`
                : "Worker completed without needing additional tools.",
          executionMode: "agent",
          toolTraces: result.toolTraces || [],
        };
      } catch (error: any) {
        errors.push(
          `${model}: ${String(error?.message || error || "agent worker failed")}`,
        );
      }
    }

    throw new BadRequestException(
      `All worker agent attempts failed: ${errors.join(" | ")}`,
    );
  }

  private buildMemberTaskPrompt(
    teamName: string,
    trimmedTask: string,
    leaderPlan: string,
    member: ChatTeamMember,
    assignment: string,
  ) {
    return [
      `Team name: ${teamName}`,
      `Main task: ${trimmedTask}`,
      `Leader plan: ${leaderPlan}`,
      `Your responsibility: ${member.responsibility || member.roleTitle}`,
      `Assigned work: ${assignment}`,
      "Return your contribution in Chinese with clear conclusions, steps, risks, and next actions. Do not pretend to have done external actions you did not do.",
    ].join("\n");
  }

  private async requestModelWithFallback(
    preferredModel: string,
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
  ): Promise<ModelExecutionResult> {
    const fallbackCandidates =
      await this.buildFallbackModelList(preferredModel);
    const attemptedModels: string[] = [];
    const errors: string[] = [];

    for (const model of fallbackCandidates) {
      attemptedModels.push(model);

      try {
        const completion = await this.gatewayService.requestChatCompletion(
          {
            model,
            messages,
            stream: false,
            temperature: 0.6,
          },
          "prefer-public-beta",
        );

        return {
          content:
            String(
              completion.data?.choices?.[0]?.message?.content || "",
            ).trim() || "No valid content returned.",
          model: completion.data?.model || model,
          cost: Number(completion.cost || 0),
          attemptedModels,
          usedFallbackModel:
            attemptedModels[0] !== (completion.data?.model || model) ||
            model !== preferredModel,
          executionNote:
            attemptedModels.length > 1
              ? `Primary model ${preferredModel} failed, switched to ${completion.data?.model || model}.`
              : undefined,
          executionMode: "completion",
          toolTraces: [],
        };
      } catch (error: any) {
        const message = String(error?.message || error || "model call failed");
        errors.push(`${model}: ${message}`);
      }
    }

    throw new BadRequestException(
      `All candidate models failed: ${errors.join(" | ")}`,
    );
  }

  private async buildFallbackModelList(preferredModel: string) {
    const availableModels =
      await this.gatewayService.getAvailableModels("chat");
    const uniqueModels = Array.from(
      new Set([preferredModel, ...availableModels.map((item) => item.id)]),
    );
    return uniqueModels.slice(0, MAX_MODEL_ATTEMPTS);
  }

  private buildTeamRecord(payload: {
    name?: string;
    description?: string;
    members?: TeamMemberInput[];
  }): ChatTeamRecord {
    const now = new Date().toISOString();

    return {
      id: randomUUID(),
      name: this.normalizeName(payload.name),
      description: String(payload.description || "").trim(),
      members: this.normalizeMembers(payload.members || []),
      createdAt: now,
      updatedAt: now,
      lastRun: null,
    };
  }

  private normalizeName(name?: string) {
    const trimmed = String(name || "").trim();
    return trimmed || "Digital employee team";
  }

  private normalizeMembers(members: TeamMemberInput[]) {
    const normalized = (members || [])
      .map((member, index) => ({
        id: member.id || randomUUID(),
        name: String(member.name || "").trim(),
        roleTitle: String(member.roleTitle || "").trim(),
        model: String(member.model || "").trim(),
        skillId: String(member.skillId || "").trim(),
        responsibility: String(member.responsibility || "").trim(),
        isLead: Boolean(member.isLead),
        order: index,
      }))
      .filter(
        (member) =>
          member.name && member.roleTitle && member.model && member.skillId,
      )
      .slice(0, MAX_TEAM_MEMBERS);

    if (normalized.length < MIN_TEAM_MEMBERS) {
      throw new BadRequestException(
        `A team needs at least ${MIN_TEAM_MEMBERS} digital employees.`,
      );
    }

    const withLeader = normalized.some((member) => member.isLead)
      ? normalized
      : normalized.map((member, index) => ({ ...member, isLead: index === 0 }));

    const leadCount = withLeader.filter((item) => item.isLead).length;
    return withLeader.map(({ order: _order, ...member }, index) => ({
      ...member,
      isLead: leadCount > 1 ? index === 0 : member.isLead,
    }));
  }

  private async findTeam(userId: string, teamId: string) {
    const teams = await this.listTeams(userId);
    const team = teams.find((item) => item.id === teamId);
    if (!team) {
      throw new NotFoundException("Team not found.");
    }
    return team;
  }

  private ensureUserBucket(store: TeamStore, userId: string) {
    if (!store.users[userId]) {
      store.users[userId] = { teams: [] };
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

  private async readStore(): Promise<TeamStore> {
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
        `Failed to read team store, using empty store: ${String(error)}`,
      );
      return { users: {} };
    }
  }

  private async writeStore(store: TeamStore) {
    await mkdir(dirname(this.storePath), { recursive: true });
    await writeFile(this.storePath, JSON.stringify(store, null, 2), "utf8");
  }

  private async enqueueWrite(task: () => Promise<void>) {
    let writeError: unknown = null;

    this.writeQueue = this.writeQueue.then(task).catch((error) => {
      writeError = error;
      this.logger.error(`Failed to persist chat teams: ${String(error)}`);
    });

    await this.writeQueue;

    if (writeError) {
      throw writeError;
    }
  }
}
