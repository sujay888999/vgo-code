import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AuthController } from "./auth.controller";
import { AuthEmailVerificationService } from "./auth-email-verification.service";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "../../common/strategies/jwt.strategy";
import { User } from "../user/user.entity";
import { ApiKey } from "./api-key.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([User, ApiKey]),
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get("JWT_SECRET", "your-secret-key"),
        signOptions: { expiresIn: "7d" },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthEmailVerificationService, JwtStrategy],
  exports: [AuthService, JwtModule],
})
export class AuthModule {}
