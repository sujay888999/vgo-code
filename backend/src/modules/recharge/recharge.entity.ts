import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "../user/user.entity";

export enum PaymentMethod {
  ALIPAY = "alipay",
  WECHAT = "wechat",
  STRIPE = "stripe",
  PAYPAL = "paypal",
  USDT = "usdt",
}

export enum PaymentStatus {
  PENDING = "pending",
  PAID = "paid",
  FAILED = "failed",
  REFUNDED = "refunded",
}

@Entity("recharges")
export class Recharge {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id" })
  userId: string;

  @ManyToOne(() => User, (user) => user.recharges)
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ name: "order_no", unique: true, length: 64 })
  orderNo: string;

  @Column({ type: "decimal", precision: 10, scale: 2 })
  amount: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  bonus: number;

  @Column({
    name: "payment_method",
    type: "enum",
    enum: PaymentMethod,
    default: PaymentMethod.STRIPE,
  })
  paymentMethod: PaymentMethod;

  @Column({
    name: "payment_status",
    type: "enum",
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  paymentStatus: PaymentStatus;

  @Column({ name: "paid_at", nullable: true })
  paidAt: Date;

  @Column({ name: "transaction_id", length: 255, nullable: true })
  transactionId: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
