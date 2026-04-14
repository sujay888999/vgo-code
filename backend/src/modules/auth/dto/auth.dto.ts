import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MinLength,
  IsOptional,
  IsBoolean,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class RegisterDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: "username" })
  @IsString()
  @IsNotEmpty()
  username: string;

  @ApiProperty({ example: "password123" })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiProperty({ example: "123456" })
  @IsString()
  @IsNotEmpty()
  verificationCode: string;
}

export class LoginDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({ example: "password123" })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class CreateApiKeyDto {
  @ApiProperty({ example: "My API Key" })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 10000 })
  @IsOptional()
  dailyLimit?: number;

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  monthlyLimit?: number;
}

export class UpdateApiKeyDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: ["active", "inactive"] })
  @IsOptional()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  dailyLimit?: number;

  @ApiPropertyOptional()
  @IsOptional()
  monthlyLimit?: number;
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    username: string;
    isAdmin: boolean;
  };
}

export class SendEmailCodeDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class ApiKeyResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  apiKey: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  dailyLimit: number;

  @ApiProperty()
  monthlyLimit: number;

  @ApiProperty()
  usedToday: number;

  @ApiProperty()
  usedMonth: number;

  @ApiProperty()
  createdAt: Date;
}
