import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { ChannelService } from "./channel.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { AdminGuard } from "../../common/guards/admin.guard";

@ApiTags("Channels")
@Controller("channels")
export class ChannelController {
  constructor(private channelService: ChannelService) {}

  @Get()
  @ApiOperation({ summary: "Get all channels" })
  async findAll() {
    return this.channelService.findAll();
  }

  @Get(":id")
  @ApiOperation({ summary: "Get channel by ID" })
  async findOne(@Param("id") id: string) {
    return this.channelService.findOne(id);
  }

  @Get(":id/models")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get available models for a channel" })
  async getModels(@Param("id") id: string) {
    return this.channelService.getAvailableModels(id);
  }

  @Post(":id/test")
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Test channel connection" })
  async testChannel(@Param("id") id: string) {
    return this.channelService.testChannel(id);
  }
}
