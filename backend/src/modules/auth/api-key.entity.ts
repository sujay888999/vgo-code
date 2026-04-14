import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  OneToMany,
} from "typeorm";
import { User } from "../user/user.entity";
import { RequestLog } from "../gateway/request-log.entity";

export enum ApiKeyStatus {
  ACTIVE = "active",
  INACTIVE = "inactive",
}

@Entity("api_keys")
export class ApiKey {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "user_id" })
  userId: string;

  @ManyToOne(() => User, (user) => user.apiKeys)
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ name: "api_key", unique: true, length: 64 })
  apiKey: string;

  @Column({ length: 100 })
  name: string;

  @Column({
    type: "enum",
    enum: ApiKeyStatus,
    default: ApiKeyStatus.ACTIVE,
  })
  status: ApiKeyStatus;

  @Column({ name: "daily_limit", default: 10000 })
  dailyLimit: number;

  @Column({ name: "monthly_limit", default: 100000 })
  monthlyLimit: number;

  @Column({ name: "used_today", default: 0 })
  usedToday: number;

  @Column({ name: "used_month", default: 0 })
  usedMonth: number;

  @Column({ name: "reset_today_at", nullable: true })
  resetTodayAt: Date;

  @Column({ name: "reset_month_at", nullable: true })
  resetMonthAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @OneToMany(() => RequestLog, (log) => log.apiKey)
  requestLogs: RequestLog[];
}
