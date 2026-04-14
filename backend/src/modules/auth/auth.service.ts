import {
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import * as bcrypt from "bcrypt";
import { Repository } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import { User } from "../user/user.entity";
import { ApiKey, ApiKeyStatus } from "./api-key.entity";
import { AuthEmailVerificationService } from "./auth-email-verification.service";
import {
  CreateApiKeyDto,
  LoginDto,
  RegisterDto,
  UpdateApiKeyDto,
} from "./dto/auth.dto";

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(ApiKey)
    private readonly apiKeyRepository: Repository<ApiKey>,
    private readonly jwtService: JwtService,
    private readonly authEmailVerificationService: AuthEmailVerificationService,
  ) {}

  async sendRegistrationCode(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const existingUser = await this.userRepository.findOne({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ConflictException("该邮箱已经注册过，请直接登录。");
    }

    return this.authEmailVerificationService.sendCode(normalizedEmail);
  }

  async register(dto: RegisterDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const existingUser = await this.userRepository.findOne({
      where: { email: normalizedEmail },
    });

    if (existingUser) {
      throw new ConflictException("该邮箱已经注册过，请直接登录。");
    }

    await this.authEmailVerificationService.verifyCode(
      normalizedEmail,
      dto.verificationCode,
    );

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    const user = this.userRepository.create({
      email: normalizedEmail,
      username: dto.username.trim(),
      password: hashedPassword,
    });

    await this.userRepository.save(user);

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        isAdmin: user.isAdmin,
      },
    };
  }

  async login(dto: LoginDto) {
    const normalizedEmail = dto.email.trim().toLowerCase();
    const user = await this.userRepository.findOne({
      where: { email: normalizedEmail },
    });

    if (!user) {
      throw new HttpException(
        { message: "该邮箱还没有注册，请先创建账户。", code: "USER_NOT_FOUND" },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);
    if (!isPasswordValid) {
      throw new HttpException(
        { message: "密码错误，请重新输入。", code: "INVALID_PASSWORD" },
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (!user.isActive) {
      throw new HttpException(
        {
          message: "该账户当前不可用，请联系管理员。",
          code: "ACCOUNT_INACTIVE",
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    user.lastLoginAt = new Date();
    await this.userRepository.save(user);

    const accessToken = this.jwtService.sign({
      sub: user.id,
      email: user.email,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        isAdmin: user.isAdmin,
        balance: user.balance,
      },
    };
  }

  async createApiKey(userId: string, dto: CreateApiKeyDto) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    const apiKey = this.jwtService.sign({ random: uuidv4() });
    const keyPrefix = `sk-${apiKey.replace(/-/g, "").substring(0, 32)}`;

    const newApiKey = this.apiKeyRepository.create({
      userId,
      apiKey: keyPrefix,
      name: dto.name,
      dailyLimit: dto.dailyLimit || 10000,
      monthlyLimit: dto.monthlyLimit || 100000,
      status: ApiKeyStatus.ACTIVE,
      usedToday: 0,
      usedMonth: 0,
      resetTodayAt: new Date(),
      resetMonthAt: new Date(),
    });

    await this.apiKeyRepository.save(newApiKey);

    return {
      id: newApiKey.id,
      apiKey: keyPrefix,
      name: newApiKey.name,
      status: newApiKey.status,
      dailyLimit: newApiKey.dailyLimit,
      monthlyLimit: newApiKey.monthlyLimit,
      usedToday: newApiKey.usedToday,
      usedMonth: newApiKey.usedMonth,
      createdAt: newApiKey.createdAt,
    };
  }

  async getApiKeys(userId: string) {
    const keys = await this.apiKeyRepository.find({
      where: { userId },
      order: { createdAt: "DESC" },
    });

    return keys.map((key) => ({
      id: key.id,
      apiKey: `${key.apiKey.substring(0, 12)}...${key.apiKey.substring(
        key.apiKey.length - 4,
      )}`,
      name: key.name,
      status: key.status,
      dailyLimit: key.dailyLimit,
      monthlyLimit: key.monthlyLimit,
      usedToday: key.usedToday,
      usedMonth: key.usedMonth,
      createdAt: key.createdAt,
    }));
  }

  async updateApiKey(userId: string, keyId: string, dto: UpdateApiKeyDto) {
    const apiKey = await this.apiKeyRepository.findOne({
      where: { id: keyId, userId },
    });

    if (!apiKey) {
      throw new UnauthorizedException("API Key not found");
    }

    if (dto.name) apiKey.name = dto.name;
    if (dto.status) apiKey.status = dto.status as ApiKeyStatus;
    if (dto.dailyLimit) apiKey.dailyLimit = dto.dailyLimit;
    if (dto.monthlyLimit) apiKey.monthlyLimit = dto.monthlyLimit;

    await this.apiKeyRepository.save(apiKey);
    return apiKey;
  }

  async deleteApiKey(userId: string, keyId: string) {
    const apiKey = await this.apiKeyRepository.findOne({
      where: { id: keyId, userId },
    });

    if (!apiKey) {
      throw new UnauthorizedException("API Key not found");
    }

    await this.apiKeyRepository.remove(apiKey);
    return { message: "API 密钥已删除。" };
  }

  async validateApiKey(apiKey: string) {
    const key = await this.apiKeyRepository.findOne({
      where: { apiKey },
      relations: ["user"],
    });

    if (!key || key.status !== ApiKeyStatus.ACTIVE) {
      return null;
    }

    if (!key.user.isActive) {
      return null;
    }

    const now = new Date();
    if (key.resetTodayAt && now.getDate() !== key.resetTodayAt.getDate()) {
      key.usedToday = 0;
      key.resetTodayAt = now;
    }
    if (key.resetMonthAt && now.getMonth() !== key.resetMonthAt.getMonth()) {
      key.usedMonth = 0;
      key.resetMonthAt = now;
    }

    if (key.usedToday >= key.dailyLimit || key.usedMonth >= key.monthlyLimit) {
      return null;
    }

    await this.apiKeyRepository.save(key);

    return {
      apiKeyId: key.id,
      userId: key.userId,
      userBalance: key.user.balance,
      usedToday: key.usedToday,
      dailyLimit: key.dailyLimit,
    };
  }

  async incrementUsage(apiKeyId: string) {
    await this.apiKeyRepository.increment({ id: apiKeyId }, "usedToday", 1);
    await this.apiKeyRepository.increment({ id: apiKeyId }, "usedMonth", 1);
  }
}
