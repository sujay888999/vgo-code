import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { Channel } from "./channel.entity";

@Entity("channel_models")
export class ChannelModel {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ name: "channel_id" })
  channelId: string;

  @ManyToOne(() => Channel, (channel) => channel.modelConfigs)
  @JoinColumn({ name: "channel_id" })
  channel: Channel;

  @Column({ name: "model_name", length: 100 })
  modelName: string;

  @Column({ name: "protocol", length: 20, default: "auto" })
  protocol: string;

  @Column({
    name: "input_price",
    type: "decimal",
    precision: 10,
    scale: 4,
    default: 0,
  })
  inputPrice: number;

  @Column({
    name: "output_price",
    type: "decimal",
    precision: 10,
    scale: 4,
    default: 0,
  })
  outputPrice: number;

  @Column({
    name: "cache_write_price",
    type: "decimal",
    precision: 10,
    scale: 4,
    default: 0,
  })
  cacheWritePrice: number;

  @Column({
    name: "cache_read_price",
    type: "decimal",
    precision: 10,
    scale: 4,
    default: 0,
  })
  cacheReadPrice: number;

  @Column({ name: "is_active", default: true })
  isActive: boolean;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;
}
