import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { GatewayController } from "./gateway.controller";
import { GatewayService } from "./gateway.service";
import { RequestLog } from "./request-log.entity";
import { Channel } from "../channel/channel.entity";
import { User } from "../user/user.entity";
import { AuthModule } from "../auth/auth.module";
import { ChannelModule } from "../channel/channel.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([RequestLog, Channel, User]),
    AuthModule,
    ChannelModule,
  ],
  controllers: [GatewayController],
  providers: [GatewayService],
  exports: [GatewayService],
})
export class GatewayModule {}
