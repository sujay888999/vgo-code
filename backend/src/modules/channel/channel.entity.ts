import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { ChannelModel } from "./channel-model.entity";
import { RequestLog } from "../gateway/request-log.entity";

export enum ChannelType {
  OPENAI = "openai",
  ANTHROPIC = "anthropic",
  AZURE = "azure",
  CUSTOM = "custom",
}

export enum ChannelStatus {
  ONLINE = "online",
  OFFLINE = "offline",
  ERROR = "error",
  TESTING = "testing",
}

@Entity("channels")
export class Channel {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ length: 100 })
  name: string;

  @Column({
    name: "channel_type",
    type: "enum",
    enum: ChannelType,
    default: ChannelType.OPENAI,
  })
  channelType: ChannelType;

  @Column({ name: "base_url", length: 500 })
  baseUrl: string;

  @Column({ name: "api_key", length: 255, nullable: true })
  apiKey: string;

  @Column({ type: "jsonb", default: [] })
  models: string[];

  @Column({ default: 0 })
  priority: number;

  @Column({ name: "is_active", default: true })
  isActive: boolean;

  @Column({
    name: "status",
    type: "enum",
    enum: ChannelStatus,
    default: ChannelStatus.ONLINE,
  })
  status: ChannelStatus;

  @Column({ name: "test_at", type: "timestamp", nullable: true })
  testAt: Date;

  @Column({ name: "test_error", length: 500, nullable: true })
  testError: string;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  balance: number;

  @Column({ type: "decimal", precision: 10, scale: 4, default: 1 })
  priceRate: number;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  weight: number;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @OneToMany(() => ChannelModel, (model) => model.channel)
  modelConfigs: ChannelModel[];

  @OneToMany(() => RequestLog, (log) => log.channel)
  requestLogs: RequestLog[];
}
