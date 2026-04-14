import { Body, Controller, Get, Put, Request, UseGuards } from "@nestjs/common";
import { ApiTags, ApiBearerAuth, ApiOperation } from "@nestjs/swagger";
import { UserService } from "./user.service";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { ChangePasswordDto, UpdateProfileDto } from "./dto/user.dto";

@ApiTags("User")
@Controller("user")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class UserController {
  constructor(private userService: UserService) {}

  @Get("profile")
  @ApiOperation({ summary: "Get user profile" })
  async getProfile(@Request() req) {
    return this.userService.getProfile(req.user.userId);
  }

  @Get("balance")
  @ApiOperation({ summary: "Get user balance" })
  async getBalance(@Request() req) {
    return this.userService.getBalance(req.user.userId);
  }

  @Put("profile")
  @ApiOperation({ summary: "Update user profile" })
  async updateProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    return this.userService.updateProfile(req.user.userId, dto);
  }

  @Put("password")
  @ApiOperation({ summary: "Change user password" })
  async changePassword(@Request() req, @Body() dto: ChangePasswordDto) {
    return this.userService.changePassword(req.user.userId, dto);
  }
}
