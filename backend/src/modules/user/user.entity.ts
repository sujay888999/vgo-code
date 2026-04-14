import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from "typeorm";
import { ApiKey } from "../auth/api-key.entity";
import { Recharge } from "../recharge/recharge.entity";
import { RequestLog } from "../gateway/request-log.entity";

@Entity("users")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ unique: true, length: 255 })
  email: string;

  @Column({ length: 100 })
  username: string;

  @Column({ length: 255 })
  password: string;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
  balance: number;

  @Column({ name: "is_admin", default: false })
  isAdmin: boolean;

  @Column({ name: "is_active", default: true })
  isActive: boolean;

  @Column({ name: "last_login_at", nullable: true })
  lastLoginAt: Date;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;

  @OneToMany(() => ApiKey, (apiKey) => apiKey.user)
  apiKeys: ApiKey[];

  @OneToMany(() => Recharge, (recharge) => recharge.user)
  recharges: Recharge[];

  @OneToMany(() => RequestLog, (log) => log.user)
  requestLogs: RequestLog[];
}
