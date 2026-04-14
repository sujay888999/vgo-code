import {
  Controller,
  Get,
  Post,
  Delete,
  Put,
  Body,
  Param,
  UseGuards,
  Request,
} from "@nestjs/common";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ChatService } from "./chat.service";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { getChatSkills } from "./chat-skill-registry";
import { ChatSkillInstallService } from "./chat-skill-install.service";
import { ChatTeamService } from "./chat-team.service";
import { ChatWorkspaceService } from "./chat-workspace.service";

@ApiTags("Chat")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("chat")
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly chatSkillInstallService: ChatSkillInstallService,
    private readonly chatTeamService: ChatTeamService,
    private readonly chatWorkspaceService: ChatWorkspaceService,
  ) {}

  @Post("conversations")
  @ApiOperation({ summary: "Create a new conversation" })
  async createConversation(@Request() req, @Body() body: { title?: string }) {
    const conversation = await this.chatService.createConversation(
      req.user.userId,
      body?.title,
    );
    return { data: conversation };
  }

  @Get("conversations")
  @ApiOperation({ summary: "Get all conversations" })
  async getConversations(@Request() req) {
    const conversations = await this.chatService.getConversations(
      req.user.userId,
    );
    return { data: conversations };
  }

  @Get("conversations/:id")
  @ApiOperation({ summary: "Get a conversation" })
  async getConversation(@Request() req, @Param("id") id: string) {
    const conversation = await this.chatService.getConversation(
      req.user.userId,
      id,
    );
    return { data: conversation };
  }

  @Get("conversations/:id/messages")
  @ApiOperation({ summary: "Get messages in a conversation" })
  async getMessages(@Request() req, @Param("id") id: string) {
    const messages = await this.chatService.getMessages(req.user.userId, id);
    return { data: messages };
  }

  @Delete("conversations/:id")
  @ApiOperation({ summary: "Delete a conversation" })
  async deleteConversation(@Request() req, @Param("id") id: string) {
    await this.chatService.deleteConversation(req.user.userId, id);
    return { message: "Conversation deleted" };
  }

  @Post("send")
  @ApiOperation({ summary: "Send a message and get AI response" })
  async sendMessage(
    @Request() req,
    @Body()
    body: {
      conversationId?: string;
      model?: string;
      skillId?: string;
      messages: { role: "user" | "assistant" | "system"; content: string }[];
      stream?: boolean;
    },
  ) {
    const result = await this.chatService.sendMessage(req.user.userId, body);
    return { data: result };
  }

  @Get("models")
  @ApiOperation({ summary: "Get available chat models" })
  async getModels() {
    const models = await this.chatService.getAvailableModels();
    return { data: models };
  }

  @Get("skills")
  @ApiOperation({ summary: "Get available chat skills" })
  async getSkills(@Request() req) {
    const installedSkillIds =
      await this.chatSkillInstallService.getInstalledSkillIds(
        req.user.userId,
        !!req.user?.isAdmin,
      );

    return {
      data: getChatSkills(!!req.user?.isAdmin).map((skill) => ({
        ...skill,
        installed: installedSkillIds.includes(skill.id),
      })),
    };
  }

  @Get("skills/installed")
  @ApiOperation({ summary: "Get installed chat skills for current user" })
  async getInstalledSkills(@Request() req) {
    const installedSkillIds =
      await this.chatSkillInstallService.getInstalledSkillIds(
        req.user.userId,
        !!req.user?.isAdmin,
      );

    return { data: { skillIds: installedSkillIds } };
  }

  @Put("skills/installed")
  @ApiOperation({ summary: "Update installed chat skills for current user" })
  async updateInstalledSkills(
    @Request() req,
    @Body() body: { skillIds?: string[] },
  ) {
    const installedSkillIds =
      await this.chatSkillInstallService.setInstalledSkillIds(
        req.user.userId,
        Array.isArray(body?.skillIds) ? body.skillIds : [],
        !!req.user?.isAdmin,
      );

    return { data: { skillIds: installedSkillIds } };
  }

  @Get("stats")
  @ApiOperation({ summary: "Get chat statistics" })
  async getStats(@Request() req) {
    const stats = await this.chatService.getStats(req.user.userId);
    return { data: stats };
  }

  @Get("teams")
  @ApiOperation({ summary: "Get digital employee teams for current user" })
  async getTeams(@Request() req) {
    const teams = await this.chatTeamService.listTeams(req.user.userId);
    return { data: teams };
  }

  @Get("teams/:id")
  @ApiOperation({ summary: "Get one digital employee team" })
  async getTeam(@Request() req, @Param("id") id: string) {
    const team = await this.chatTeamService.getTeam(req.user.userId, id);
    return { data: team };
  }

  @Post("teams")
  @ApiOperation({ summary: "Create a digital employee team" })
  async createTeam(
    @Request() req,
    @Body()
    body: {
      name?: string;
      description?: string;
      members?: Array<{
        id?: string;
        name: string;
        roleTitle: string;
        model: string;
        skillId: string;
        responsibility?: string;
        isLead?: boolean;
      }>;
    },
  ) {
    const team = await this.chatTeamService.createTeam(
      req.user.userId,
      body || {},
    );
    return { data: team };
  }

  @Put("teams/:id")
  @ApiOperation({ summary: "Update a digital employee team" })
  async updateTeam(
    @Request() req,
    @Param("id") id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      members?: Array<{
        id?: string;
        name: string;
        roleTitle: string;
        model: string;
        skillId: string;
        responsibility?: string;
        isLead?: boolean;
      }>;
    },
  ) {
    const team = await this.chatTeamService.updateTeam(
      req.user.userId,
      id,
      body || {},
    );
    return { data: team };
  }

  @Delete("teams/:id")
  @ApiOperation({ summary: "Delete a digital employee team" })
  async deleteTeam(@Request() req, @Param("id") id: string) {
    await this.chatTeamService.deleteTeam(req.user.userId, id);
    return { message: "Team deleted" };
  }

  @Post("teams/:id/run")
  @ApiOperation({ summary: "Run one digital employee team task" })
  async runTeamTask(
    @Request() req,
    @Param("id") id: string,
    @Body() body: { task?: string },
  ) {
    const result = await this.chatTeamService.runTeamTask(
      req.user.userId,
      id,
      String(body?.task || ""),
    );
    return { data: result };
  }

  @Get("workspace/overview")
  @ApiOperation({ summary: "Get workspace overview" })
  async getWorkspaceOverview(@Request() req) {
    return {
      data: await this.chatWorkspaceService.getOverview(req.user.userId),
    };
  }

  @Get("workspace/templates")
  @ApiOperation({ summary: "Get workspace task templates" })
  async getWorkspaceTemplates() {
    return { data: this.chatWorkspaceService.getTemplates() };
  }

  @Get("workspace/tasks")
  @ApiOperation({ summary: "Get workspace tasks" })
  async getWorkspaceTasks(@Request() req) {
    return { data: await this.chatWorkspaceService.listTasks(req.user.userId) };
  }

  @Get("workspace/tasks/:id")
  @ApiOperation({ summary: "Get workspace task" })
  async getWorkspaceTask(@Request() req, @Param("id") id: string) {
    return {
      data: await this.chatWorkspaceService.getTask(req.user.userId, id),
    };
  }

  @Post("workspace/tasks")
  @ApiOperation({ summary: "Create workspace task" })
  async createWorkspaceTask(
    @Request() req,
    @Body()
    body: {
      title?: string;
      brief?: string;
      priority?: "low" | "medium" | "high";
      teamId?: string | null;
      requiresApproval?: boolean;
      ownerNote?: string;
    },
  ) {
    return {
      data: await this.chatWorkspaceService.createTask(
        req.user.userId,
        body || {},
      ),
    };
  }

  @Put("workspace/tasks/:id")
  @ApiOperation({ summary: "Update workspace task" })
  async updateWorkspaceTask(
    @Request() req,
    @Param("id") id: string,
    @Body()
    body: {
      title?: string;
      brief?: string;
      priority?: "low" | "medium" | "high";
      teamId?: string | null;
      requiresApproval?: boolean;
      ownerNote?: string;
      status?:
        | "draft"
        | "pending_approval"
        | "approved"
        | "running"
        | "completed"
        | "rejected";
    },
  ) {
    return {
      data: await this.chatWorkspaceService.updateTask(
        req.user.userId,
        id,
        body || {},
      ),
    };
  }

  @Post("workspace/tasks/:id/run")
  @ApiOperation({ summary: "Run workspace task" })
  async runWorkspaceTask(@Request() req, @Param("id") id: string) {
    return {
      data: await this.chatWorkspaceService.runTask(req.user.userId, id),
    };
  }

  @Get("workspace/approvals")
  @ApiOperation({ summary: "Get workspace approvals" })
  async getWorkspaceApprovals(@Request() req) {
    return {
      data: await this.chatWorkspaceService.listApprovals(req.user.userId),
    };
  }

  @Post("workspace/approvals/:id/approve")
  @ApiOperation({ summary: "Approve workspace task" })
  async approveWorkspaceTask(
    @Request() req,
    @Param("id") id: string,
    @Body() body: { reviewerNote?: string },
  ) {
    return {
      data: await this.chatWorkspaceService.decideApproval(
        req.user.userId,
        id,
        "approved",
        body?.reviewerNote,
      ),
    };
  }

  @Post("workspace/approvals/:id/reject")
  @ApiOperation({ summary: "Reject workspace task" })
  async rejectWorkspaceTask(
    @Request() req,
    @Param("id") id: string,
    @Body() body: { reviewerNote?: string },
  ) {
    return {
      data: await this.chatWorkspaceService.decideApproval(
        req.user.userId,
        id,
        "rejected",
        body?.reviewerNote,
      ),
    };
  }

  @Get("workspace/deliverables")
  @ApiOperation({ summary: "Get workspace deliverables" })
  async getWorkspaceDeliverables(@Request() req) {
    return {
      data: await this.chatWorkspaceService.listDeliverables(req.user.userId),
    };
  }

  @Post("workspace/deliverables/:id/queue-local")
  @ApiOperation({
    summary: "Queue deliverable local actions to one local bridge",
  })
  async queueWorkspaceDeliverableLocalActions(
    @Request() req,
    @Param("id") id: string,
    @Body() body: { bridgeId?: string },
  ) {
    return {
      data: await this.chatWorkspaceService.queueLocalActions(
        req.user.userId,
        id,
        String(body?.bridgeId || ""),
      ),
    };
  }

  @Get("workspace/deliverables/:id/export")
  @ApiOperation({ summary: "Export one workspace deliverable as markdown" })
  async exportWorkspaceDeliverable(@Request() req, @Param("id") id: string) {
    return {
      data: await this.chatWorkspaceService.exportDeliverable(
        req.user.userId,
        id,
      ),
    };
  }
}
