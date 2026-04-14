import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Headers,
  Req,
  UseGuards,
  Request,
  BadRequestException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiHeader,
} from "@nestjs/swagger";
import { GatewayService } from "./gateway.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";

@ApiTags("Gateway")
@Controller("gateway")
export class GatewayController {
  constructor(private gatewayService: GatewayService) {}

  private stripUpstreamFields(items: Array<Record<string, any>>) {
    return items.map(({ availableChannels, ...item }) => item);
  }

  @Get("models/catalog")
  @ApiOperation({ summary: "Get public model catalog" })
  async getModelCatalog() {
    return {
      data: this.stripUpstreamFields(
        await this.gatewayService.getModelCatalog(),
      ),
    };
  }

  @Get("v1/models")
  @ApiOperation({ summary: "Get all available models for an API key" })
  @ApiHeader({ name: "Authorization", description: "Bearer {API Key}" })
  async getClientModels(@Headers("authorization") auth: string) {
    const apiKey = auth?.replace("Bearer ", "");
    if (!apiKey) {
      throw new BadRequestException("API Key is required");
    }

    return {
      data: this.stripUpstreamFields(
        await this.gatewayService.getClientModels(apiKey),
      ),
    };
  }

  @Post("v1/*")
  @ApiOperation({ summary: "Proxy request to upstream API" })
  @ApiHeader({ name: "Authorization", description: "Bearer {API Key}" })
  async proxyRequest(
    @Req() req: Request,
    @Headers("authorization") auth: string,
    @Body() body: any,
  ) {
    const apiKey = auth?.replace("Bearer ", "");
    if (!apiKey) {
      throw new Error("API Key is required");
    }

    const requestIp =
      req.headers["x-forwarded-for"] || req.headers["x-real-ip"] || "unknown";

    const proxyPath =
      req.url.replace(/^\/api\/v1\/gateway/, "") || "/v1/chat/completions";

    return this.gatewayService.proxyRequest(
      apiKey,
      {
        method: "POST",
        path: proxyPath,
        body,
      },
      requestIp,
      "prefer-public-beta",
    );
  }

  @Get("logs")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get request logs" })
  async getLogs(
    @Request() req,
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 20,
  ) {
    return this.gatewayService.getRequestLogs(req.user.userId, page, limit);
  }

  @Get("usage-stats")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get usage statistics" })
  async getUsageStats(@Request() req, @Query("days") days: number = 7) {
    return this.gatewayService.getUsageStats(req.user.userId, days);
  }
}
