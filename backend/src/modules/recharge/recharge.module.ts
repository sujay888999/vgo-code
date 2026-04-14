import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RechargeController } from "./recharge.controller";
import { RechargeService } from "./recharge.service";
import { Recharge } from "./recharge.entity";
import { User } from "../user/user.entity";

@Module({
  imports: [TypeOrmModule.forFeature([Recharge, User])],
  controllers: [RechargeController],
  providers: [RechargeService],
  exports: [RechargeService],
})
export class RechargeModule {}
