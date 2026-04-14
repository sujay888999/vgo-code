import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";
import { JwtService } from "@nestjs/jwt";
import { ChatService } from "../chat/chat.service";
import { GatewayService } from "../gateway/gateway.service";

interface JoinRoomPayload {
  conversationId: string;
  token: string;
}

interface SendMessagePayload {
  conversationId: string;
  message: string;
  model?: string;
}

@WebSocketGateway({
  cors: {
    origin: "*",
    credentials: true,
  },
  namespace: "/chat",
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private userSockets: Map<string, string> = new Map();
  private socketUsers: Map<string, string> = new Map();

  constructor(
    private jwtService: JwtService,
    private chatService: ChatService,
    private gatewayService: GatewayService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token =
        client.handshake.auth.token ||
        client.handshake.headers.authorization?.replace("Bearer ", "");

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = await this.jwtService.verifyAsync(token);
      this.userSockets.set(payload.sub, client.id);
      this.socketUsers.set(client.id, payload.sub);

      console.log(`Client connected: ${client.id}, user: ${payload.sub}`);
    } catch (error) {
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const userId = this.socketUsers.get(client.id);
    if (userId) {
      this.userSockets.delete(userId);
      this.socketUsers.delete(client.id);
    }
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage("joinConversation")
  async handleJoinConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinRoomPayload,
  ) {
    const userId = this.socketUsers.get(client.id);
    if (!userId) {
      return { error: "Unauthorized" };
    }

    const conversation = await this.chatService.getConversation(
      userId,
      payload.conversationId,
    );
    client.join(`conversation:${payload.conversationId}`);

    return { success: true, conversation };
  }

  @SubscribeMessage("sendMessage")
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SendMessagePayload,
  ) {
    const userId = this.socketUsers.get(client.id);
    if (!userId) {
      return { error: "Unauthorized" };
    }

    const { conversationId, message, model } = payload;

    try {
      client.to(`conversation:${conversationId}`).emit("userMessage", {
        role: "user",
        content: message,
        timestamp: new Date(),
      });

      const conversation = await this.chatService.getConversation(
        userId,
        conversationId,
      );
      const messages = await this.chatService.getMessages(
        userId,
        conversationId,
      );

      messages.push({ role: "user", content: message } as any);

      const response = await this.gatewayService.proxyRequest(
        "internal",
        {
          body: {
            model: model || "gpt-3.5-turbo",
            messages: messages.map((m) => ({
              role: m.role,
              content: m.content,
            })),
            stream: true,
          },
        },
        "internal",
      );

      let assistantMessage = "";
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const interval = setInterval(() => {
            if (response.data?.choices?.[0]?.delta?.content) {
              const chunk = response.data.choices[0].delta.content;
              assistantMessage += chunk;
              client.emit("messageChunk", { content: chunk, done: false });
              controller.enqueue(encoder.encode(chunk));
            } else {
              clearInterval(interval);
              client.emit("messageChunk", { content: "", done: true });
              controller.close();
            }
          }, 50);
        },
      });

      const fullResponse = assistantMessage;

      await this.chatService.addMessage(userId, conversationId, {
        role: "assistant",
        content: fullResponse,
      });

      this.server
        .to(`conversation:${conversationId}`)
        .emit("assistantMessage", {
          role: "assistant",
          content: fullResponse,
          timestamp: new Date(),
        });

      return { success: true, message: fullResponse };
    } catch (error) {
      return { error: error.message };
    }
  }

  @SubscribeMessage("leaveConversation")
  handleLeaveConversation(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    client.leave(`conversation:${payload.conversationId}`);
    return { success: true };
  }
}
