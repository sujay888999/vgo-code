import { Test, TestingModule } from "@nestjs/testing";
import { ChatService } from "./chat.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { ChatConversation } from "./chat-conversation.entity";
import { ChatMessage } from "./chat-message.entity";
import { User } from "../user/user.entity";
import { GatewayService } from "../gateway/gateway.service";
import { ChatAgentService } from "./chat-agent.service";
import { ChatCustomerSupportService } from "./chat-customer-support.service";
import { NotFoundException, BadRequestException } from "@nestjs/common";

describe("ChatService", () => {
  let service: ChatService;
  let mockConversationRepo: any;
  let mockMessageRepo: any;
  let mockUserRepo: any;
  let mockGatewayService: any;
  let mockChatAgentService: any;
  let mockChatCustomerSupportService: any;

  const mockUser = { id: "user-1", balance: 100 };
  const mockConversation = {
    id: "conv-1",
    userId: "user-1",
    title: "Test Chat",
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    mockConversationRepo = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
    };

    mockMessageRepo = {
      find: jest.fn(),
    };

    mockUserRepo = {
      findOne: jest.fn(),
    };

    mockGatewayService = {
      proxyRequest: jest.fn(),
    };

    mockChatAgentService = {
      processWithTools: jest.fn(),
    };

    mockChatCustomerSupportService = {
      handleCustomerSupport: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getRepositoryToken(ChatConversation),
          useValue: mockConversationRepo,
        },
        {
          provide: getRepositoryToken(ChatMessage),
          useValue: mockMessageRepo,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepo,
        },
        {
          provide: GatewayService,
          useValue: mockGatewayService,
        },
        {
          provide: ChatAgentService,
          useValue: mockChatAgentService,
        },
        {
          provide: ChatCustomerSupportService,
          useValue: mockChatCustomerSupportService,
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
  });

  describe("createConversation", () => {
    it("should create a new conversation", async () => {
      mockConversationRepo.create.mockReturnValue(mockConversation);
      mockConversationRepo.save.mockResolvedValue(mockConversation);

      const result = await service.createConversation("user-1", "New Chat");

      expect(result).toEqual(mockConversation);
      expect(mockConversationRepo.create).toHaveBeenCalled();
      expect(mockConversationRepo.save).toHaveBeenCalled();
    });

    it("should create with default title if not provided", async () => {
      mockConversationRepo.create.mockReturnValue({
        ...mockConversation,
        title: "New chat",
      });
      mockConversationRepo.save.mockResolvedValue(mockConversation);

      await service.createConversation("user-1");

      expect(mockConversationRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ title: "New chat" }),
      );
    });
  });

  describe("getConversations", () => {
    it("should return user conversations", async () => {
      mockConversationRepo.find.mockResolvedValue([mockConversation]);

      const result = await service.getConversations("user-1");

      expect(result).toEqual([mockConversation]);
      expect(mockConversationRepo.find).toHaveBeenCalledWith({
        where: { userId: "user-1", isActive: true },
        order: { updatedAt: "DESC" },
      });
    });
  });

  describe("getConversation", () => {
    it("should return conversation if found", async () => {
      mockConversationRepo.findOne.mockResolvedValue(mockConversation);

      const result = await service.getConversation("user-1", "conv-1");

      expect(result).toEqual(mockConversation);
    });

    it("should throw NotFoundException if not found", async () => {
      mockConversationRepo.findOne.mockResolvedValue(null);

      await expect(
        service.getConversation("user-1", "nonexistent"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getMessages", () => {
    it("should return messages for conversation", async () => {
      const messages = [
        {
          id: "msg-1",
          role: "user",
          content: "Hello",
          conversationId: "conv-1",
        },
        {
          id: "msg-2",
          role: "assistant",
          content: "Hi there",
          conversationId: "conv-1",
        },
      ];
      mockConversationRepo.findOne.mockResolvedValue(mockConversation);
      mockMessageRepo.find.mockResolvedValue(messages);

      const result = await service.getMessages("user-1", "conv-1");

      expect(result).toEqual(messages);
    });
  });

  describe("deleteConversation", () => {
    it("should mark conversation as inactive", async () => {
      mockConversationRepo.findOne.mockResolvedValue(mockConversation);
      mockConversationRepo.save.mockResolvedValue({
        ...mockConversation,
        isActive: false,
      });

      await service.deleteConversation("user-1", "conv-1");

      expect(mockConversationRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: false }),
      );
    });
  });
});
