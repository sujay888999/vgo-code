import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Between, Repository } from "typeorm";
import { ChatConversation } from "./chat-conversation.entity";
import { ChatMessage } from "./chat-message.entity";
import { User } from "../user/user.entity";
import { GatewayService } from "../gateway/gateway.service";
import { ChatAgentService } from "./chat-agent.service";
import type { AgentToolTrace } from "./chat-agent.service";

interface ChatMessageInput {
  role: "user" | "assistant" | "system";
  content: string;
}

interface SendMessageDto {
  conversationId?: string;
  model?: string;
  skillId?: string;
  messages: ChatMessageInput[];
  stream?: boolean;
}

const PUBLIC_BETA_FREE_TOKEN_LIMIT = 100000;

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatConversation)
    private conversationRepo: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private messageRepo: Repository<ChatMessage>,
    @InjectRepository(User)
    private userRepo: Repository<User>,
    private gatewayService: GatewayService,
    private chatAgentService: ChatAgentService
  ) {}

  async createConversation(
    userId: string,
    title?: string,
  ): Promise<ChatConversation> {
    const conversation = this.conversationRepo.create({
      userId,
      title: title?.trim() || "New chat",
      lastMessageAt: new Date(),
    });

    return this.conversationRepo.save(conversation);
  }

  async getConversations(userId: string): Promise<ChatConversation[]> {
    return this.conversationRepo.find({
      where: { userId, isActive: true },
      order: { updatedAt: "DESC" },
    });
  }

  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<ChatConversation> {
    const conversation = await this.conversationRepo.findOne({
      where: { id: conversationId, userId, isActive: true },
    });

    if (!conversation) {
      throw new NotFoundException("Conversation not found");
    }

    return conversation;
  }

  async getMessages(
    userId: string,
    conversationId: string,
  ): Promise<ChatMessage[]> {
    await this.getConversation(userId, conversationId);

    return this.messageRepo.find({
      where: { conversationId },
      order: { createdAt: "ASC" },
    });
  }

  async deleteConversation(
    userId: string,
    conversationId: string,
  ): Promise<void> {
    const conversation = await this.getConversation(userId, conversationId);
    conversation.isActive = false;
    await this.conversationRepo.save(conversation);
  }

  async addMessage(
    userId: string,
    conversationId: string,
    message: { role: 'user' | 'assistant'; content: string },
  ): Promise<ChatMessage> {
    await this.getConversation(userId, conversationId);
    return this.saveMessage(
      conversationId,
      userId,
      message.role,
      message.content,
      'gpt-3.5-turbo',
    );
  }

  async getAvailableModels() {
    return this.gatewayService.getAvailableModels("chat");
  }

  async sendMessage(
    userId: string,
    dto: SendMessageDto,
  ): Promise<{
    message: ChatMessage;
    conversation: ChatConversation;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
    model: string;
    cost: number;
    toolTraces: AgentToolTrace[];
  }> {
    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user || !user.isActive) {
      throw new NotFoundException("User not found");
    }

    const normalizedMessages = dto.messages
      .map((message) => ({
        role: message.role,
        content: message.content?.trim(),
      }))
      .filter((message) => message.content);

    if (!normalizedMessages.length) {
      throw new BadRequestException("Message content is required");
    }

    const latestUserMessage = [...normalizedMessages]
      .reverse()
      .find((message) => message.role === "user");
    if (!latestUserMessage) {
      throw new BadRequestException("A user message is required");
    }

    const selectedModel = dto.model || "vgo-cs";
    const isCustomerServiceModel = selectedModel === "vgo-cs";
    const isPublicBetaModel =
      await this.gatewayService.isModelPublicBetaFree(selectedModel);

    if (!user.isAdmin && isPublicBetaModel && !isCustomerServiceModel) {
      const betaTokenUsage = await this.getPublicBetaTokenUsage(userId);
      if (betaTokenUsage >= PUBLIC_BETA_FREE_TOKEN_LIMIT) {
        throw new BadRequestException(
          `当前账号的站内内测免费额度已用完（${PUBLIC_BETA_FREE_TOKEN_LIMIT.toLocaleString()} tokens），请切换正式模型或联系管理员调整额度。`,
        );
      }
    }

    if (!user.isAdmin && !isPublicBetaModel && !isCustomerServiceModel && Number(user.balance || 0) <= 0) {
      throw new BadRequestException("Insufficient balance");
    }

    let conversation = dto.conversationId
      ? await this.getConversation(userId, dto.conversationId)
      : await this.createConversation(
          userId,
          this.buildConversationTitle(latestUserMessage.content),
        );

    const savedUserMessage = await this.saveMessage(
      conversation.id,
      userId,
      "user",
      latestUserMessage.content,
      dto.model || "gpt-4o-mini",
    );

    const completion = await this.chatAgentService.runAgent({
            user,
            model: selectedModel,
            skillId: dto.skillId,
            messages: normalizedMessages,
            stream: dto.stream,
          });

    if (!user.isAdmin && !isPublicBetaModel && user.balance < completion.cost) {
      throw new BadRequestException("Insufficient balance");
    }

    if (!user.isAdmin && completion.cost > 0) {
      await this.gatewayService.deductBalance(userId, completion.cost);
    }

    const assistantContent =
      completion.content || "No response was returned from the model.";
    const usage = completion.usage;

    const savedAssistantMessage = await this.saveMessage(
      conversation.id,
      userId,
      "assistant",
      assistantContent,
      selectedModel || completion.model || "vgo-cs",
      usage?.total_tokens || 0,
      completion.cost,
    );

    conversation.title =
      conversation.title ||
      this.buildConversationTitle(latestUserMessage.content);
    conversation.messageCount += savedUserMessage ? 2 : 1;
    conversation.lastMessageAt = new Date();
    conversation = await this.conversationRepo.save(conversation);

    return {
      message: savedAssistantMessage,
      conversation,
      usage,
      model: selectedModel || completion.model || "vgo-customer-service",
      cost: completion.cost,
      toolTraces: completion.toolTraces || [],
    };
  }

  async getStats(userId?: string): Promise<{
    today: number;
    total: number;
    totalCost: number;
  }> {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const baseWhere = userId ? { userId } : {};

    const [todayMessages, totalMessages, costResult] = await Promise.all([
      this.messageRepo.count({
        where: {
          ...baseWhere,
          createdAt: Between(todayStart, todayEnd),
        },
      }),
      this.messageRepo.count({ where: baseWhere }),
      this.messageRepo
        .createQueryBuilder("msg")
        .select("SUM(msg.cost)", "total")
        .where(userId ? "msg.userId = :userId" : "1=1", { userId })
        .getRawOne(),
    ]);

    return {
      today: todayMessages,
      total: totalMessages,
      totalCost: parseFloat(costResult?.total || "0"),
    };
  }

  private buildConversationTitle(content: string) {
    const compact = content.replace(/\s+/g, " ").trim();
    return compact.length > 48
      ? `${compact.slice(0, 48)}...`
      : compact || "New chat";
  }

  private async getPublicBetaTokenUsage(userId: string) {
    const betaModelIds = await this.gatewayService.getPublicBetaModelIds();
    if (!betaModelIds.length) {
      return 0;
    }

    const result = await this.messageRepo
      .createQueryBuilder("msg")
      .select("COALESCE(SUM(msg.tokens), 0)", "total")
      .where("msg.userId = :userId", { userId })
      .andWhere("msg.role = :role", { role: "assistant" })
      .andWhere("msg.model IN (:...models)", { models: betaModelIds })
      .andWhere("msg.cost = 0")
      .getRawOne();

    return Number(result?.total || 0);
  }

  private async saveMessage(
    conversationId: string,
    userId: string,
    role: "user" | "assistant",
    content: string,
    model: string,
    tokens: number = 0,
    cost: number = 0,
  ): Promise<ChatMessage> {
    const message = this.messageRepo.create({
      conversationId,
      userId,
      role,
      content,
      model,
      tokens,
      cost,
    });

    return this.messageRepo.save(message);
  }
}

