import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ChatLocalBridgeService } from "./chat-local-bridge.service";

@ApiTags("Local Bridge")
@Controller("chat/local-bridge")
export class ChatLocalBridgeController {
  constructor(
    private readonly chatLocalBridgeService: ChatLocalBridgeService,
  ) {}

  @Get("bridges")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List local bridges for current user" })
  async listBridges(@Request() req) {
    return {
      data: await this.chatLocalBridgeService.listBridges(req.user.userId),
    };
  }

  @Post("bridges")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Create/register a local bridge for current user" })
  async createBridge(
    @Request() req,
    @Body()
    body: {
      name?: string;
      platform?: string;
      machineLabel?: string;
      workingDirectory?: string;
    },
  ) {
    return {
      data: await this.chatLocalBridgeService.createBridge(
        req.user.userId,
        body || {},
      ),
    };
  }

  @Get("jobs")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List local bridge jobs for current user" })
  async listJobs(@Request() req, @Query("bridgeId") bridgeId?: string) {
    return {
      data: await this.chatLocalBridgeService.listJobs(
        req.user.userId,
        bridgeId,
      ),
    };
  }

  @Post("bridges/:id/jobs")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Enqueue one local bridge job" })
  async enqueueJob(
    @Request() req,
    @Param("id") id: string,
    @Body()
    body: { title?: string; instruction?: string; workingDirectory?: string },
  ) {
    return {
      data: await this.chatLocalBridgeService.enqueueJob(
        req.user.userId,
        id,
        body || {},
      ),
    };
  }

  @Public()
  @Post("agent/heartbeat")
  @ApiOperation({ summary: "Bridge agent heartbeat" })
  async agentHeartbeat(
    @Body()
    body: {
      bridgeId?: string;
      token?: string;
      status?: "offline" | "idle" | "busy" | "error";
    },
  ) {
    return {
      data: await this.chatLocalBridgeService.agentHeartbeat(body || {}),
    };
  }

  @Public()
  @Get("agent/jobs/next")
  @ApiOperation({ summary: "Bridge agent fetch next queued job" })
  async agentNextJob(
    @Query("bridgeId") bridgeId?: string,
    @Query("token") token?: string,
  ) {
    return {
      data: await this.chatLocalBridgeService.agentGetNextJob({
        bridgeId,
        token,
      }),
    };
  }

  @Public()
  @Post("agent/jobs/:id/start")
  @ApiOperation({ summary: "Bridge agent mark job as started" })
  async agentStartJob(
    @Param("id") id: string,
    @Body() body: { bridgeId?: string; token?: string },
  ) {
    return {
      data: await this.chatLocalBridgeService.agentStartJob({
        ...body,
        jobId: id,
      }),
    };
  }

  @Public()
  @Post("agent/jobs/:id/complete")
  @ApiOperation({ summary: "Bridge agent mark job as completed" })
  async agentCompleteJob(
    @Param("id") id: string,
    @Body()
    body: {
      bridgeId?: string;
      token?: string;
      resultSummary?: string;
      stdout?: string;
      stderr?: string;
      artifacts?: string[];
    },
  ) {
    return {
      data: await this.chatLocalBridgeService.agentCompleteJob({
        ...body,
        jobId: id,
      }),
    };
  }

  @Public()
  @Post("agent/jobs/:id/fail")
  @ApiOperation({ summary: "Bridge agent mark job as failed" })
  async agentFailJob(
    @Param("id") id: string,
    @Body()
    body: {
      bridgeId?: string;
      token?: string;
      resultSummary?: string;
      stdout?: string;
      stderr?: string;
    },
  ) {
    return {
      data: await this.chatLocalBridgeService.agentFailJob({
        ...body,
        jobId: id,
      }),
    };
  }
}
