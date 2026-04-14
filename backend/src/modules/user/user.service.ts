import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "./user.entity";
import { ChangePasswordDto, UpdateProfileDto } from "./dto/user.dto";
import * as bcrypt from "bcrypt";

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {}

  async getProfile(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) return null;

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      balance: Number(user.balance),
      isAdmin: user.isAdmin,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    };
  }

  async getBalance(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    return { balance: Number(user?.balance) || 0 };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const existingEmail = await this.userRepository.findOne({
      where: { email: dto.email },
    });
    if (existingEmail && existingEmail.id !== userId) {
      throw new ConflictException("该邮箱已被其他账户使用");
    }

    user.email = dto.email;
    user.username = dto.username;
    await this.userRepository.save(user);

    return this.getProfile(userId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      user.password,
    );
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException("当前密码不正确");
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException("新密码不能与当前密码相同");
    }

    user.password = await bcrypt.hash(dto.newPassword, 10);
    await this.userRepository.save(user);

    return { message: "密码修改成功" };
  }
}
