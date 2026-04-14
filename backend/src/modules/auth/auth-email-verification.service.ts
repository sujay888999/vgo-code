import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { promises as fs } from "fs";
import * as nodemailer from "nodemailer";
import { dirname, resolve } from "path";

interface EmailVerificationRecord {
  code: string;
  expiresAt: string;
  sentAt: string;
  attempts: number;
}

type EmailVerificationStore = Record<string, EmailVerificationRecord>;

const CODE_EXPIRES_MINUTES = 10;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_VERIFY_ATTEMPTS = 5;

@Injectable()
export class AuthEmailVerificationService {
  private readonly logger = new Logger(AuthEmailVerificationService.name);
  private readonly filePath =
    process.env.AUTH_EMAIL_VERIFICATION_STORE_PATH ||
    (process.env.NODE_ENV === "production"
      ? "/app/data/auth-email-verifications.json"
      : resolve(process.cwd(), "data", "auth-email-verifications.json"));

  constructor(private readonly configService: ConfigService) {}

  async sendCode(email: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const store = await this.readStore();
    const existing = store[normalizedEmail];

    if (existing) {
      const sentAt = new Date(existing.sentAt).getTime();
      if (
        !Number.isNaN(sentAt) &&
        Date.now() - sentAt < RESEND_COOLDOWN_SECONDS * 1000
      ) {
        throw new BadRequestException(
          `验证码发送过于频繁，请在 ${RESEND_COOLDOWN_SECONDS} 秒后重试`,
        );
      }
    }

    const code = this.generateCode();
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + CODE_EXPIRES_MINUTES * 60 * 1000,
    );

    await this.sendEmail(normalizedEmail, code, expiresAt);

    store[normalizedEmail] = {
      code,
      expiresAt: expiresAt.toISOString(),
      sentAt: now.toISOString(),
      attempts: 0,
    };

    await this.writeStore(store);

    return {
      success: true,
      expiresInMinutes: CODE_EXPIRES_MINUTES,
      cooldownSeconds: RESEND_COOLDOWN_SECONDS,
    };
  }

  async verifyCode(email: string, code: string) {
    const normalizedEmail = this.normalizeEmail(email);
    const normalizedCode = String(code || "").trim();
    const bypassCode = String(
      this.configService.get("REGISTRATION_BYPASS_CODE") || "",
    ).trim();

    if (bypassCode && normalizedCode === bypassCode) {
      this.logger.warn(`Registration bypass code used for ${normalizedEmail}`);
      return;
    }

    const store = await this.readStore();
    const record = store[normalizedEmail];

    if (!record) {
      throw new BadRequestException("请先获取邮箱验证码");
    }

    if (new Date(record.expiresAt).getTime() < Date.now()) {
      delete store[normalizedEmail];
      await this.writeStore(store);
      throw new BadRequestException("验证码已过期，请重新获取");
    }

    if (record.attempts >= MAX_VERIFY_ATTEMPTS) {
      delete store[normalizedEmail];
      await this.writeStore(store);
      throw new BadRequestException("验证码尝试次数过多，请重新获取");
    }

    if (record.code !== normalizedCode) {
      record.attempts += 1;
      store[normalizedEmail] = record;
      await this.writeStore(store);
      throw new BadRequestException("验证码错误");
    }

    delete store[normalizedEmail];
    await this.writeStore(store);
  }

  private async sendEmail(email: string, code: string, expiresAt: Date) {
    const host = this.configService.get<string>("SMTP_HOST");
    const port = Number(this.configService.get<string>("SMTP_PORT") || 587);
    const user = this.configService.get<string>("SMTP_USER");
    const pass = this.configService.get<string>("SMTP_PASS");
    const from = this.configService.get<string>("SMTP_FROM") || user;
    const secure = ["true", "1", "yes"].includes(
      String(this.configService.get("SMTP_SECURE") || "").toLowerCase(),
    );

    if (!host || !port || !user || !pass || !from) {
      throw new BadRequestException(
        "邮件服务未配置，请先在服务器配置 SMTP 参数",
      );
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: {
        user,
        pass,
      },
    });

    const expireText = expiresAt.toLocaleString("zh-CN", { hour12: false });

    await transporter.sendMail({
      from,
      to: email,
      subject: "VGO AI 注册验证码",
      text: `您的 VGO AI 注册验证码是 ${code}，10 分钟内有效。过期时间：${expireText}`,
      html: `
        <div style="font-family:Arial,sans-serif;padding:24px;color:#111827;">
          <h2 style="margin:0 0 16px;">VGO AI 注册验证码</h2>
          <p style="margin:0 0 12px;">您的验证码是：</p>
          <div style="font-size:32px;font-weight:700;letter-spacing:8px;margin:12px 0 20px;">${code}</div>
          <p style="margin:0 0 8px;">验证码 10 分钟内有效。</p>
          <p style="margin:0;color:#6b7280;">过期时间：${expireText}</p>
        </div>
      `,
    });
  }

  private normalizeEmail(email: string) {
    return String(email || "").trim().toLowerCase();
  }

  private generateCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  private async readStore(): Promise<EmailVerificationStore> {
    try {
      const content = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(content) as EmailVerificationStore;
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        this.logger.warn(
          `Failed to read email verification store: ${error.message}`,
        );
      }
      return {};
    }
  }

  private async writeStore(store: EmailVerificationStore) {
    await fs.mkdir(dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(store, null, 2), "utf8");
  }
}
