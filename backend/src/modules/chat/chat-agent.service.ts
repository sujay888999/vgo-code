import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../user/user.entity";
import { Recharge } from "../recharge/recharge.entity";
import { PaymentMethod } from "../recharge/recharge.entity";
import { RequestLog } from "../gateway/request-log.entity";
import { Channel } from "../channel/channel.entity";
import { ChannelModel } from "../channel/channel-model.entity";
import { GatewayService } from "../gateway/gateway.service";
import { RechargeService } from "../recharge/recharge.service";
import { getChatSkillById } from "./chat-skill-registry";

type AgentMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
      tool_calls?: any[];
    }
  | { role: "tool"; content: string; tool_call_id: string };

interface ParsedTextToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface AgentToolTrace {
  name: string;
  label: string;
  arguments: Record<string, any>;
  status: "success" | "error";
  resultSummary: string;
  display?: Record<string, any>;
}

const TOOL_LABELS: Record<string, string> = {
  admin_list_channels: "渠道状态",
  admin_recent_request_errors: "错误请求",
};

const CHAT_TOOL_LABELS: Record<string, string> = {
  admin_list_channels: "渠道状态",
  admin_recent_request_errors: "错误请求",
};

const DISPLAY_TOOL_LABELS: Record<string, string> = {
  admin_list_channels: "渠道状态",
  admin_recent_request_errors: "错误请求",
  admin_platform_overview: "平台概览",
  admin_model_health_summary: "模型健康度",
  admin_channel_diagnostics: "渠道诊断",
  admin_incident_analysis: "异常分析",
};

const CLEAN_DISPLAY_TOOL_LABELS: Record<string, string> = {
  admin_list_channels: "渠道状态",
  admin_recent_request_errors: "错误请求",
  admin_platform_overview: "平台概览",
  admin_model_health_summary: "模型健康度",
  admin_channel_diagnostics: "渠道诊断",
  admin_incident_analysis: "异常分析",
};

@Injectable()
export class ChatAgentService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Recharge)
    private rechargeRepository: Repository<Recharge>,
    @InjectRepository(RequestLog)
    private requestLogRepository: Repository<RequestLog>,
    @InjectRepository(Channel)
    private channelRepository: Repository<Channel>,
    @InjectRepository(ChannelModel)
    private channelModelRepository: Repository<ChannelModel>,
    private gatewayService: GatewayService,
    private rechargeService: RechargeService,
  ) {}

  async runAgent(params: {
    user: User;
    model: string;
    skillId?: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    stream?: boolean;
  }) {
    const activeSkill = getChatSkillById(params.skillId, params.user.isAdmin);
    const toolDefinitions = this.buildTools(activeSkill.allowedTools);
    const workingMessages: AgentMessage[] = [
      {
        role: "system",
        content: this.buildSystemPrompt(params.user, activeSkill.systemPrompt),
      },
      ...params.messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];
    const toolModeEnabled = this.shouldUseToolMode(
      params.user,
      params.model,
      params.messages,
      activeSkill.allowedTools,
    );

    const usedTools: string[] = [];
    const toolTraces: AgentToolTrace[] = [];
    let totalCost = 0;
    let lastUsage:
      | {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        }
      | undefined;
    let finalModel = params.model;

    if (!toolModeEnabled) {
      const plainCompletion = await this.gatewayService.requestChatCompletion(
        {
          model: params.model,
          messages: workingMessages as Array<{
            role: string;
            content: string;
            tool_call_id?: string;
            tool_calls?: any[];
          }>,
          stream: params.stream,
        },
        "prefer-public-beta",
      );

      return {
        content:
          plainCompletion.data?.choices?.[0]?.message?.content ||
          "No response was returned from the model.",
        usage: plainCompletion.data?.usage,
        model: plainCompletion.data?.model || params.model,
        cost: Number(plainCompletion.cost.toFixed(6)),
        usedTools: [],
        toolTraces: [],
      };
    }

    for (let step = 0; step < 4; step += 1) {
      let completion;
      try {
        completion = await this.gatewayService.requestChatCompletion(
          {
            model: params.model,
            messages: workingMessages as Array<{
              role: string;
              content: string;
              tool_call_id?: string;
              tool_calls?: any[];
            }>,
            stream: params.stream,
            extraBody: {
              tools: toolDefinitions,
              tool_choice: "auto",
            },
          },
          "prefer-public-beta",
        );
      } catch (error) {
        if (step > 0) {
          throw error;
        }

        const plainCompletion = await this.gatewayService.requestChatCompletion(
          {
            model: params.model,
            messages: workingMessages as Array<{
              role: string;
              content: string;
              tool_call_id?: string;
              tool_calls?: any[];
            }>,
            stream: params.stream,
          },
          "prefer-public-beta",
        );

        return {
          content: plainCompletion.data?.choices?.[0]?.message?.content ||
            "No response was returned from the model.",
          usage: plainCompletion.data?.usage,
          model: plainCompletion.data?.model || params.model,
          cost: Number(plainCompletion.cost.toFixed(6)),
          usedTools: [],
          toolTraces: [],
        };
      }

      totalCost += completion.cost;
      lastUsage = completion.data?.usage;
      finalModel = completion.data?.model || params.model;

      const assistantMessage = completion.data?.choices?.[0]?.message;
      const toolCalls = assistantMessage?.tool_calls || [];
      const parsedTextToolCalls = !toolCalls.length
        ? this.parseTextToolCalls(assistantMessage?.content)
        : [];

      if (!toolCalls.length && !parsedTextToolCalls.length) {
        return {
          content: this.decorateFinalContent(
            assistantMessage?.content,
            usedTools,
          ),
          usage: lastUsage,
          model: finalModel,
          cost: Number(totalCost.toFixed(6)),
          usedTools,
          toolTraces,
        };
      }

      workingMessages.push({
        role: "assistant",
        content: assistantMessage?.content || "",
        tool_calls: toolCalls,
      });

      for (const toolCall of toolCalls) {
        const toolName = toolCall?.function?.name || "unknown_tool";
        const args = this.safeParseArguments(toolCall?.function?.arguments);
        const result = await this.executeTool(toolName, args, params.user);
        usedTools.push(toolName);
        toolTraces.push(this.buildToolTrace(toolName, args, result));
        workingMessages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: JSON.stringify(result, null, 2),
        });
      }

      for (const toolCall of parsedTextToolCalls) {
        const toolName = this.normalizeToolName(toolCall.name);
        const result = await this.executeTool(
          toolName,
          toolCall.arguments,
          params.user,
        );
        usedTools.push(toolName);
        toolTraces.push(
          this.buildToolTrace(toolName, toolCall.arguments, result),
        );
        workingMessages.push({
          role: "system",
          content: `Tool result for ${toolName}: ${JSON.stringify(result)}. Now answer the user directly in Chinese without emitting another tool call unless absolutely necessary.`,
        });
      }
    }

    return {
      content: this.decorateFinalContent(
        "已经达到本轮 Agent 工具调用上限，请把问题再具体一点后重试。",
        usedTools,
      ),
      usage: lastUsage,
      model: finalModel,
      cost: Number(totalCost.toFixed(6)),
      usedTools,
      toolTraces,
    };
  }

  private shouldUseToolMode(
    user: User,
    model: string,
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>,
    allowedTools: string[],
  ) {
    if (!allowedTools.length) {
      return false;
    }

    const latestUserMessage = [...messages]
      .reverse()
      .find((message) => message.role === "user")?.content
      ?.toLowerCase()
      ?.trim();

    if (!latestUserMessage) {
      return false;
    }

    const toolIntentKeywords = [
      "余额",
      "充值",
      "订单",
      "支付",
      "套餐",
      "赠送",
      "用量",
      "消耗",
      "模型目录",
      "模型列表",
      "推荐模型",
      "api",
      "接入",
      "文档",
      "渠道",
      "报错",
      "错误",
      "日志",
      "平台概览",
      "诊断",
      "异常",
      "查一下",
      "查询",
      "查看",
      "账户",
      "profile",
      "balance",
      "recharge",
      "usage",
      "payment",
      "invoice",
      "order",
      "channel",
      "log",
      "error",
      "diagnostic",
    ];

    const asksForTooling = toolIntentKeywords.some((keyword) =>
      latestUserMessage.includes(keyword),
    );

    if (asksForTooling) {
      return true;
    }

    if (user.isAdmin) {
      const adminIntentKeywords = [
        "管理",
        "后台",
        "用户数",
        "请求量",
        "失败率",
        "健康度",
        "incident",
        "ops",
        "admin",
      ];

      return adminIntentKeywords.some((keyword) =>
        latestUserMessage.includes(keyword),
      );
    }

    if (model.includes("free")) {
      return false;
    }

    return false;
  }

  private buildSystemPrompt(user: User, skillPrompt: string) {
    return [
      "You are the VGO AI workspace agent.",
      skillPrompt,
      "Answer the user's questions directly and helpfully.",
      `Current user is ${user.isAdmin ? "an admin" : "a regular user"}.`,
      `Current date is ${new Date().toISOString().slice(0, 10)}.`,
    ].join(" ");
  }

  private buildTools(allowedTools: string[]) {
    return [
      {
        type: "function",
        function: {
          name: "admin_list_channels",
          description:
            "For admin users only. List current configured model channels and their status.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      },
      {
        type: "function",
        function: {
          name: "admin_recent_request_errors",
          description:
            "For admin users only. Get recent failed or error request logs.",
          parameters: {
            type: "object",
            properties: {
              limit: { type: "integer", minimum: 1, maximum: 10 },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "admin_platform_overview",
          description:
            "For admin users only. Get a compact overview of platform activity, balances, requests, and conversations.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      },
      {
        type: "function",
        function: {
          name: "admin_model_health_summary",
          description:
            "For admin users only. Summarize model request volume, success rate, latency, and cost over recent days.",
          parameters: {
            type: "object",
            properties: {
              days: { type: "integer", minimum: 1, maximum: 30 },
              limit: { type: "integer", minimum: 1, maximum: 10 },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "admin_channel_diagnostics",
          description:
            "For admin users only. Summarize channel health, request count, average latency, and recent error count.",
          parameters: {
            type: "object",
            properties: {
              days: { type: "integer", minimum: 1, maximum: 30 },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "admin_incident_analysis",
          description:
            "For admin users only. Analyze recent platform instability, identify likely causes, and recommend concrete next steps.",
          parameters: {
            type: "object",
            properties: {
              days: { type: "integer", minimum: 1, maximum: 30 },
              limit: { type: "integer", minimum: 1, maximum: 10 },
            },
          },
        },
      },
    ].filter((tool) => allowedTools.includes(tool.function.name));
  }

  private safeParseArguments(raw: string | undefined) {
    if (!raw) return {};

    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  private parseTextToolCalls(
    content: string | undefined,
  ): ParsedTextToolCall[] {
    if (!content) return [];

    const matches = Array.from(
      content.matchAll(/\[TOOL_CALL\]([\s\S]*?)\[\/TOOL_CALL\]/g),
    );
    if (!matches.length) {
      return [];
    }

    return matches
      .map((match, index) => {
        const block = match[1] || "";
        const nameMatch =
          block.match(/tool\s*=>\s*"([^"]+)"/i) ||
          block.match(/tool\s*:\s*"([^"]+)"/i) ||
          block.match(/name\s*=>\s*"([^"]+)"/i);
        const argsMatch =
          block.match(/args\s*=>\s*(\{[\s\S]*\})/i) ||
          block.match(/arguments\s*=>\s*(\{[\s\S]*\})/i) ||
          block.match(/args\s*:\s*(\{[\s\S]*\})/i);

        return {
          id: `text-tool-${index + 1}`,
          name: nameMatch?.[1] || "unknown_tool",
          arguments: this.safeParseLooseObject(argsMatch?.[1]),
        };
      })
      .filter((item) => item.name);
  }

  private safeParseLooseObject(raw: string | undefined) {
    if (!raw) return {};

    try {
      return JSON.parse(raw);
    } catch {
      const normalized = raw
        .replace(/=>/g, ":")
        .replace(/([,{]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/:\s*([a-zA-Z_][a-zA-Z0-9_-]*)/g, ': "$1"');

      try {
        return JSON.parse(normalized);
      } catch {
        return {};
      }
    }
  }

  private normalizeToolName(name: string) {
    const normalized = String(name || "")
      .trim()
      .toLowerCase();
    const aliasMap: Record<string, string> = {
      balancedisplayer: "get_my_balance",
      balance_display: "get_my_balance",
      get_balance: "get_my_balance",
      show_balance: "get_my_balance",
      profileviewer: "get_my_profile",
      get_profile: "get_my_profile",
      modelcatalog: "list_available_models",
      list_models: "list_available_models",
      rechargeviewer: "get_recent_recharges",
      recent_recharges: "get_recent_recharges",
      usageviewer: "get_usage_summary",
      usage_summary: "get_usage_summary",
      list_channels: "admin_list_channels",
      recent_errors: "admin_recent_request_errors",
      platform_overview: "admin_platform_overview",
      model_health: "admin_model_health_summary",
      channel_diagnostics: "admin_channel_diagnostics",
      incident_analysis: "admin_incident_analysis",
    };

    return aliasMap[normalized] || name;
  }

  private async executeTool(name: string, args: any, user: User) {
    switch (name) {
      case "admin_list_channels":
        return user.isAdmin
          ? this.adminListChannels()
          : { error: "Admin access required" };
      case "admin_recent_request_errors":
        return user.isAdmin
          ? this.adminRecentRequestErrors(args?.limit)
          : { error: "Admin access required" };
      case "admin_platform_overview":
        return user.isAdmin
          ? this.adminPlatformOverview()
          : { error: "Admin access required" };
      case "admin_model_health_summary":
        return user.isAdmin
          ? this.adminModelHealthSummary(args?.days, args?.limit)
          : { error: "Admin access required" };
      case "admin_channel_diagnostics":
        return user.isAdmin
          ? this.adminChannelDiagnostics(args?.days)
          : { error: "Admin access required" };
      case "admin_incident_analysis":
        return user.isAdmin
          ? this.adminIncidentAnalysis(args?.days, args?.limit)
          : { error: "Admin access required" };
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  private async getMyProfile(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      return { error: "User not found" };
    }

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      balance: Number(user.balance),
      isAdmin: user.isAdmin,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }

  private async getMyBalance(userId: string) {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    return {
      balance: Number(user?.balance || 0),
    };
  }

  private async getRecentRecharges(userId: string, limit: number = 5) {
    const records = await this.rechargeRepository.find({
      where: { userId },
      order: { createdAt: "DESC" },
      take: Math.min(Math.max(Number(limit) || 5, 1), 10),
    });

    return records.map((item) => ({
      orderNo: item.orderNo,
      amount: Number(item.amount),
      bonus: Number(item.bonus),
      paymentMethod: item.paymentMethod,
      paymentStatus: item.paymentStatus,
      createdAt: item.createdAt,
      paidAt: item.paidAt,
    }));
  }

  private async getUsageSummary(userId: string, days: number = 7) {
    const normalizedDays = Math.min(Math.max(Number(days) || 7, 1), 30);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - normalizedDays);

    const stats = await this.requestLogRepository
      .createQueryBuilder("log")
      .select("COUNT(*)", "requests")
      .addSelect("COALESCE(SUM(log.total_tokens), 0)", "tokens")
      .addSelect("COALESCE(SUM(log.cost), 0)", "cost")
      .where("log.user_id = :userId", { userId })
      .andWhere("log.created_at >= :startDate", { startDate })
      .getRawOne();

    return {
      days: normalizedDays,
      requests: Number(stats?.requests || 0),
      totalTokens: Number(stats?.tokens || 0),
      totalCost: Number(stats?.cost || 0),
    };
  }

  private async adminListChannels() {
    const channels = await this.channelRepository.find({
      relations: ["modelConfigs"],
      order: { priority: "DESC" },
    });

    return channels.map((channel) => ({
      name: channel.name,
      type: channel.channelType,
      baseUrl: channel.baseUrl,
      status: channel.status,
      isActive: channel.isActive,
      models: channel.models,
      balance: Number(channel.balance),
      priceRate: Number(channel.priceRate),
      modelConfigs:
        channel.modelConfigs?.map((item) => ({
          modelName: item.modelName,
          inputPrice: Number(item.inputPrice),
          outputPrice: Number(item.outputPrice),
          isActive: item.isActive,
        })) || [],
    }));
  }

  private async adminRecentRequestErrors(limit: number = 5) {
    const records = await this.requestLogRepository.find({
      where: [
        { statusCode: 400 as any },
        { statusCode: 401 as any },
        { statusCode: 403 as any },
        { statusCode: 404 as any },
        { statusCode: 429 as any },
        { statusCode: 500 as any },
      ],
      order: { createdAt: "DESC" },
      take: Math.min(Math.max(Number(limit) || 5, 1), 10),
      relations: ["channel", "user"],
    });

    return records.map((item) => ({
      createdAt: item.createdAt,
      model: item.model,
      statusCode: item.statusCode,
      errorMessage: item.errorMessage,
      channel: item.channel?.name,
      user: item.user?.email,
    }));
  }

  private previewRechargeBonus(amount: number) {
    const numericAmount = Number(amount || 0);
    if (numericAmount <= 0) {
      return { error: "Amount must be greater than 0" };
    }

    let bonus = 0;
    if (numericAmount >= 2000) bonus = 500;
    else if (numericAmount >= 1000) bonus = 200;
    else if (numericAmount >= 500) bonus = 75;
    else if (numericAmount >= 200) bonus = 20;
    else if (numericAmount >= 100) bonus = 5;

    return {
      amount: numericAmount,
      bonus,
      total: numericAmount + bonus,
    };
  }

  private describePaymentMethods() {
    return [
      { id: "stripe", label: "Stripe / bank card", mode: "redirect" },
      { id: "alipay", label: "Alipay", mode: "redirect" },
      { id: "wechat", label: "WeChat Pay", mode: "redirect" },
      { id: "paypal", label: "PayPal", mode: "redirect" },
      { id: "usdt", label: "USDT", mode: "manual_crypto" },
    ];
  }

  private async createRechargeOrder(
    userId: string,
    amount: number,
    paymentMethod?: string,
    confirm?: boolean,
  ) {
    const normalizedAmount = Number(amount || 0);
    if (normalizedAmount <= 0) {
      return { error: "Recharge amount must be greater than 0" };
    }

    if (!paymentMethod) {
      return {
        error:
          "Payment method is required before creating an order. Choose one of: stripe, alipay, wechat, paypal, usdt",
      };
    }

    const normalizedMethod = this.normalizePaymentMethod(paymentMethod);
    if (!normalizedMethod) {
      return {
        error:
          "Unsupported payment method. Use one of: stripe, alipay, wechat, paypal, usdt",
      };
    }

    const preview = this.previewRechargeBonus(normalizedAmount);
    if (!confirm) {
      return {
        confirmationRequired: true,
        amount: normalizedAmount,
        paymentMethod: normalizedMethod,
        bonus: preview?.bonus || 0,
        total: preview?.total || normalizedAmount,
        message: "Recharge order confirmation is required before creation.",
      };
    }

    return this.rechargeService.createRecharge(
      userId,
      normalizedAmount,
      normalizedMethod,
    );
  }

  private async getRechargeOrderStatus(
    userId: string,
    orderNo: string,
    refresh?: boolean,
  ) {
    const normalizedOrderNo = String(orderNo || "").trim();
    if (!normalizedOrderNo) {
      return { error: "orderNo is required" };
    }

    if (refresh) {
      return this.rechargeService.refreshPaymentStatus(
        userId,
        normalizedOrderNo,
      );
    }

    return this.rechargeService.getRechargeDetailsForUser(
      userId,
      normalizedOrderNo,
    );
  }

  private async recommendRechargePackage(
    budget: number,
    prioritizeBonus?: boolean,
  ) {
    const normalizedBudget = Number(budget || 0);
    if (normalizedBudget <= 0) {
      return { error: "Budget must be greater than 0" };
    }

    const packages = await this.rechargeService.getRechargePackages();
    const affordable = packages.filter(
      (item) => Number(item.amount) <= normalizedBudget,
    );
    const sorted = [...(affordable.length ? affordable : packages)].sort(
      (a, b) => {
        if (prioritizeBonus) {
          const bonusDiff = Number(b.bonus) - Number(a.bonus);
          if (bonusDiff !== 0) return bonusDiff;
        }

        return Number(b.amount) - Number(a.amount);
      },
    );

    const recommended = sorted[0];

    return {
      budget: normalizedBudget,
      prioritizeBonus: !!prioritizeBonus,
      recommended,
      affordablePackages: affordable,
      allPackages: packages,
    };
  }

  private async adminPlatformOverview() {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);

    const [totalUsers, activeUsers, adminUsers] = await Promise.all([
      this.userRepository.count(),
      this.userRepository.count({ where: { isActive: true } }),
      this.userRepository.count({ where: { isAdmin: true } }),
    ]);

    const [balanceRow, paidRechargeRow, requestRow, errorRow] =
      await Promise.all([
        this.userRepository
          .createQueryBuilder("user")
          .select("COALESCE(SUM(user.balance), 0)", "total")
          .getRawOne(),
        this.rechargeRepository
          .createQueryBuilder("recharge")
          .select("COALESCE(SUM(recharge.amount), 0)", "total")
          .where("recharge.payment_status = :status", { status: "paid" })
          .getRawOne(),
        this.requestLogRepository
          .createQueryBuilder("log")
          .select("COUNT(*)", "requests")
          .addSelect("COALESCE(SUM(log.cost), 0)", "cost")
          .addSelect("COALESCE(AVG(log.latency_ms), 0)", "avgLatency")
          .where("log.created_at >= :startDate", { startDate })
          .getRawOne(),
        this.requestLogRepository
          .createQueryBuilder("log")
          .select("COUNT(*)", "errors")
          .where("log.created_at >= :startDate", { startDate })
          .andWhere("log.status_code >= 400")
          .getRawOne(),
      ]);

    return {
      windowDays: 7,
      users: {
        total: totalUsers,
        active: activeUsers,
        admins: adminUsers,
      },
      balance: {
        total: Number(balanceRow?.total || 0),
      },
      recharges: {
        paidTotal: Number(paidRechargeRow?.total || 0),
      },
      requests: {
        total: Number(requestRow?.requests || 0),
        totalCost: Number(requestRow?.cost || 0),
        avgLatencyMs: Number(requestRow?.avgLatency || 0),
        errorCount: Number(errorRow?.errors || 0),
      },
    };
  }

  private async adminModelHealthSummary(days: number = 7, limit: number = 5) {
    const normalizedDays = Math.min(Math.max(Number(days) || 7, 1), 30);
    const normalizedLimit = Math.min(Math.max(Number(limit) || 5, 1), 10);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - normalizedDays);

    const rows = await this.requestLogRepository
      .createQueryBuilder("log")
      .select("log.model", "model")
      .addSelect("COUNT(*)", "requests")
      .addSelect(
        "SUM(CASE WHEN log.status_code >= 400 THEN 1 ELSE 0 END)",
        "errors",
      )
      .addSelect("COALESCE(AVG(log.latency_ms), 0)", "avgLatencyMs")
      .addSelect("COALESCE(SUM(log.cost), 0)", "totalCost")
      .where("log.created_at >= :startDate", { startDate })
      .groupBy("log.model")
      .orderBy("COUNT(*)", "DESC")
      .limit(normalizedLimit)
      .getRawMany();

    return {
      days: normalizedDays,
      models: rows.map((row) => {
        const requests = Number(row.requests || 0);
        const errors = Number(row.errors || 0);
        return {
          model: row.model,
          requests,
          errors,
          successRate:
            requests > 0
              ? Number((((requests - errors) / requests) * 100).toFixed(2))
              : 100,
          avgLatencyMs: Number(Number(row.avgLatencyMs || 0).toFixed(2)),
          totalCost: Number(row.totalCost || 0),
        };
      }),
    };
  }

  private async adminChannelDiagnostics(days: number = 7) {
    const normalizedDays = Math.min(Math.max(Number(days) || 7, 1), 30);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - normalizedDays);

    const rows = await this.requestLogRepository
      .createQueryBuilder("log")
      .leftJoin("log.channel", "channel")
      .select("COALESCE(channel.name, 'Unassigned')", "channelName")
      .addSelect("COUNT(*)", "requests")
      .addSelect(
        "SUM(CASE WHEN log.status_code >= 400 THEN 1 ELSE 0 END)",
        "errors",
      )
      .addSelect("COALESCE(AVG(log.latency_ms), 0)", "avgLatencyMs")
      .addSelect("COALESCE(SUM(log.cost), 0)", "totalCost")
      .where("log.created_at >= :startDate", { startDate })
      .groupBy("channel.name")
      .orderBy("COUNT(*)", "DESC")
      .getRawMany();

    const channels = await this.channelRepository.find({
      order: { priority: "DESC" },
    });
    const diagnostics = channels.map((channel) => {
      const matched = rows.find((row) => row.channelName === channel.name);
      return {
        name: channel.name,
        type: channel.channelType,
        isActive: channel.isActive,
        status: channel.status,
        balance: Number(channel.balance),
        requests: Number(matched?.requests || 0),
        errors: Number(matched?.errors || 0),
        avgLatencyMs: Number(Number(matched?.avgLatencyMs || 0).toFixed(2)),
        totalCost: Number(matched?.totalCost || 0),
      };
    });

    return {
      days: normalizedDays,
      channels: diagnostics,
    };
  }

  private async adminIncidentAnalysis(days: number = 7, limit: number = 5) {
    const normalizedDays = Math.min(Math.max(Number(days) || 7, 1), 30);
    const normalizedLimit = Math.min(Math.max(Number(limit) || 5, 1), 10);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - normalizedDays);

    const [
      overview,
      modelHealth,
      channelDiagnostics,
      recentErrors,
      topStatuses,
    ] = await Promise.all([
      this.adminPlatformOverview(),
      this.adminModelHealthSummary(normalizedDays, normalizedLimit),
      this.adminChannelDiagnostics(normalizedDays),
      this.adminRecentRequestErrors(normalizedLimit),
      this.requestLogRepository
        .createQueryBuilder("log")
        .select("log.status_code", "statusCode")
        .addSelect("COUNT(*)", "count")
        .where("log.created_at >= :startDate", { startDate })
        .andWhere("log.status_code >= 400")
        .groupBy("log.status_code")
        .orderBy("COUNT(*)", "DESC")
        .limit(5)
        .getRawMany(),
    ]);

    const topFailingModel = [...(modelHealth.models || [])].sort((a, b) => {
      if ((b.errors || 0) !== (a.errors || 0)) {
        return (b.errors || 0) - (a.errors || 0);
      }
      return (a.successRate || 100) - (b.successRate || 100);
    })[0];

    const topFailingChannel = [...(channelDiagnostics.channels || [])].sort(
      (a, b) => {
        if ((b.errors || 0) !== (a.errors || 0)) {
          return (b.errors || 0) - (a.errors || 0);
        }
        return (b.requests || 0) - (a.requests || 0);
      },
    )[0];

    const recommendations: string[] = [];

    if (
      (overview.requests?.errorCount || 0) > 0 &&
      (overview.requests?.total || 0) > 0
    ) {
      const errorRate =
        (overview.requests.errorCount / overview.requests.total) * 100;
      if (errorRate >= 10) {
        recommendations.push(
          "近期整体错误率偏高，建议先限制异常模型或异常渠道的流量，并优先检查上游接口稳定性。",
        );
      }
    }

    if (topFailingModel && (topFailingModel.errors || 0) > 0) {
      recommendations.push(
        `优先检查模型 ${topFailingModel.model}，它在近 ${normalizedDays} 天内错误最多，成功率约为 ${topFailingModel.successRate}%。`,
      );
    }

    if (topFailingChannel && (topFailingChannel.errors || 0) > 0) {
      recommendations.push(
        `优先检查渠道 ${topFailingChannel.name}，它近 ${normalizedDays} 天错误 ${topFailingChannel.errors} 次，平均延迟 ${topFailingChannel.avgLatencyMs} ms。`,
      );
    }

    const status409Or429 = topStatuses.find(
      (item) => Number(item.statusCode) === 429,
    );
    if (status409Or429) {
      recommendations.push(
        "出现较多 429 限流错误，建议检查渠道额度、上游 QPS 限制，必要时增加备用通道。",
      );
    }

    const status500 = topStatuses.find(
      (item) => Number(item.statusCode) >= 500,
    );
    if (status500) {
      recommendations.push(
        "存在 5xx 上游或服务端异常，建议结合最近错误请求样本核对 base URL、模型映射和上游返回体。",
      );
    }

    if (!recommendations.length) {
      recommendations.push(
        "当前没有明显的大范围异常聚集，建议继续观察最近错误请求和模型健康趋势。",
      );
    }

    return {
      days: normalizedDays,
      overview,
      topFailingModel: topFailingModel || null,
      topFailingChannel: topFailingChannel || null,
      topStatuses: topStatuses.map((item) => ({
        statusCode: Number(item.statusCode || 0),
        count: Number(item.count || 0),
      })),
      recentErrors,
      recommendations,
    };
  }

  private normalizePaymentMethod(paymentMethod?: string): PaymentMethod | null {
    const normalized = String(paymentMethod || "stripe")
      .trim()
      .toLowerCase();
    const mapping: Record<string, PaymentMethod> = {
      stripe: PaymentMethod.STRIPE,
      alipay: PaymentMethod.ALIPAY,
      wechat: PaymentMethod.WECHAT,
      paypal: PaymentMethod.PAYPAL,
      usdt: PaymentMethod.USDT,
    };

    return mapping[normalized] || null;
  }

  private buildToolTrace(
    name: string,
    args: Record<string, any>,
    result: any,
  ): AgentToolTrace {
    const status = result?.error ? "error" : "success";

    return {
      name,
      label: CLEAN_DISPLAY_TOOL_LABELS[name] || name,
      arguments: args || {},
      status,
      resultSummary: this.summarizeToolResult(name, result),
      display: this.buildToolDisplay(name, result),
    };
  }

  private buildToolDisplay(name: string, result: any) {
    if (result?.error) {
      return undefined;
    }

    if (name === "create_recharge_order") {
      if (result?.confirmationRequired) {
        return {
          kind: "recharge_confirm",
          paymentMethod: result?.paymentMethod,
          amount: result?.amount,
          bonus: result?.bonus,
          total: result?.total,
          message: result?.message || "",
        };
      }

      return {
        kind: "recharge_order",
        orderNo: result?.orderNo,
        paymentMethod: result?.paymentMethod,
        status: result?.status,
        amount: result?.amount,
        bonus: result?.bonus,
        total: result?.total,
        paymentUrl: result?.checkout?.paymentUrl || "",
        provider: result?.checkout?.provider || "",
        walletAddress: result?.checkout?.walletAddress || "",
        network: result?.checkout?.network || "",
        currency: result?.checkout?.currency || "",
        mode: result?.checkout?.mode || "",
        message: result?.checkout?.message || "",
      };
    }

    if (name === "recommend_recharge_package") {
      return {
        kind: "recharge_recommendation",
        budget: result?.budget,
        prioritizeBonus: result?.prioritizeBonus,
        recommended: result?.recommended,
        affordablePackages: result?.affordablePackages || [],
      };
    }

    if (name === "get_recharge_order_status") {
      const recharge = result?.recharge || result;
      return {
        kind: "recharge_status",
        orderNo: recharge?.orderNo,
        paymentMethod: recharge?.paymentMethod,
        status: recharge?.paymentStatus || recharge?.status,
        amount: recharge?.amount,
        bonus: recharge?.bonus,
        total: recharge?.total,
        paidAt: recharge?.paidAt,
        createdAt: recharge?.createdAt,
        message: result?.message || "",
      };
    }

    return undefined;
  }

  private summarizeToolResult(name: string, result: any) {
    if (result?.error) {
      return String(result.error);
    }

    if (name === "get_my_balance")
      return `当前余额 ${Number(result?.balance || 0)}`;
    if (name === "get_my_profile")
      return `${result?.username || "当前用户"}，邮箱 ${result?.email || "-"}`;
    if (name === "list_available_models")
      return Array.isArray(result)
        ? `找到 ${result.length} 个可用模型`
        : "已返回模型目录";
    if (name === "get_recent_recharges")
      return Array.isArray(result)
        ? `找到 ${result.length} 条最近充值记录`
        : "已返回充值记录";
    if (name === "get_usage_summary")
      return `近 ${result?.days || 0} 天 ${result?.requests || 0} 次请求，总成本 ${Number(result?.totalCost || 0)}`;
    if (name === "get_recharge_packages")
      return Array.isArray(result)
        ? `当前有 ${result.length} 个充值档位`
        : "已返回充值套餐";
    if (name === "preview_recharge_bonus")
      return `充值 ${result?.amount || 0}，预计赠送 ${result?.bonus || 0}`;
    if (name === "describe_payment_methods")
      return Array.isArray(result)
        ? `支持 ${result.length} 种支付方式`
        : "已返回支付方式";

    if (name === "recommend_recharge_package") {
      return result?.recommended
        ? `预算 ${result.budget || 0}，推荐档位 ${result.recommended.display || result.recommended.amount}`
        : "已返回充值推荐";
    }

    if (name === "create_recharge_order") {
      if (result?.confirmationRequired) {
        return `待确认创建订单，支付方式 ${result.paymentMethod || "-"}，到账 ${result.total || result.amount || 0}`;
      }

      return result?.orderNo
        ? `订单 ${result.orderNo} 已创建，支付方式 ${result.paymentMethod || "-"}，待支付 ${result.total || result.amount || 0}`
        : "已尝试创建充值订单";
    }

    if (name === "get_recharge_order_status") {
      if (result?.recharge?.orderNo) {
        return `订单 ${result.recharge.orderNo} 当前状态 ${result.recharge.paymentStatus || result.recharge.status || "-"}`;
      }

      return result?.orderNo
        ? `订单 ${result.orderNo} 当前状态 ${result.paymentStatus || result.status || "-"}`
        : "已返回订单状态";
    }

    if (name === "admin_list_channels")
      return Array.isArray(result)
        ? `当前有 ${result.length} 个渠道配置`
        : "已返回渠道状态";
    if (name === "admin_recent_request_errors")
      return Array.isArray(result)
        ? `找到 ${result.length} 条最近错误请求`
        : "已返回错误请求";
    if (name === "admin_platform_overview") {
      return `平台近 ${result?.windowDays || 0} 天请求 ${result?.requests?.total || 0} 次，错误 ${result?.requests?.errorCount || 0} 次`;
    }
    if (name === "admin_model_health_summary") {
      return Array.isArray(result?.models)
        ? `已汇总 ${result.models.length} 个模型的健康情况`
        : "已返回模型健康度";
    }
    if (name === "admin_channel_diagnostics") {
      return Array.isArray(result?.channels)
        ? `已诊断 ${result.channels.length} 个渠道`
        : "已返回渠道诊断";
    }
    if (name === "admin_incident_analysis") {
      const modelName = result?.topFailingModel?.model || "未识别";
      const channelName = result?.topFailingChannel?.name || "未识别";
      return `近 ${result?.days || 0} 天异常分析已完成，重点关注模型 ${modelName} 与渠道 ${channelName}`;
    }

    if (name === "get_my_balance") {
      return `当前余额 ${Number(result?.balance || 0)}`;
    }

    if (name === "get_my_profile") {
      return `${result?.username || "当前用户"}，邮箱 ${result?.email || "-"}`;
    }

    if (name === "list_available_models") {
      return Array.isArray(result)
        ? `找到 ${result.length} 个可用模型`
        : "已返回模型目录";
    }

    if (name === "get_recent_recharges") {
      return Array.isArray(result)
        ? `找到 ${result.length} 条最近充值记录`
        : "已返回充值记录";
    }

    if (name === "get_usage_summary") {
      return `近 ${result?.days || 0} 天 ${result?.requests || 0} 次请求，总成本 ${Number(result?.totalCost || 0)}`;
    }

    if (name === "get_recharge_packages") {
      return Array.isArray(result)
        ? `当前有 ${result.length} 个充值档位`
        : "已返回充值套餐";
    }

    if (name === "preview_recharge_bonus") {
      return `充值 ${result?.amount || 0}，预计赠送 ${result?.bonus || 0}`;
    }

    if (name === "describe_payment_methods") {
      return Array.isArray(result)
        ? `支持 ${result.length} 种支付方式`
        : "已返回支付方式";
    }

    if (name === "recommend_recharge_package") {
      return result?.recommended
        ? `预算 ${result.budget || 0}，推荐档位 ${result.recommended.display || result.recommended.amount}`
        : "已返回充值推荐";
    }

    if (name === "create_recharge_order") {
      if (result?.confirmationRequired) {
        return `待确认创建订单，支付方式 ${result.paymentMethod || "-"}，到账 ${result.total || result.amount || 0}`;
      }

      return result?.orderNo
        ? `订单 ${result.orderNo} 已创建，支付方式 ${result.paymentMethod || "-"}，待支付 ${result.total || result.amount || 0}`
        : "已尝试创建充值订单";
    }

    if (name === "get_recharge_order_status") {
      if (result?.recharge?.orderNo) {
        return `订单 ${result.recharge.orderNo} 当前状态 ${result.recharge.paymentStatus || result.recharge.status || "-"}`;
      }

      return result?.orderNo
        ? `订单 ${result.orderNo} 当前状态 ${result.paymentStatus || result.status || "-"}`
        : "已返回订单状态";
    }

    if (name === "admin_list_channels") {
      return Array.isArray(result)
        ? `当前有 ${result.length} 个渠道配置`
        : "已返回渠道状态";
    }

    if (name === "admin_recent_request_errors") {
      return Array.isArray(result)
        ? `找到 ${result.length} 条最近错误请求`
        : "已返回错误请求";
    }

    if (name === "admin_platform_overview") {
      return `平台近 ${result?.windowDays || 0} 天请求 ${result?.requests?.total || 0} 次，错误 ${result?.requests?.errorCount || 0} 次`;
    }

    if (name === "admin_model_health_summary") {
      return Array.isArray(result?.models)
        ? `已汇总 ${result.models.length} 个模型的健康情况`
        : "已返回模型健康度";
    }

    if (name === "admin_channel_diagnostics") {
      return Array.isArray(result?.channels)
        ? `已诊断 ${result.channels.length} 个渠道`
        : "已返回渠道诊断";
    }

    switch (name) {
      case "get_my_balance":
        return `当前余额 ${Number(result?.balance || 0)}`;
      case "get_my_profile":
        return `${result?.username || "当前用户"}，邮箱 ${result?.email || "-"}`;
      case "list_available_models":
        return Array.isArray(result)
          ? `找到 ${result.length} 个可用模型`
          : "已返回模型目录";
      case "get_recent_recharges":
        return Array.isArray(result)
          ? `找到 ${result.length} 条最近充值记录`
          : "已返回充值记录";
      case "get_usage_summary":
        return `近 ${result?.days || 0} 天 ${result?.requests || 0} 次请求`;
      case "get_recharge_packages":
        return Array.isArray(result)
          ? `当前有 ${result.length} 个充值档位`
          : "已返回充值套餐";
      case "preview_recharge_bonus":
        return `充值 ${result?.amount || 0}，预计赠送 ${result?.bonus || 0}`;
      case "describe_payment_methods":
        return Array.isArray(result)
          ? `支持 ${result.length} 种支付方式`
          : "已返回支付方式";
      case "recommend_recharge_package":
        return result?.recommended
          ? `预算 ${result.budget || 0}，推荐档位 ${result.recommended.display || result.recommended.amount}`
          : "已返回充值推荐";
      case "create_recharge_order":
        return result?.confirmationRequired
          ? `待确认创建订单，支付方式 ${result.paymentMethod || "-"}，到账 ${result.total || result.amount || 0}`
          : result?.orderNo
            ? `订单 ${result.orderNo} 已创建，支付方式 ${result.paymentMethod || "-"}，待支付 ${result.total || result.amount || 0}`
            : "已尝试创建充值订单";
      case "get_recharge_order_status":
        return result?.recharge?.orderNo
          ? `订单 ${result.recharge.orderNo} 当前状态 ${result.recharge.paymentStatus || result.recharge.status || "-"}`
          : result?.orderNo
            ? `订单 ${result.orderNo} 当前状态 ${result.paymentStatus || result.status || "-"}`
            : "已返回订单状态";
      case "admin_list_channels":
        return Array.isArray(result)
          ? `当前有 ${result.length} 个渠道`
          : "已返回渠道状态";
      case "admin_recent_request_errors":
        return Array.isArray(result)
          ? `找到 ${result.length} 条最近错误请求`
          : "已返回错误请求";
      default:
        return "工具执行完成";
    }
  }

  private decorateFinalContent(
    content: string | undefined,
    usedTools: string[],
  ) {
    if (!content) {
      content = "已完成本轮 Agent 响应。";
    }
    const finalContent = (content || "已完成本轮 Agent 响应。").trim();

    if (!usedTools.length) {
      return finalContent;
    }

    const toolSummary = Array.from(new Set(usedTools)).join(", ");
    return `${finalContent}\n\n[Agent tools used: ${toolSummary}]`;
  }
}
