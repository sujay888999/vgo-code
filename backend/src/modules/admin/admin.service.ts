import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../user/user.entity";
import { Channel, ChannelType } from "../channel/channel.entity";
import { ChannelModel } from "../channel/channel-model.entity";
import { Recharge, PaymentStatus } from "../recharge/recharge.entity";
import { RequestLog } from "../gateway/request-log.entity";
import { ApiKey } from "../auth/api-key.entity";
import { ChatConversation } from "../chat/chat-conversation.entity";
import { ChannelPublicBetaService } from "../channel/channel-public-beta.service";
import { MODEL_PRESETS } from "../gateway/model-catalog";
import {
  OPENCODE_ZEN_MARKUP_MULTIPLIER,
  OPENCODE_ZEN_OFFICIAL_PRICING,
  getOpencodeZenRetailPricing,
} from "../../database/opencode-zen-pricing";

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Channel)
    private channelRepository: Repository<Channel>,
    @InjectRepository(ChannelModel)
    private channelModelRepository: Repository<ChannelModel>,
    @InjectRepository(Recharge)
    private rechargeRepository: Repository<Recharge>,
    @InjectRepository(RequestLog)
    private requestLogRepository: Repository<RequestLog>,
    @InjectRepository(ApiKey)
    private apiKeyRepository: Repository<ApiKey>,
    @InjectRepository(ChatConversation)
    private conversationRepository: Repository<ChatConversation>,
    private channelPublicBetaService: ChannelPublicBetaService,
  ) {}

  // Dashboard stats
  async getDashboardStats() {
    const totalUsers = await this.userRepository.count();
    const activeUsers = await this.userRepository.count({
      where: { isActive: true },
    });
    const totalBalance = await this.userRepository
      .createQueryBuilder("user")
      .select("SUM(balance)", "total")
      .getRawOne();

    const totalRecharges = await this.rechargeRepository
      .createQueryBuilder("recharge")
      .select("SUM(amount)", "total")
      .where("recharge.payment_status = :status", { status: "paid" })
      .getRawOne();

    const todayRequests = await this.requestLogRepository
      .createQueryBuilder("log")
      .where("DATE(log.created_at) = CURRENT_DATE")
      .getCount();

    const monthRequests = await this.requestLogRepository
      .createQueryBuilder("log")
      .where(
        "EXTRACT(MONTH FROM log.created_at) = EXTRACT(MONTH FROM CURRENT_DATE)",
      )
      .getCount();

    const totalCost = await this.requestLogRepository
      .createQueryBuilder("log")
      .select("SUM(log.cost)", "total")
      .getRawOne();

    const todayConversations = await this.conversationRepository
      .createQueryBuilder("conversation")
      .where("DATE(conversation.createdAt) = CURRENT_DATE")
      .getCount();

    const totalConversations = await this.conversationRepository.count({
      where: { isActive: true },
    });

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
      },
      balance: {
        total: parseFloat(totalBalance?.total || 0),
      },
      recharges: {
        total: parseFloat(totalRecharges?.total || 0),
      },
      requests: {
        today: todayRequests,
        month: monthRequests,
      },
      cost: {
        total: parseFloat(totalCost?.total || 0),
      },
      conversations: {
        today: todayConversations,
        total: totalConversations,
      },
    };
  }

  // User management
  async getUsers(page: number = 1, limit: number = 20, search?: string) {
    const query = this.userRepository.createQueryBuilder("user");

    if (search) {
      query
        .where("user.email ILIKE :search", { search: `%${search}%` })
        .orWhere("user.username ILIKE :search", { search: `%${search}%` });
    }

    const [users, total] = await query
      .orderBy("user.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: users.map((u) => ({
        id: u.id,
        email: u.email,
        username: u.username,
        balance: u.balance,
        isAdmin: u.isAdmin,
        isActive: u.isActive,
        createdAt: u.createdAt,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getUserDetail(id: string) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    const apiKeys = await this.apiKeyRepository.find({ where: { userId: id } });
    const usage = await this.requestLogRepository
      .createQueryBuilder("log")
      .select("SUM(log.total_tokens)", "tokens")
      .addSelect("SUM(log.cost)", "cost")
      .addSelect("COUNT(*)", "requests")
      .where("log.user_id = :id", { id })
      .getRawOne();

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      balance: user.balance,
      isAdmin: user.isAdmin,
      isActive: user.isActive,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      apiKeys: apiKeys.length,
      usage: {
        tokens: parseInt(usage?.tokens || 0),
        cost: parseFloat(usage?.cost || 0),
        requests: parseInt(usage?.requests || 0),
      },
    };
  }

  async updateUser(
    id: string,
    data: { isActive?: boolean; isAdmin?: boolean; balance?: number },
  ) {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException("User not found");
    }

    if (data.isActive !== undefined) user.isActive = data.isActive;
    if (data.isAdmin !== undefined) user.isAdmin = data.isAdmin;
    if (data.balance !== undefined) user.balance = data.balance;

    await this.userRepository.save(user);
    return user;
  }

  // Channel management
  async getChannels() {
    const channels = await this.channelRepository.find({
      relations: ["modelConfigs"],
      order: { priority: "DESC" },
    });

    return this.channelPublicBetaService.attachConfigs(channels);
  }

  async createChannel(data: {
    name: string;
    channelType: string;
    baseUrl: string;
    apiKey?: string;
    models?: string[];
    modelConfigs?: Array<{
      modelName: string;
      protocol?: string;
      inputPrice?: number;
      outputPrice?: number;
      cacheWritePrice?: number;
      cacheReadPrice?: number;
      isActive?: boolean;
    }>;
    priority?: number;
    priceRate?: number;
    balance?: number;
    isPublicBeta?: boolean;
    betaFreeUntil?: string;
    betaLabel?: string;
  }) {
    // Convert string to ChannelType enum
    const channelType = Object.values(ChannelType).includes(
      data.channelType as ChannelType,
    )
      ? (data.channelType as ChannelType)
      : ChannelType.CUSTOM;

    const channel = this.channelRepository.create({
      name: data.name,
      channelType: channelType,
      baseUrl: data.baseUrl,
      apiKey: data.apiKey,
      models: data.models || ["*"],
      priority: data.priority || 0,
      priceRate: data.priceRate || 1,
      balance: data.balance || 0,
      isActive: true,
    });

    await this.channelRepository.save(channel);
    await this.channelPublicBetaService.updateChannelConfig(channel.id, {
      isPublicBeta: data.isPublicBeta,
      betaFreeUntil: data.betaFreeUntil,
      betaLabel: data.betaLabel,
    });

    if (data.modelConfigs?.length) {
      const configs = data.modelConfigs
        .filter((item) => item.modelName)
        .map((item) =>
          this.channelModelRepository.create({
            channelId: channel.id,
            modelName: item.modelName,
            protocol: item.protocol || "auto",
            inputPrice: item.inputPrice ?? 0,
            outputPrice: item.outputPrice ?? 0,
            cacheWritePrice: item.cacheWritePrice ?? 0,
            cacheReadPrice: item.cacheReadPrice ?? 0,
            isActive: item.isActive ?? true,
          }),
        );

      await this.channelModelRepository.save(configs);
    }

    const savedChannel = await this.channelRepository.findOne({
      where: { id: channel.id },
      relations: ["modelConfigs"],
    });

    return savedChannel
      ? this.channelPublicBetaService.attachConfig(savedChannel)
      : null;
  }

  async updateChannel(
    id: string,
    data: Partial<Channel> & {
      modelConfigs?: Array<{
        modelName: string;
        protocol?: string;
        inputPrice?: number;
        outputPrice?: number;
        cacheWritePrice?: number;
        cacheReadPrice?: number;
        isActive?: boolean;
      }>;
      isPublicBeta?: boolean;
      betaFreeUntil?: string;
      betaLabel?: string;
    },
  ) {
    const channel = await this.channelRepository.findOne({
      where: { id },
      relations: ["modelConfigs"],
    });
    if (!channel) {
      throw new NotFoundException("Channel not found");
    }

    const nextChannelData = { ...data };
    delete nextChannelData.modelConfigs;
    delete (nextChannelData as any).isPublicBeta;
    delete (nextChannelData as any).betaFreeUntil;
    delete (nextChannelData as any).betaLabel;

    Object.assign(channel, nextChannelData);
    await this.channelRepository.save(channel);
    await this.channelPublicBetaService.updateChannelConfig(id, {
      isPublicBeta: data.isPublicBeta,
      betaFreeUntil: data.betaFreeUntil,
      betaLabel: data.betaLabel,
    });

    if (data.modelConfigs) {
      await this.channelModelRepository.delete({ channelId: id });

      const configs = data.modelConfigs
        .filter((item) => item.modelName)
        .map((item) =>
          this.channelModelRepository.create({
            channelId: id,
            modelName: item.modelName,
            protocol: item.protocol || "auto",
            inputPrice: item.inputPrice ?? 0,
            outputPrice: item.outputPrice ?? 0,
            cacheWritePrice: item.cacheWritePrice ?? 0,
            cacheReadPrice: item.cacheReadPrice ?? 0,
            isActive: item.isActive ?? true,
          }),
        );

      if (configs.length) {
        await this.channelModelRepository.save(configs);
      }
    }

    const updatedChannel = await this.channelRepository.findOne({
      where: { id },
      relations: ["modelConfigs"],
    });

    return updatedChannel
      ? this.channelPublicBetaService.attachConfig(updatedChannel)
      : null;
  }

  async deleteChannel(id: string) {
    await this.channelModelRepository.delete({ channelId: id });
    await this.channelRepository.delete(id);
    await this.channelPublicBetaService.deleteChannelConfig(id);
    return { message: "Channel deleted" };
  }

  async getModelPresets() {
    return Object.entries(MODEL_PRESETS).map(([id, preset]) => ({
      id,
      ...preset,
    }));
  }

  async getOpencodeZenPricingReference() {
    return {
      markupMultiplier: OPENCODE_ZEN_MARKUP_MULTIPLIER,
      rows: Object.entries(OPENCODE_ZEN_OFFICIAL_PRICING).map(([modelName, pricing]) => ({
        modelName,
        official: pricing,
        retail: getOpencodeZenRetailPricing(modelName),
      })),
    };
  }

  async syncOpencodeZenPricing(channelId?: string) {
    const query = this.channelRepository
      .createQueryBuilder("channel")
      .leftJoinAndSelect("channel.modelConfigs", "modelConfigs")
      .where("channel.isActive = :isActive", { isActive: true });

    if (channelId) {
      query.andWhere("channel.id = :channelId", { channelId });
    }

    const channels = await query.getMany();
    let updated = 0;

    for (const channel of channels) {
      const isOpencodeChannel =
        /opencode\.ai\/zen/i.test(channel.baseUrl || "") ||
        /^opencode/i.test(channel.name || "");

      if (!isOpencodeChannel) {
        continue;
      }

      for (const model of channel.modelConfigs || []) {
        const pricing = getOpencodeZenRetailPricing(model.modelName);
        if (!pricing) {
          continue;
        }

        model.inputPrice = pricing.inputPrice;
        model.outputPrice = pricing.outputPrice;
        model.cacheReadPrice = pricing.cacheReadPrice;
        model.cacheWritePrice = pricing.cacheWritePrice;
        await this.channelModelRepository.save(model);
        updated += 1;
      }
    }

    return {
      updated,
      markupMultiplier: OPENCODE_ZEN_MARKUP_MULTIPLIER,
    };
  }

  // Request logs
  async getRequestLogs(
    page: number = 1,
    limit: number = 20,
    filters?: {
      userId?: string;
      channelId?: string;
      model?: string;
      startDate?: string;
      endDate?: string;
    },
  ) {
    const query = this.requestLogRepository
      .createQueryBuilder("log")
      .leftJoinAndSelect("log.user", "user")
      .leftJoinAndSelect("log.channel", "channel");

    if (filters?.userId) {
      query.andWhere("log.userId = :userId", { userId: filters.userId });
    }
    if (filters?.channelId) {
      query.andWhere("log.channelId = :channelId", {
        channelId: filters.channelId,
      });
    }
    if (filters?.model) {
      query.andWhere("log.model = :model", { model: filters.model });
    }
    if (filters?.startDate) {
      query.andWhere("log.createdAt >= :startDate", {
        startDate: filters.startDate,
      });
    }
    if (filters?.endDate) {
      query.andWhere("log.createdAt <= :endDate", { endDate: filters.endDate });
    }

    const [logs, total] = await query
      .orderBy("log.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Recharge management
  async getRecharges(page: number = 1, limit: number = 20, status?: string) {
    const query = this.rechargeRepository
      .createQueryBuilder("recharge")
      .leftJoinAndSelect("recharge.user", "user");

    if (status) {
      query.where("recharge.paymentStatus = :status", { status });
    }

    const [recharges, total] = await query
      .orderBy("recharge.createdAt", "DESC")
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return {
      data: recharges.map((recharge) => ({
        ...recharge,
        amount: Number(recharge.amount),
        bonus: Number(recharge.bonus),
        user: recharge.user
          ? {
              id: recharge.user.id,
              email: recharge.user.email,
              username: recharge.user.username,
            }
          : undefined,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async updateRecharge(
    id: string,
    data: { action: "approve" | "reject"; note?: string },
  ) {
    const recharge = await this.rechargeRepository.findOne({
      where: { id },
    });

    if (!recharge) {
      throw new NotFoundException("Recharge record not found");
    }

    if (data.action === "approve") {
      if (recharge.paymentStatus !== PaymentStatus.PAID) {
        recharge.paymentStatus = PaymentStatus.PAID;
        recharge.paidAt = new Date();
        recharge.transactionId =
          recharge.transactionId || data.note || `ADMIN-${Date.now()}`;
        await this.rechargeRepository.save(recharge);

        const totalAmount = Number(recharge.amount) + Number(recharge.bonus);
        await this.userRepository
          .createQueryBuilder()
          .update(User)
          .set({ balance: () => `balance + ${totalAmount}` })
          .where("id = :id", { id: recharge.userId })
          .execute();
      }

      return {
        success: true,
        message: "Recharge approved",
        recharge,
      };
    }

    if (recharge.paymentStatus === PaymentStatus.PAID) {
      throw new ForbiddenException("Paid recharge cannot be rejected");
    }

    recharge.paymentStatus = PaymentStatus.FAILED;
    if (data.note) {
      recharge.transactionId = data.note;
    }
    await this.rechargeRepository.save(recharge);

    return {
      success: true,
      message: "Recharge rejected",
      recharge,
    };
  }

  // Analytics
  async getAnalytics(days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const dailyStats = await this.requestLogRepository
      .createQueryBuilder("log")
      .select("DATE(log.created_at)", "date")
      .addSelect("COUNT(*)", "requests")
      .addSelect("SUM(log.total_tokens)", "tokens")
      .addSelect("SUM(log.cost)", "cost")
      .where("log.created_at >= :startDate", { startDate })
      .groupBy("DATE(log.created_at)")
      .orderBy("date", "ASC")
      .getRawMany();

    const modelStats = await this.requestLogRepository
      .createQueryBuilder("log")
      .select("log.model", "model")
      .addSelect("COUNT(*)", "requests")
      .addSelect("SUM(log.total_tokens)", "tokens")
      .addSelect("SUM(log.cost)", "cost")
      .where("log.created_at >= :startDate", { startDate })
      .groupBy("log.model")
      .orderBy("cost", "DESC")
      .getRawMany();

    const topUsers = await this.requestLogRepository
      .createQueryBuilder("log")
      .select("user.id", "userId")
      .addSelect("user.email", "email")
      .addSelect("SUM(log.cost)", "cost")
      .addSelect("COUNT(*)", "requests")
      .leftJoin("log.user", "user")
      .where("log.created_at >= :startDate", { startDate })
      .groupBy("user.id")
      .addGroupBy("user.email")
      .orderBy("cost", "DESC")
      .limit(10)
      .getRawMany();

    return {
      dailyStats,
      modelStats,
      topUsers,
    };
  }
}
