import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ChannelController } from "./channel.controller";
import { ChannelService } from "./channel.service";
import { Channel } from "./channel.entity";
import { ChannelModel } from "./channel-model.entity";
import { ChannelPublicBetaService } from "./channel-public-beta.service";

@Module({
  imports: [TypeOrmModule.forFeature([Channel, ChannelModel])],
  controllers: [ChannelController],
  providers: [ChannelService, ChannelPublicBetaService],
  exports: [ChannelService, ChannelPublicBetaService],
})
export class ChannelModule {}
