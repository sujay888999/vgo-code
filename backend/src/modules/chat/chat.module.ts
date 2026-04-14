import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { JwtModule } from "@nestjs/jwt";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";
import { ChatGateway } from "./chat.gateway";
import { ChatConversation } from "./chat-conversation.entity";
import { ChatMessage } from "./chat-message.entity";
import { User } from "../user/user.entity";
import { Channel } from "../channel/channel.entity";
import { GatewayModule } from "../gateway/gateway.module";
import { Recharge } from "../recharge/recharge.entity";
import { RequestLog } from "../gateway/request-log.entity";
import { ChannelModel } from "../channel/channel-model.entity";
import { ChatAgentService } from "./chat-agent.service";
import { RechargeModule } from "../recharge/recharge.module";
import { ChatSkillInstallService } from "./chat-skill-install.service";
import { ChatTeamService } from "./chat-team.service";
import { ChatWorkspaceService } from "./chat-workspace.service";
import { ChatLocalBridgeService } from "./chat-local-bridge.service";
import { ChatLocalBridgeController } from "./chat-local-bridge.controller";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatConversation,
      ChatMessage,
      User,
      Channel,
      Recharge,
      RequestLog,
      ChannelModel,
    ]),
    GatewayModule,
    RechargeModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get("JWT_SECRET", "your-super-secret-key"),
        signOptions: { expiresIn: "7d" },
      }),
    }),
  ],
  controllers: [ChatController, ChatLocalBridgeController],
  providers: [
    ChatService,
    ChatGateway,
    ChatAgentService,
    ChatSkillInstallService,
    ChatTeamService,
    ChatWorkspaceService,
    ChatLocalBridgeService,
  ],
  exports: [ChatService, ChatWorkspaceService, ChatLocalBridgeService],
})
export class ChatModule {}
