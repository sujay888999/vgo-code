import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from "typeorm";
import { User } from "../user/user.entity";
import { ChatConversation } from "./chat-conversation.entity";

@Entity("chat_messages")
export class ChatMessage {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  conversationId: string;

  @ManyToOne(() => ChatConversation)
  @JoinColumn({ name: "conversationId" })
  conversation: ChatConversation;

  @Column()
  userId: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: "userId" })
  user: User;

  @Column({ length: 10 })
  role: "user" | "assistant" | "system";

  @Column({ type: "text" })
  content: string;

  @Column({ nullable: true })
  model: string;

  @Column({ type: "int", default: 0 })
  tokens: number;

  @Column({ type: "decimal", precision: 10, scale: 6, default: 0 })
  cost: number;

  @CreateDateColumn()
  createdAt: Date;
}
