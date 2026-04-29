import { ModelAdapterFactory } from "./adapters/model-adapter.factory";

@Module({
  imports: [
    TypeOrmModule.forFeature([RequestLog, Channel, User]),
    AuthModule,
    ChannelModule,
  ],
  controllers: [GatewayController],
  providers: [GatewayService, ModelAdapterFactory],
  exports: [GatewayService],
})
export class GatewayModule {}
