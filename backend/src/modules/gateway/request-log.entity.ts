import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { ApiKey } from "../auth/api-key.entity";
import { Channel } from "../channel/channel.entity";
import { User } from "../user/user.entity";

@Entity("request_logs")
@Index(["apiKeyId"])
@Index(["userId"])
@Index(["channelId"])
@Index(["createdAt"])
export class RequestLog {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "api_key_id" })
  apiKeyId: string;

  @ManyToOne(() => ApiKey, (apiKey) => apiKey.requestLogs)
  @JoinColumn({ name: "api_key_id" })
  apiKey: ApiKey;

  @Column({ name: "channel_id", nullable: true })
  channelId: string;

  @ManyToOne(() => Channel, (channel) => channel.requestLogs)
  @JoinColumn({ name: "channel_id" })
  channel: Channel;

  @Column({ name: "user_id" })
  userId: string;

  @ManyToOne(() => User, (user) => user.requestLogs)
  @JoinColumn({ name: "user_id" })
  user: User;

  @Column({ length: 100 })
  model: string;

  @Column({ name: "prompt_tokens", default: 0 })
  promptTokens: number;

  @Column({ name: "completion_tokens", default: 0 })
  completionTokens: number;

  @Column({ name: "total_tokens", default: 0 })
  totalTokens: number;

  @Column({ type: "decimal", precision: 10, scale: 4, default: 0 })
  cost: number;

  @Column({ name: "latency_ms", default: 0 })
  latencyMs: number;

  @Column({ name: "status_code", default: 200 })
  statusCode: number;

  @Column({ name: "request_ip", length: 50, nullable: true })
  requestIp: string;

  @Column({ name: "request_data", type: "jsonb", nullable: true })
  requestData: any;

  @Column({ name: "response_data", type: "jsonb", nullable: true })
  responseData: any;

  @Column({ name: "error_message", type: "text", nullable: true })
  errorMessage: string;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
