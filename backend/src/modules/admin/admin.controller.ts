import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { AdminService } from "./admin.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../common/guards/admin.guard";
import { ChatWorkspaceService } from "../chat/chat-workspace.service";
import { ChannelService } from "../channel/channel.service";

@ApiTags("Admin")
@Controller("admin")
@UseGuards(JwtAuthGuard, AdminGuard)
@ApiBearerAuth()
export class AdminController {
  constructor(
    private adminService: AdminService,
    private chatWorkspaceService: ChatWorkspaceService,
    private channelService: ChannelService,
  ) {}

  // Dashboard
  @Get("dashboard")
  @ApiOperation({ summary: "Get dashboard statistics" })
  async getDashboard() {
    return this.adminService.getDashboardStats();
  }

  // Users
  @Get("users")
  @ApiOperation({ summary: "Get all users" })
  async getUsers(
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 20,
    @Query("search") search?: string,
  ) {
    return this.adminService.getUsers(
      Number(page) || 1,
      Number(limit) || 20,
      search,
    );
  }

  @Get("users/:id")
  @ApiOperation({ summary: "Get user details" })
  async getUserDetail(@Param("id") id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Put("users/:id")
  @ApiOperation({ summary: "Update user" })
  async updateUser(
    @Param("id") id: string,
    @Body() data: { isActive?: boolean; isAdmin?: boolean; balance?: number },
  ) {
    return this.adminService.updateUser(id, data);
  }

  // Channels
  @Get("channels")
  @ApiOperation({ summary: "Get all channels" })
  async getChannels() {
    return this.adminService.getChannels();
  }

  @Post("channels")
  @ApiOperation({ summary: "Create a new channel" })
  async createChannel(@Body() data: any) {
    return this.adminService.createChannel(data);
  }

  @Put("channels/:id")
  @ApiOperation({ summary: "Update channel" })
  async updateChannel(@Param("id") id: string, @Body() data: any) {
    return this.adminService.updateChannel(id, data);
  }

  @Delete("channels/:id")
  @ApiOperation({ summary: "Delete channel" })
  async deleteChannel(@Param("id") id: string) {
    return this.adminService.deleteChannel(id);
  }

  @Get("channel-model-presets")
  @ApiOperation({ summary: "Get model presets for quick deployment" })
  async getChannelModelPresets() {
    return { data: await this.adminService.getModelPresets() };
  }

  @Get("opencode-zen-pricing")
  @ApiOperation({ summary: "Get opencode zen pricing reference" })
  async getOpencodeZenPricing() {
    return { data: await this.adminService.getOpencodeZenPricingReference() };
  }

  @Post("channels/:id/sync-opencode-pricing")
  @ApiOperation({ summary: "Sync one channel model prices from opencode zen pricing" })
  async syncChannelOpencodePricing(@Param("id") id: string) {
    return { data: await this.adminService.syncOpencodeZenPricing(id) };
  }

  @Post("channels/:id/test-model")
  @ApiOperation({ summary: "Test one model on a specific channel" })
  async testChannelModel(
    @Param("id") id: string,
    @Body() data: { modelName: string; protocol?: string; message?: string },
  ) {
    return this.channelService.testChannelModel(id, data || ({} as any));
  }

  // Request logs
  @Get("logs")
  @ApiOperation({ summary: "Get request logs" })
  async getLogs(
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 20,
    @Query() filters: any,
  ) {
    return this.adminService.getRequestLogs(
      Number(page) || 1,
      Number(limit) || 20,
      filters,
    );
  }

  // Recharges
  @Get("recharges")
  @ApiOperation({ summary: "Get recharge records" })
  async getRecharges(
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 20,
    @Query("status") status?: string,
  ) {
    return this.adminService.getRecharges(
      Number(page) || 1,
      Number(limit) || 20,
      status,
    );
  }

  @Put("recharges/:id")
  @ApiOperation({ summary: "Review or update a recharge record" })
  async updateRecharge(
    @Param("id") id: string,
    @Body() data: { action: "approve" | "reject"; note?: string },
  ) {
    return this.adminService.updateRecharge(id, data);
  }

  // Analytics
  @Get("analytics")
  @ApiOperation({ summary: "Get analytics data" })
  async getAnalytics(@Query("days") days: number = 30) {
    return this.adminService.getAnalytics(Number(days) || 30);
  }

  @Get("workspace/templates")
  @ApiOperation({ summary: "Get workspace templates for admin management" })
  async getWorkspaceTemplates() {
    return { data: await this.chatWorkspaceService.listTemplates() };
  }

  @Post("workspace/templates")
  @ApiOperation({ summary: "Create a custom workspace template" })
  async createWorkspaceTemplate(@Body() data: any) {
    return { data: await this.chatWorkspaceService.createTemplate(data || {}) };
  }

  @Put("workspace/templates/:id")
  @ApiOperation({ summary: "Update a custom workspace template" })
  async updateWorkspaceTemplate(@Param("id") id: string, @Body() data: any) {
    return {
      data: await this.chatWorkspaceService.updateTemplate(id, data || {}),
    };
  }

  @Delete("workspace/templates/:id")
  @ApiOperation({ summary: "Delete a custom workspace template" })
  async deleteWorkspaceTemplate(@Param("id") id: string) {
    await this.chatWorkspaceService.deleteTemplate(id);
    return { message: "Template deleted" };
  }
}
