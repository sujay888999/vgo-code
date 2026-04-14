import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
} from "class-validator";
import { Request as ExpressRequest } from "express";
import { Public } from "../../common/decorators/public.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { PaymentMethod } from "./recharge.entity";
import { RechargeService } from "./recharge.service";

class CreateRechargeDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsIn([
    PaymentMethod.STRIPE,
    PaymentMethod.ALIPAY,
    PaymentMethod.WECHAT,
    PaymentMethod.PAYPAL,
    PaymentMethod.USDT,
  ])
  paymentMethod?: PaymentMethod;
}

class ConfirmRechargeDto {
  @IsOptional()
  @IsString()
  providerOrderId?: string;

  @IsOptional()
  @IsString()
  transactionReference?: string;
}

@ApiTags("Recharge")
@Controller("recharge")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class RechargeController {
  constructor(private rechargeService: RechargeService) {}

  @Get("methods")
  @ApiOperation({ summary: "Get configured payment methods" })
  async getMethods() {
    return { data: await this.rechargeService.getPaymentMethods() };
  }

  @Post("create")
  @ApiOperation({ summary: "Create a new recharge order" })
  async createRecharge(@Request() req, @Body() dto: CreateRechargeDto) {
    return this.rechargeService.createRecharge(
      req.user.userId,
      dto.amount,
      dto.paymentMethod || PaymentMethod.ALIPAY,
    );
  }

  @Post("retry/:orderNo")
  @ApiOperation({ summary: "Recreate provider checkout for a pending order" })
  async retryRecharge(@Request() req, @Param("orderNo") orderNo: string) {
    return this.rechargeService.recreateCheckout(req.user.userId, orderNo);
  }

  @Get("history")
  @ApiOperation({ summary: "Get recharge history" })
  async getHistory(
    @Request() req,
    @Query("page") page: number = 1,
    @Query("limit") limit: number = 20,
  ) {
    return this.rechargeService.getRechargeHistory(
      req.user.userId,
      page,
      limit,
    );
  }

  @Get("packages")
  @ApiOperation({ summary: "Get recharge packages" })
  async getPackages() {
    return this.rechargeService.getRechargePackages();
  }

  @Get("order/:orderNo")
  @ApiOperation({ summary: "Get recharge order details for current user" })
  async getOrder(@Request() req, @Param("orderNo") orderNo: string) {
    return this.rechargeService.getRechargeDetailsForUser(
      req.user.userId,
      orderNo,
    );
  }

  @Post("pay/:orderNo")
  @ApiOperation({
    summary: "Confirm or inspect an order after provider approval",
  })
  async processPayment(
    @Request() req,
    @Param("orderNo") orderNo: string,
    @Body() dto: ConfirmRechargeDto,
  ) {
    return this.rechargeService.processPayment(req.user.userId, orderNo, dto);
  }

  @Post("refresh/:orderNo")
  @ApiOperation({
    summary: "Refresh an order status from the upstream payment provider",
  })
  async refreshPayment(@Request() req, @Param("orderNo") orderNo: string) {
    return this.rechargeService.refreshPaymentStatus(req.user.userId, orderNo);
  }

  @Public()
  @Post("webhooks/stripe")
  @ApiOperation({ summary: "Handle Stripe webhook callbacks" })
  async handleStripeWebhook(
    @Headers("stripe-signature") signature: string | undefined,
    @Req() req: ExpressRequest & { rawBody?: Buffer },
  ) {
    return this.rechargeService.handleStripeWebhook(signature, req.rawBody);
  }
}
