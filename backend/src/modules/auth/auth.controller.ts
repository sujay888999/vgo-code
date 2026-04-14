import {
  Controller,
  Post,
  Body,
  Get,
  Put,
  Delete,
  Param,
  UseGuards,
  Request,
} from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import {
  RegisterDto,
  LoginDto,
  CreateApiKeyDto,
  UpdateApiKeyDto,
  SendEmailCodeDto,
} from "./dto/auth.dto";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post("register")
  @ApiOperation({ summary: "Register a new user" })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Post("send-registration-code")
  @ApiOperation({ summary: "Send email verification code for registration" })
  async sendRegistrationCode(@Body() dto: SendEmailCodeDto) {
    return this.authService.sendRegistrationCode(dto.email);
  }

  @Post("login")
  @ApiOperation({ summary: "User login" })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post("api-keys")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Create a new API Key" })
  async createApiKey(@Request() req, @Body() dto: CreateApiKeyDto) {
    return this.authService.createApiKey(req.user.userId, dto);
  }

  @Get("api-keys")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Get all API Keys" })
  async getApiKeys(@Request() req) {
    return this.authService.getApiKeys(req.user.userId);
  }

  @Put("api-keys/:id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Update API Key" })
  async updateApiKey(
    @Request() req,
    @Param("id") id: string,
    @Body() dto: UpdateApiKeyDto,
  ) {
    return this.authService.updateApiKey(req.user.userId, id, dto);
  }

  @Delete("api-keys/:id")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Delete API Key" })
  async deleteApiKey(@Request() req, @Param("id") id: string) {
    return this.authService.deleteApiKey(req.user.userId, id);
  }
}
