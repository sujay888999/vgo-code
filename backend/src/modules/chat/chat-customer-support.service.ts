import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { User } from "../user/user.entity";
import { Recharge } from "../recharge/recharge.entity";
import { GatewayService } from "../gateway/gateway.service";
import { RechargeService } from "../recharge/recharge.service";
import type { AgentToolTrace } from "./chat-agent.service";

type SupportReply = {
  content: string;
  usedTools: string[];
  toolTraces: AgentToolTrace[];
  cost: number;
  model: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type FaqEntry = {
  id: string;
  title: string;
  keywords: string[];
  answer: string;
};

const SUPPORT_FAQS: FaqEntry[] = [
  {
    id: "recharge-bonus",
    title: "充值赠送规则",
    keywords: ["赠送", "bonus", "充值规则", "充值优惠", "充多少送多少"],
    answer:
      "当前充值赠送规则按档位递增。常见档位包括：$100 送 $5、$200 送 $20、$500 送 $75、$1000 送 $200、$2000 送 $500。如果你告诉我预算，我可以继续帮你推荐最划算的充值档位。",
  },
  {
    id: "payment-methods",
    title: "支付方式",
    keywords: [
      "支付方式",
      "支付宝",
      "微信",
      "paypal",
      "stripe",
      "usdt",
      "银行卡",
    ],
    answer:
      "当前支持 Stripe / 银行卡、支付宝、微信支付、PayPal、USDT。不同方式到账链路不同，如果你告诉我更看重速度、手续费还是稳定性，我可以继续给你建议。",
  },
  {
    id: "order-arrival",
    title: "到账说明",
    keywords: ["多久到账", "到账", "支付后多久", "订单状态", "未到账"],
    answer:
      "不同支付方式的到账时间略有差异。Stripe、支付宝、微信、PayPal 通常会在支付确认后较快更新；USDT 可能需要等待链上确认或人工核验。如果你有订单号，我可以先帮你查当前状态。",
  },
  {
    id: "model-selection",
    title: "模型选择",
    keywords: [
      "推荐模型",
      "哪个模型",
      "适合写代码",
      "适合客服",
      "适合问答",
      "模型怎么选",
    ],
    answer:
      "如果是日常问答和轻客服，优先选响应稳定、成本低的通用模型；如果是写代码，优先选代码能力更强的模型；如果是复杂分析，再考虑更高能力模型。你也可以直接告诉我你的任务场景，我来给你推荐。",
  },
  {
    id: "api-access",
    title: "API 接入",
    keywords: ["api", "接入", "开发文档", "api key", "网关地址", "调用模型"],
    answer:
      "如果你要接入 API，可以先到 Developers 页面查看接入说明。常见步骤是：获取 API Key、查看模型列表、调用网关地址、再根据返回结果做计费和日志处理。你也可以继续直接问我某一步怎么做。",
  },
  {
    id: "admin-entry",
    title: "后台入口",
    keywords: ["管理后台", "后台在哪里", "admin", "渠道管理", "日志"],
    answer:
      "管理员登录后，可以从聊天页左侧导航进入管理后台。常见页面包括：渠道管理、日志、充值审核、用户管理。如果你告诉我想看哪一块，我可以继续给你说明入口和作用。",
  },
];

@Injectable()
export class ChatCustomerSupportService {
  constructor(
    @InjectRepository(User)
    private userRepository: Repository<User>,
    @InjectRepository(Recharge)
    private rechargeRepository: Repository<Recharge>,
    private gatewayService: GatewayService,
    private rechargeService: RechargeService,
  ) {}

  async reply(params: {
    user: User;
    latestUserMessage: string;
  }): Promise<SupportReply> {
    const message = params.latestUserMessage.trim();
    const lower = message.toLowerCase();
    const usedTools: string[] = [];
    const toolTraces: AgentToolTrace[] = [];

    const pushTrace = (
      name: string,
      label: string,
      resultSummary: string,
      display?: Record<string, any>,
    ) => {
      usedTools.push(name);
      toolTraces.push({
        name,
        label,
        arguments: {},
        status: "success",
        resultSummary,
        display,
      });
    };

    if (this.isBalanceIntent(lower)) {
      const user = await this.userRepository.findOne({
        where: { id: params.user.id },
      });
      const balance = Number(user?.balance || 0);
      pushTrace("get_my_balance", "余额查询", `当前余额 ${balance}`);
      return {
        content: `你当前账户余额是 $${balance}。\n\n如果你只是咨询充值、订单、模型或接入问题，现在可以继续直接问我，我会走免费的轻客服通道。`,
        usedTools,
        toolTraces,
        cost: 0,
        model: "support-lite",
      };
    }

    if (this.isRechargeIntent(lower)) {
      const packages = await this.rechargeService.getRechargePackages();
      const top = packages
        .slice(0, 4)
        .map((item) => item.display)
        .join("；");
      pushTrace(
        "get_recharge_packages",
        "充值套餐",
        `当前有 ${packages.length} 个充值档位`,
      );
      return {
        content: `当前可用的充值档位包括：${top}。\n\n如果你告诉我预算，比如“我预算 100 美元怎么充更合适”，我可以继续免费给你做推荐。`,
        usedTools,
        toolTraces,
        cost: 0,
        model: "support-lite",
      };
    }

    if (this.isPaymentIntent(lower)) {
      pushTrace(
        "describe_payment_methods",
        "支付方式",
        "支持 Stripe、支付宝、微信支付、PayPal、USDT",
      );
      return {
        content:
          "当前支持的支付方式有：Stripe / 银行卡、支付宝、微信支付、PayPal、USDT。\n\n如果你想充值，我也可以继续帮你说明哪种方式更适合你。",
        usedTools,
        toolTraces,
        cost: 0,
        model: "support-lite",
      };
    }

    const orderNo = this.extractOrderNo(message);
    if (orderNo) {
      const recharge = await this.rechargeService
        .getRechargeDetailsForUser(params.user.id, orderNo)
        .catch(() => null);
      if (recharge) {
        pushTrace(
          "get_recharge_order_status",
          "查询充值订单",
          `订单 ${orderNo} 当前状态 ${recharge.paymentStatus || recharge.status || "-"}`,
          {
            kind: "recharge_status",
            orderNo: recharge.orderNo,
            paymentMethod: recharge.paymentMethod,
            status: recharge.paymentStatus,
            amount: recharge.amount,
            bonus: recharge.bonus,
            total: recharge.total,
            createdAt: recharge.createdAt,
            paidAt: recharge.paidAt,
          },
        );

        return {
          content: `订单 ${orderNo} 当前状态是 ${recharge.paymentStatus || recharge.status || "-"}。`,
          usedTools,
          toolTraces,
          cost: 0,
          model: "support-lite",
        };
      }
    }

    if (this.isOrderHistoryIntent(lower)) {
      const records = await this.rechargeRepository.find({
        where: { userId: params.user.id },
        order: { createdAt: "DESC" },
        take: 3,
      });

      pushTrace(
        "get_recent_recharges",
        "最近充值",
        `找到 ${records.length} 条最近充值记录`,
      );

      if (!records.length) {
        return {
          content:
            "你当前还没有充值记录。如果你需要，我可以先给你介绍充值方式、档位和赠送规则。",
          usedTools,
          toolTraces,
          cost: 0,
          model: "support-lite",
        };
      }

      const lines = records
        .map(
          (item) =>
            `订单 ${item.orderNo}：${item.paymentStatus}，金额 $${Number(item.amount)}，赠送 $${Number(item.bonus)}`,
        )
        .join("\n");

      return {
        content: `你最近的充值记录如下：\n${lines}`,
        usedTools,
        toolTraces,
        cost: 0,
        model: "support-lite",
      };
    }

    if (this.isModelIntent(lower)) {
      const models = await this.gatewayService.getModelCatalog();
      const preview = models
        .slice(0, 6)
        .map((item: any) => item.name || item.id)
        .join("、");

      pushTrace(
        "list_available_models",
        "模型目录",
        `找到 ${models.length} 个可用模型`,
      );

      return {
        content: `站内当前有 ${models.length} 个可用模型，常见可用项包括：${preview}。\n\n如果你告诉我是写代码、日常问答还是图像理解，我可以继续免费给你推荐更适合的模型。`,
        usedTools,
        toolTraces,
        cost: 0,
        model: "support-lite",
      };
    }

    if (this.isDeveloperIntent(lower)) {
      return {
        content:
          "如果你是想接入 API，可以先去“接入文档 / Developers”页面查看基础说明。你也可以继续直接问我这些问题：\n1. 如何获取 API Key\n2. 如何调用网关地址\n3. 如何查看模型列表\n4. 如何计费",
        usedTools,
        toolTraces,
        cost: 0,
        model: "support-lite",
      };
    }

    const faq = this.matchFaq(lower);
    if (faq) {
      return {
        content: `${faq.answer}\n\n如果你愿意，也可以继续追问更具体的一步，我会尽量用免费的轻客服模式继续帮你说明。`,
        usedTools,
        toolTraces,
        cost: 0,
        model: "support-lite",
      };
    }

    if (this.isGreetingIntent(lower)) {
      return {
        content:
          "你好，现在你使用的是免费的轻客服模式。\n\n我可以帮你处理这些常见问题：余额、充值、支付方式、订单状态、模型目录、开发接入说明。\n\n你也可以直接问：\n1. 有哪些充值档位\n2. 支持哪些支付方式\n3. 订单多久到账\n4. 如何接入 API",
        usedTools,
        toolTraces,
        cost: 0,
        model: "support-lite",
      };
    }

    return {
      content:
        "当前你还没有余额，所以我先用免费的轻客服模式为你服务。\n\n我目前擅长处理：余额查询、充值说明、支付方式、订单状态、模型目录、开发接入常见问题。\n\n如果你的问题比较像客服 FAQ，也可以换一种更具体的问法继续问我，比如：\n1. 有哪些充值档位\n2. 支持哪些支付方式\n3. 订单多久到账\n4. 怎么接入 API\n5. 推荐什么模型",
      usedTools,
      toolTraces,
      cost: 0,
      model: "support-lite",
    };
  }

  private matchFaq(lower: string) {
    let best: { entry: FaqEntry; score: number } | null = null;

    for (const entry of SUPPORT_FAQS) {
      const score = entry.keywords.reduce(
        (sum, keyword) => sum + (lower.includes(keyword.toLowerCase()) ? 1 : 0),
        0,
      );
      if (!score) continue;
      if (!best || score > best.score) {
        best = { entry, score };
      }
    }

    return best?.entry || null;
  }

  private extractOrderNo(message: string) {
    const match = message.match(/\bRC[0-9A-Z]{8,}\b/i);
    return match?.[0]?.toUpperCase() || "";
  }

  private isGreetingIntent(lower: string) {
    return ["你好", "您好", "hello", "hi", "在吗", "客服"].some((item) =>
      lower.includes(item),
    );
  }

  private isBalanceIntent(lower: string) {
    return ["余额", "balance", "还有多少钱", "账户金额"].some((item) =>
      lower.includes(item),
    );
  }

  private isRechargeIntent(lower: string) {
    return [
      "充值",
      "套餐",
      "档位",
      "bonus",
      "赠送",
      "充值规则",
      "recharge",
    ].some((item) => lower.includes(item));
  }

  private isPaymentIntent(lower: string) {
    return [
      "支付方式",
      "支付宝",
      "微信",
      "paypal",
      "stripe",
      "usdt",
      "银行卡",
    ].some((item) => lower.includes(item));
  }

  private isOrderHistoryIntent(lower: string) {
    return ["订单", "充值记录", "历史订单", "recent recharge"].some((item) =>
      lower.includes(item),
    );
  }

  private isModelIntent(lower: string) {
    return ["模型", "model", "目录", "推荐模型"].some((item) =>
      lower.includes(item),
    );
  }

  private isDeveloperIntent(lower: string) {
    return ["api", "接入", "文档", "developers", "key", "网关"].some((item) =>
      lower.includes(item),
    );
  }
}
