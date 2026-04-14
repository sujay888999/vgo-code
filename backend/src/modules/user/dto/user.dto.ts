import { ApiProperty } from "@nestjs/swagger";
import {
  IsEmail,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

export class UpdateProfileDto {
  @ApiProperty({ example: "user@example.com" })
  @IsEmail()
  email: string;

  @ApiProperty({ example: "VGO User" })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  username: string;
}

export class ChangePasswordDto {
  @ApiProperty({ example: "OldPassword123!" })
  @IsString()
  currentPassword: string;

  @ApiProperty({ example: "NewPassword123!" })
  @IsString()
  @MinLength(6)
  newPassword: string;
}
