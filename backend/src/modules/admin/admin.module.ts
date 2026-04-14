import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AdminController } from "./admin.controller";
import { AdminService } from "./admin.service";
import { User } from "../user/user.entity";
import { Channel } from "../channel/channel.entity";
import { ChannelModel } from "../channel/channel-model.entity";
import { Recharge } from "../recharge/recharge.entity";
import { RequestLog } from "../gateway/request-log.entity";
import { ApiKey } from "../auth/api-key.entity";
import { ChatConversation } from "../chat/chat-conversation.entity";
import { ChannelModule } from "../channel/channel.module";
import { ChatModule } from "../chat/chat.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Channel,
      ChannelModel,
      Recharge,
      RequestLog,
      ApiKey,
      ChatConversation,
    ]),
    ChannelModule,
    ChatModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
