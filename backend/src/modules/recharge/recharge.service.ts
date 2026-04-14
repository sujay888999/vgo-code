import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import axios from "axios";
import Stripe from "stripe";
import { v4 as uuidv4 } from "uuid";
import { Repository } from "typeorm";
import { PaymentMethod, PaymentStatus, Recharge } from "./recharge.entity";
import { User } from "../user/user.entity";

interface ConfirmRechargeDto {
  providerOrderId?: string;
  transactionReference?: string;
}

interface ManualPaymentDetails {
  accountName?: string;
  accountNo?: string;
  paymentLink?: string;
  qrCodeUrl?: string;
  recipientNote?: string;
}

export interface CheckoutPayload {
  mode: string;
  provider?: string;
  paymentUrl: string;
  paymentMethodTypes?: Stripe.Checkout.SessionCreateParams.PaymentMethodType[];
  sessionId?: string;
  providerOrderId?: string;
  transactionReference?: string;
  walletAddress?: string;
  network?: string;
  amount?: string;
  currency?: string;
  manualDetails?: ManualPaymentDetails;
  message: string;
}

export interface PaymentMethodCapability {
  id: PaymentMethod;
  title: string;
  description: string;
  configured: boolean;
  requiresRedirect: boolean;
  mode: "redirect" | "manual_transfer" | "manual_crypto";
  provider: "manual" | "paypal" | "usdt";
  statusLabel: string;
  unavailableReason?: string;
}

@Injectable()
export class RechargeService {
  private stripeClient: Stripe | null;

  constructor(
    @InjectRepository(Recharge)
    private rechargeRepository: Repository<Recharge>,
    @InjectRepository(User)
    private userRepository: Repository<User>,
    private configService: ConfigService,
  ) {
    const secretKey = this.configService.get<string>("STRIPE_SECRET_KEY");
    this.stripeClient = secretKey ? new Stripe(secretKey) : null;
  }

  async getPaymentMethods() {
    return this.buildPaymentMethodCapabilities();
  }

  async createRecharge(
    userId: string,
    amount: number,
    paymentMethod: PaymentMethod = PaymentMethod.ALIPAY,
  ) {
    if (amount <= 0) {
      throw new BadRequestException("Amount must be greater than 0");
    }

    this.ensurePaymentMethodAvailable(paymentMethod);

    const orderNo = `RC${Date.now()}${uuidv4().substring(0, 8).toUpperCase()}`;
    const bonus = this.calculateBonus(amount);

    const recharge = this.rechargeRepository.create({
      userId,
      orderNo,
      amount,
      bonus,
      paymentMethod,
      paymentStatus: PaymentStatus.PENDING,
    });

    await this.rechargeRepository.save(recharge);

    const checkout = await this.buildCheckoutPayload(recharge);
    await this.persistCheckoutReference(recharge, checkout);

    return {
      orderNo,
      amount,
      bonus,
      total: Number(amount) + Number(bonus),
      paymentMethod,
      status: PaymentStatus.PENDING,
      checkout,
    };
  }

  async recreateCheckout(userId: string, orderNo: string) {
    const recharge = await this.rechargeRepository.findOne({
      where: { userId, orderNo },
    });

    if (!recharge) {
      throw new NotFoundException("Order not found");
    }

    if (recharge.paymentStatus === PaymentStatus.PAID) {
      throw new BadRequestException("This order has already been paid.");
    }

    if (recharge.paymentStatus === PaymentStatus.FAILED) {
      throw new BadRequestException(
        "This order has already been marked as failed.",
      );
    }

    this.ensurePaymentMethodAvailable(recharge.paymentMethod);

    const checkout = await this.buildCheckoutPayload(recharge);
    await this.persistCheckoutReference(recharge, checkout);

    return {
      orderNo: recharge.orderNo,
      amount: Number(recharge.amount),
      bonus: Number(recharge.bonus),
      total: Number(recharge.amount) + Number(recharge.bonus),
      paymentMethod: recharge.paymentMethod,
      status: recharge.paymentStatus,
      checkout,
    };
  }

  async getRechargeHistory(
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const [recharges, total] = await this.rechargeRepository.findAndCount({
      where: { userId },
      order: { createdAt: "DESC" },
      skip: (page - 1) * limit,
      take: limit,
    });

    return {
      data: recharges.map((recharge) => this.serializeRecharge(recharge)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async processPayment(
    userId: string,
    orderNo: string,
    dto: ConfirmRechargeDto = {},
  ) {
    const recharge = await this.rechargeRepository.findOne({
      where: { orderNo, userId },
    });

    if (!recharge) {
      throw new NotFoundException("Order not found");
    }

    if (recharge.paymentStatus === PaymentStatus.PAID) {
      return {
        success: true,
        message: "Order already paid",
        recharge: this.serializeRecharge(recharge),
      };
    }

    switch (recharge.paymentMethod) {
      case PaymentMethod.ALIPAY:
      case PaymentMethod.WECHAT:
        if (!dto.transactionReference) {
          return {
            success: false,
            message:
              "Please submit your transfer proof or transaction reference for manual review.",
            recharge: this.serializeRecharge(recharge),
          };
        }

        recharge.transactionId = dto.transactionReference;
        await this.rechargeRepository.save(recharge);

        return {
          success: false,
          message:
            "Payment proof has been submitted. The order is now waiting for manual review.",
          recharge: this.serializeRecharge(recharge),
        };

      case PaymentMethod.PAYPAL:
        if (this.isPayPalApiConfigured()) {
          if (!dto.providerOrderId) {
            throw new BadRequestException(
              "providerOrderId is required to capture a PayPal order",
            );
          }
          return this.capturePayPalOrder(recharge, dto.providerOrderId);
        }

        if (!dto.transactionReference) {
          return {
            success: false,
            message:
              "Please submit your PayPal transaction reference for manual review.",
            recharge: this.serializeRecharge(recharge),
          };
        }

        recharge.transactionId = dto.transactionReference;
        await this.rechargeRepository.save(recharge);

        return {
          success: false,
          message:
            "PayPal payment reference has been submitted and is waiting for manual review.",
          recharge: this.serializeRecharge(recharge),
        };

      case PaymentMethod.USDT:
        if (!dto.transactionReference) {
          return {
            success: false,
            message:
              "Provide a blockchain transaction hash to submit a USDT payment for automatic verification.",
            recharge: this.serializeRecharge(recharge),
          };
        }

        const verification = await this.verifyUsdtTransaction(
          recharge,
          dto.transactionReference,
        );
        recharge.transactionId = dto.transactionReference;
        await this.rechargeRepository.save(recharge);

        if (verification.verified) {
          const paidRecharge = await this.markRechargePaid(
            recharge,
            dto.transactionReference,
          );
          return {
            success: true,
            message: verification.message,
            recharge: this.serializeRecharge(paidRecharge),
          };
        }

        return {
          success: false,
          message: verification.message,
          recharge: this.serializeRecharge(recharge),
        };

      case PaymentMethod.STRIPE:
        return {
          success: false,
          message:
            "Stripe is no longer the primary payment path and is not enabled for this deployment.",
          recharge: this.serializeRecharge(recharge),
        };

      default:
        throw new BadRequestException("Unsupported payment method");
    }
  }

  async refreshPaymentStatus(userId: string, orderNo: string) {
    const recharge = await this.rechargeRepository.findOne({
      where: { orderNo, userId },
    });

    if (!recharge) {
      throw new NotFoundException("Order not found");
    }

    if (
      recharge.paymentStatus === PaymentStatus.PAID ||
      recharge.paymentStatus === PaymentStatus.FAILED
    ) {
      return {
        success: recharge.paymentStatus === PaymentStatus.PAID,
        message:
          recharge.paymentStatus === PaymentStatus.PAID
            ? "Order already paid"
            : "Order has already been marked as failed",
        recharge: this.serializeRecharge(recharge),
      };
    }

    switch (recharge.paymentMethod) {
      case PaymentMethod.ALIPAY:
      case PaymentMethod.WECHAT:
        return {
          success: false,
          message: recharge.transactionId
            ? "Transfer proof has been submitted and is waiting for manual review."
            : "This order is waiting for a transfer and proof submission.",
          recharge: this.serializeRecharge(recharge),
        };
      case PaymentMethod.PAYPAL:
        if (this.isPayPalApiConfigured()) {
          return this.refreshPayPalPaymentStatus(recharge);
        }
        return {
          success: false,
          message: recharge.transactionId
            ? "PayPal reference has been submitted and is waiting for manual review."
            : "This PayPal order is waiting for a manual payment reference.",
          recharge: this.serializeRecharge(recharge),
        };
      case PaymentMethod.USDT:
        return {
          success: false,
          message: recharge.transactionId
            ? "USDT transaction hash has been submitted and is waiting for verification."
            : "USDT order is waiting for a submitted transaction hash.",
          recharge: this.serializeRecharge(recharge),
        };
      case PaymentMethod.STRIPE:
        return {
          success: false,
          message: "Stripe is not active for this deployment.",
          recharge: this.serializeRecharge(recharge),
        };
      default:
        throw new BadRequestException("Unsupported payment method");
    }
  }

  async getRechargeDetailsForUser(userId: string, orderNo: string) {
    const recharge = await this.rechargeRepository.findOne({
      where: { userId, orderNo },
    });

    if (!recharge) {
      throw new NotFoundException("Order not found");
    }

    return this.serializeRecharge(recharge);
  }

  async getRechargePackages() {
    return [
      { amount: 50, bonus: 0, display: "$50 starter credit" },
      { amount: 100, bonus: 5, display: "$100 + $5 bonus" },
      { amount: 200, bonus: 20, display: "$200 + $20 bonus" },
      { amount: 500, bonus: 75, display: "$500 + $75 bonus" },
      { amount: 1000, bonus: 200, display: "$1000 + $200 bonus" },
      { amount: 2000, bonus: 500, display: "$2000 + $500 bonus" },
    ];
  }

  async handleStripeWebhook(
    signature: string | undefined,
    rawBody: Buffer | undefined,
  ) {
    if (!this.stripeClient) {
      throw new BadRequestException("Stripe is not configured");
    }

    const webhookSecret = this.configService.get<string>(
      "STRIPE_WEBHOOK_SECRET",
    );
    if (!webhookSecret) {
      throw new BadRequestException("Stripe webhook secret is not configured");
    }

    if (!signature || !rawBody) {
      throw new BadRequestException("Missing Stripe signature or raw body");
    }

    const event = this.stripeClient.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret,
    );

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderNo = session.metadata?.orderNo;

      if (orderNo) {
        const recharge = await this.rechargeRepository.findOne({
          where: { orderNo },
        });
        if (recharge && recharge.paymentStatus !== PaymentStatus.PAID) {
          await this.markRechargePaid(
            recharge,
            session.payment_intent?.toString() || session.id,
          );
        }
      }
    }

    return { received: true };
  }

  private buildPaymentMethodCapabilities(): PaymentMethodCapability[] {
    const alipayConfigured = this.isManualTransferConfigured("ALIPAY");
    const wechatConfigured = this.isManualTransferConfigured("WECHAT");
    const paypalApiConfigured = this.isPayPalApiConfigured();
    const paypalManualConfigured = this.isManualPayPalConfigured();
    const usdtConfigured = this.isUsdtConfigured();

    return [
      {
        id: PaymentMethod.USDT,
        title: "USDT (TRC20)",
        description:
          "海外用户优先推荐。用户提交链上交易哈希后，系统可自动核验并自动到账。",
        configured: usdtConfigured,
        requiresRedirect: false,
        mode: "manual_crypto",
        provider: "usdt",
        statusLabel: usdtConfigured ? "推荐 / 已配置" : "推荐 / 未配置",
        unavailableReason: usdtConfigured
          ? undefined
          : "缺少 USDT_WALLET_ADDRESS。",
      },
      {
        id: PaymentMethod.PAYPAL,
        title: "PayPal",
        description: paypalApiConfigured
          ? "海外用户可直接跳转完成支付。"
          : "海外用户可通过手动收款链接或收款邮箱完成支付，再提交交易参考号。",
        configured: paypalApiConfigured || paypalManualConfigured,
        requiresRedirect: paypalApiConfigured,
        mode: paypalApiConfigured ? "redirect" : "manual_transfer",
        provider: "paypal",
        statusLabel: paypalApiConfigured
          ? "海外可用 / API 已配置"
          : paypalManualConfigured
            ? "海外可用 / 手动收款"
            : "海外推荐 / 未配置",
        unavailableReason:
          paypalApiConfigured || paypalManualConfigured
            ? undefined
            : "缺少 PayPal API 凭据，或缺少 PayPal 收款链接 / 收款邮箱。",
      },
      {
        id: PaymentMethod.ALIPAY,
        title: "支付宝",
        description:
          "适合中国大陆个人收款，用户转账后上传付款凭证，后台人工审核到账。",
        configured: alipayConfigured,
        requiresRedirect: false,
        mode: "manual_transfer",
        provider: "manual",
        statusLabel: alipayConfigured ? "已配置" : "未配置",
        unavailableReason: alipayConfigured
          ? undefined
          : "缺少支付宝收款账号或收款说明。",
      },
      {
        id: PaymentMethod.WECHAT,
        title: "微信支付",
        description:
          "适合中国大陆个人收款，用户转账后上传付款凭证，后台人工审核到账。",
        configured: wechatConfigured,
        requiresRedirect: false,
        mode: "manual_transfer",
        provider: "manual",
        statusLabel: wechatConfigured ? "已配置" : "未配置",
        unavailableReason: wechatConfigured
          ? undefined
          : "缺少微信收款账号或收款说明。",
      },
    ];
  }

  private ensurePaymentMethodAvailable(paymentMethod: PaymentMethod) {
    const capability = this.buildPaymentMethodCapabilities().find(
      (item) => item.id === paymentMethod,
    );
    if (!capability) {
      throw new BadRequestException("Unsupported payment method");
    }

    if (!capability.configured) {
      throw new BadRequestException(
        capability.unavailableReason ||
          `${capability.title} is not configured.`,
      );
    }
  }

  private isPayPalApiConfigured() {
    return Boolean(
      this.configService.get<string>("PAYPAL_CLIENT_ID")?.trim() &&
      this.configService.get<string>("PAYPAL_CLIENT_SECRET")?.trim(),
    );
  }

  private isManualTransferConfigured(prefix: "ALIPAY" | "WECHAT") {
    return Boolean(
      this.configService.get<string>(`${prefix}_ACCOUNT`)?.trim() ||
      this.configService.get<string>(`${prefix}_PAYMENT_LINK`)?.trim() ||
      this.configService.get<string>(`${prefix}_QR_CODE_URL`)?.trim(),
    );
  }

  private isManualPayPalConfigured() {
    return Boolean(
      this.configService.get<string>("PAYPAL_PAYMENT_LINK")?.trim() ||
      this.configService.get<string>("PAYPAL_ACCOUNT_EMAIL")?.trim(),
    );
  }

  private isUsdtConfigured() {
    return Boolean(
      this.configService.get<string>("USDT_WALLET_ADDRESS")?.trim(),
    );
  }

  private async persistCheckoutReference(
    recharge: Recharge,
    checkout: CheckoutPayload,
  ) {
    if (
      checkout.sessionId ||
      checkout.providerOrderId ||
      checkout.transactionReference
    ) {
      recharge.transactionId =
        checkout.sessionId ||
        checkout.providerOrderId ||
        checkout.transactionReference ||
        null;
      await this.rechargeRepository.save(recharge);
    }
  }

  private async buildCheckoutPayload(
    recharge: Recharge,
  ): Promise<CheckoutPayload> {
    switch (recharge.paymentMethod) {
      case PaymentMethod.ALIPAY:
        return this.buildManualTransferCheckoutPayload(
          recharge,
          PaymentMethod.ALIPAY,
          "支付宝",
        );
      case PaymentMethod.WECHAT:
        return this.buildManualTransferCheckoutPayload(
          recharge,
          PaymentMethod.WECHAT,
          "微信支付",
        );
      case PaymentMethod.PAYPAL:
        return this.isPayPalApiConfigured()
          ? this.buildPayPalCheckoutPayload(recharge)
          : this.buildManualPayPalCheckoutPayload(recharge);
      case PaymentMethod.USDT:
        return this.buildUsdtCheckoutPayload(recharge);
      case PaymentMethod.STRIPE:
      default:
        throw new BadRequestException(
          "Stripe is not enabled for this deployment.",
        );
    }
  }

  private buildManualTransferCheckoutPayload(
    recharge: Recharge,
    paymentMethod: PaymentMethod.ALIPAY | PaymentMethod.WECHAT,
    label: string,
  ): CheckoutPayload {
    const prefix = paymentMethod === PaymentMethod.ALIPAY ? "ALIPAY" : "WECHAT";
    const frontendUrl = this.configService.get<string>(
      "FRONTEND_URL",
      "http://localhost:3000",
    );
    const accountName = this.configService
      .get<string>(`${prefix}_DISPLAY_NAME`, "")
      .trim();
    const accountNo = this.configService
      .get<string>(`${prefix}_ACCOUNT`, "")
      .trim();
    const paymentLink = this.configService
      .get<string>(`${prefix}_PAYMENT_LINK`, "")
      .trim();
    const qrCodeUrl = this.configService
      .get<string>(`${prefix}_QR_CODE_URL`, "")
      .trim();
    const recipientNote = this.configService
      .get<string>(`${prefix}_RECIPIENT_NOTE`, "")
      .trim();

    return {
      mode: "manual_transfer",
      provider: "manual",
      paymentUrl: `${frontendUrl}/recharge/checkout/${recharge.orderNo}`,
      transactionReference: recharge.orderNo,
      amount: Number(recharge.amount).toFixed(2),
      currency: "USD",
      manualDetails: {
        accountName,
        accountNo,
        paymentLink,
        qrCodeUrl,
        recipientNote:
          recipientNote || `请在备注中填写订单号 ${recharge.orderNo}`,
      },
      message: `${label} 订单已创建。请完成转账后提交付款凭证或交易参考号，后台会人工审核到账。`,
    };
  }

  private async buildPayPalCheckoutPayload(
    recharge: Recharge,
  ): Promise<CheckoutPayload> {
    const accessToken = await this.getPayPalAccessToken();
    if (!accessToken) {
      throw new BadRequestException("PayPal is not configured yet.");
    }

    const frontendUrl = this.configService.get<string>(
      "FRONTEND_URL",
      "http://localhost:3000",
    );
    const baseUrl = this.configService.get<string>(
      "PAYPAL_BASE_URL",
      "https://api-m.sandbox.paypal.com",
    );

    const response = await axios.post(
      `${baseUrl}/v2/checkout/orders`,
      {
        intent: "CAPTURE",
        purchase_units: [
          {
            reference_id: recharge.orderNo,
            amount: {
              currency_code: "USD",
              value: Number(recharge.amount).toFixed(2),
            },
            description: `VGO AI order ${recharge.orderNo}`,
          },
        ],
        payment_source: {
          paypal: {
            experience_context: {
              brand_name: "VGO AI",
              return_url: `${frontendUrl}/recharge?status=paypal-approve&orderNo=${recharge.orderNo}`,
              cancel_url: `${frontendUrl}/recharge?status=paypal-cancelled&orderNo=${recharge.orderNo}`,
              user_action: "PAY_NOW",
            },
          },
        },
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    const approveUrl = response.data?.links?.find(
      (link: { rel?: string; href?: string }) =>
        ["approve", "payer-action"].includes((link.rel || "").toLowerCase()),
    )?.href;
    if (!approveUrl) {
      throw new BadRequestException("PayPal did not return an approval link.");
    }

    return {
      mode: "redirect",
      provider: "paypal",
      paymentUrl: approveUrl,
      providerOrderId: response.data?.id,
      message: "PayPal order created successfully.",
    };
  }

  private buildManualPayPalCheckoutPayload(
    recharge: Recharge,
  ): CheckoutPayload {
    const frontendUrl = this.configService.get<string>(
      "FRONTEND_URL",
      "http://localhost:3000",
    );
    const accountName = this.configService
      .get<string>("PAYPAL_DISPLAY_NAME", "")
      .trim();
    const accountNo = this.configService
      .get<string>("PAYPAL_ACCOUNT_EMAIL", "")
      .trim();
    const paymentLink = this.configService
      .get<string>("PAYPAL_PAYMENT_LINK", "")
      .trim();
    const recipientNote = this.configService
      .get<string>("PAYPAL_RECIPIENT_NOTE", "")
      .trim();

    return {
      mode: "manual_transfer",
      provider: "paypal",
      paymentUrl: `${frontendUrl}/recharge/checkout/${recharge.orderNo}`,
      transactionReference: recharge.orderNo,
      amount: Number(recharge.amount).toFixed(2),
      currency: "USD",
      manualDetails: {
        accountName,
        accountNo,
        paymentLink,
        recipientNote:
          recipientNote || `请在备注中填写订单号 ${recharge.orderNo}`,
      },
      message:
        "PayPal 订单已创建。完成支付后请提交 PayPal 交易号，后台会人工审核到账。",
    };
  }

  private buildUsdtCheckoutPayload(recharge: Recharge): CheckoutPayload {
    const walletAddress = this.configService.get<string>(
      "USDT_WALLET_ADDRESS",
      "",
    );
    const network = this.configService.get<string>("USDT_NETWORK", "TRC20");
    const frontendUrl = this.configService.get<string>(
      "FRONTEND_URL",
      "http://localhost:3000",
    );

    if (!walletAddress) {
      throw new BadRequestException(
        "USDT wallet address is not configured yet.",
      );
    }

    return {
      mode: "manual_crypto",
      provider: "usdt",
      paymentUrl: `${frontendUrl}/recharge/checkout/${recharge.orderNo}`,
      walletAddress,
      network,
      amount: Number(recharge.amount).toFixed(2),
      currency: "USDT",
      transactionReference: recharge.orderNo,
      message:
        "Send the exact USDT amount, then submit the blockchain transaction hash for verification.",
    };
  }

  private async capturePayPalOrder(
    recharge: Recharge,
    providerOrderId: string,
  ) {
    const accessToken = await this.getPayPalAccessToken();
    if (!accessToken) {
      throw new BadRequestException("PayPal is not configured");
    }

    const baseUrl = this.configService.get<string>(
      "PAYPAL_BASE_URL",
      "https://api-m.sandbox.paypal.com",
    );
    const response = await axios.post(
      `${baseUrl}/v2/checkout/orders/${providerOrderId}/capture`,
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    const status = response.data?.status;
    if (status !== "COMPLETED") {
      return {
        success: false,
        message: `PayPal capture returned status ${status || "unknown"}`,
        recharge: this.serializeRecharge(recharge),
      };
    }

    const captureId =
      response.data?.purchase_units?.[0]?.payments?.captures?.[0]?.id ||
      providerOrderId;
    const paidRecharge = await this.markRechargePaid(recharge, captureId);

    return {
      success: true,
      message: "PayPal payment captured successfully.",
      recharge: this.serializeRecharge(paidRecharge),
    };
  }

  private async refreshPayPalPaymentStatus(recharge: Recharge) {
    const accessToken = await this.getPayPalAccessToken();
    if (!accessToken) {
      return {
        success: false,
        message: "PayPal is not configured yet.",
        recharge: this.serializeRecharge(recharge),
      };
    }

    if (!recharge.transactionId) {
      return {
        success: false,
        message:
          "This PayPal order has not been linked to a provider order id yet.",
        recharge: this.serializeRecharge(recharge),
      };
    }

    const baseUrl = this.configService.get<string>(
      "PAYPAL_BASE_URL",
      "https://api-m.sandbox.paypal.com",
    );
    const response = await axios.get(
      `${baseUrl}/v2/checkout/orders/${recharge.transactionId}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );

    const status = response.data?.status;

    if (status === "COMPLETED") {
      const captureId =
        response.data?.purchase_units?.[0]?.payments?.captures?.[0]?.id ||
        recharge.transactionId;
      const paidRecharge = await this.markRechargePaid(recharge, captureId);

      return {
        success: true,
        message: "PayPal payment has been completed.",
        recharge: this.serializeRecharge(paidRecharge),
      };
    }

    if (status === "APPROVED") {
      return this.capturePayPalOrder(recharge, recharge.transactionId);
    }

    return {
      success: false,
      message: `Current PayPal order status: ${status || "unknown"}`,
      recharge: this.serializeRecharge(recharge),
    };
  }

  private async verifyUsdtTransaction(recharge: Recharge, txHash: string) {
    const network = (
      this.configService.get<string>("USDT_NETWORK", "TRC20") || "TRC20"
    ).toUpperCase();

    if (network === "TRC20") {
      return this.verifyUsdtTrc20(recharge, txHash);
    }

    if (network === "ERC20") {
      return this.verifyUsdtErc20(recharge, txHash);
    }

    return {
      verified: false,
      message: `USDT network ${network} is not supported for automatic verification yet.`,
    };
  }

  private async verifyUsdtTrc20(recharge: Recharge, txHash: string) {
    const walletAddress = this.configService
      .get<string>("USDT_WALLET_ADDRESS", "")
      .trim();
    const apiKey = this.configService
      .get<string>("TRONGRID_API_KEY", "")
      .trim();
    const contractAddress = this.configService
      .get<string>("USDT_TRC20_CONTRACT", "")
      .trim();

    if (!walletAddress) {
      return {
        verified: false,
        message: "USDT wallet address is not configured.",
      };
    }

    const response = await axios.get(
      `https://api.trongrid.io/v1/transactions/${txHash}/events`,
      {
        headers: apiKey ? { "TRON-PRO-API-KEY": apiKey } : undefined,
      },
    );

    const transferEvent = (response.data?.data || []).find((event: any) => {
      const eventName = (event.event_name || "").toLowerCase();
      const result = event.result || {};
      const to = `${result.to || result._to || ""}`.toLowerCase();
      const contract =
        `${event.contract_address || event.contractAddress || ""}`.toLowerCase();

      return (
        eventName === "transfer" &&
        (!contractAddress || contract === contractAddress.toLowerCase()) &&
        to === walletAddress.toLowerCase()
      );
    });

    if (!transferEvent) {
      return {
        verified: false,
        message:
          "No matching TRC20 transfer to the configured wallet was found for this transaction.",
      };
    }

    const result = transferEvent.result || {};
    const rawValue = Number(result.value || result._value || 0);
    const amount = rawValue / 1_000_000;

    if (amount + 0.000001 < Number(recharge.amount)) {
      return {
        verified: false,
        message: `TRC20 transfer found, but amount ${amount.toFixed(6)} USDT is below the required ${Number(recharge.amount).toFixed(2)} USDT.`,
      };
    }

    return {
      verified: true,
      message: `TRC20 transfer verified automatically for ${amount.toFixed(6)} USDT.`,
    };
  }

  private async verifyUsdtErc20(recharge: Recharge, txHash: string) {
    const rpcUrl = this.configService
      .get<string>("USDT_EVM_RPC_URL", "")
      .trim();
    const walletAddress = this.configService
      .get<string>("USDT_WALLET_ADDRESS", "")
      .trim()
      .toLowerCase();
    const contractAddress = this.configService
      .get<string>("USDT_ERC20_CONTRACT", "")
      .trim()
      .toLowerCase();

    if (!rpcUrl || !walletAddress || !contractAddress) {
      return {
        verified: false,
        message:
          "USDT ERC20 automatic verification requires USDT_EVM_RPC_URL, USDT_WALLET_ADDRESS, and USDT_ERC20_CONTRACT.",
      };
    }

    const response = await axios.post(
      rpcUrl,
      {
        jsonrpc: "2.0",
        method: "eth_getTransactionReceipt",
        params: [txHash],
        id: 1,
      },
      {
        headers: { "Content-Type": "application/json" },
      },
    );

    const receipt = response.data?.result;
    if (!receipt || receipt.status !== "0x1") {
      return {
        verified: false,
        message: "ERC20 transaction receipt not found or not successful yet.",
      };
    }

    const transferTopic =
      "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
    const targetTopic = `0x000000000000000000000000${walletAddress.replace(/^0x/, "")}`;
    const transferLog = (receipt.logs || []).find((log: any) => {
      return (
        `${log.address || ""}`.toLowerCase() === contractAddress &&
        Array.isArray(log.topics) &&
        log.topics[0]?.toLowerCase() === transferTopic &&
        log.topics[2]?.toLowerCase() === targetTopic
      );
    });

    if (!transferLog) {
      return {
        verified: false,
        message:
          "No matching ERC20 USDT transfer to the configured wallet was found in this receipt.",
      };
    }

    const rawValue = parseInt(transferLog.data, 16);
    const amount = rawValue / 1_000_000;

    if (amount + 0.000001 < Number(recharge.amount)) {
      return {
        verified: false,
        message: `ERC20 transfer found, but amount ${amount.toFixed(6)} USDT is below the required ${Number(recharge.amount).toFixed(2)} USDT.`,
      };
    }

    return {
      verified: true,
      message: `ERC20 transfer verified automatically for ${amount.toFixed(6)} USDT.`,
    };
  }

  private async getPayPalAccessToken() {
    const clientId = this.configService.get<string>("PAYPAL_CLIENT_ID");
    const clientSecret = this.configService.get<string>("PAYPAL_CLIENT_SECRET");

    if (!clientId || !clientSecret) {
      return null;
    }

    const baseUrl = this.configService.get<string>(
      "PAYPAL_BASE_URL",
      "https://api-m.sandbox.paypal.com",
    );
    const response = await axios.post(
      `${baseUrl}/v1/oauth2/token`,
      "grant_type=client_credentials",
      {
        auth: {
          username: clientId,
          password: clientSecret,
        },
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    return response.data?.access_token || null;
  }

  private async markRechargePaid(recharge: Recharge, transactionId: string) {
    if (recharge.paymentStatus === PaymentStatus.PAID) {
      return recharge;
    }

    recharge.paymentStatus = PaymentStatus.PAID;
    recharge.paidAt = new Date();
    recharge.transactionId = transactionId;
    await this.rechargeRepository.save(recharge);

    const totalAmount = Number(recharge.amount) + Number(recharge.bonus);
    await this.userRepository
      .createQueryBuilder()
      .update(User)
      .set({ balance: () => `balance + ${totalAmount}` })
      .where("id = :id", { id: recharge.userId })
      .execute();

    return recharge;
  }

  private serializeRecharge(recharge: Recharge) {
    return {
      ...recharge,
      amount: Number(recharge.amount),
      bonus: Number(recharge.bonus),
      total: Number(recharge.amount) + Number(recharge.bonus),
    };
  }

  private calculateBonus(amount: number): number {
    if (amount >= 1000) return amount * 0.2;
    if (amount >= 500) return amount * 0.15;
    if (amount >= 200) return amount * 0.1;
    if (amount >= 100) return amount * 0.05;
    return 0;
  }
}
