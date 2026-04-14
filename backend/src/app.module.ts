import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./modules/auth/auth.module";
import { UserModule } from "./modules/user/user.module";
import { ChannelModule } from "./modules/channel/channel.module";
import { GatewayModule } from "./modules/gateway/gateway.module";
import { RechargeModule } from "./modules/recharge/recharge.module";
import { AdminModule } from "./modules/admin/admin.module";
import { ChatModule } from "./modules/chat/chat.module";
import { RedisCacheModule } from "./common/redis-cache.module";

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ".env",
    }),

    // Redis Cache
    RedisCacheModule,

    // Database
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: "postgres",
        host: configService.get("DB_HOST", "localhost"),
        port: configService.get("DB_PORT", 5432),
        username: configService.get("DB_USERNAME", "postgres"),
        password: configService.get("DB_PASSWORD", "postgres"),
        database: configService.get("DB_DATABASE", "api_platform"),
        entities: [__dirname + "/**/*.entity{.ts,.js}"],
        migrations: [__dirname + "/database/migrations/*{.ts,.js}"],
        synchronize: configService.get("DB_SYNCHRONIZE", false),
        logging: configService.get("DB_LOGGING", false),
      }),
    }),

    // Rate limiting
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100,
      },
    ]),

    // Feature modules
    AuthModule,
    UserModule,
    ChannelModule,
    GatewayModule,
    RechargeModule,
    AdminModule,
    ChatModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
