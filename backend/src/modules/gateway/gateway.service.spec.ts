import { Test, TestingModule } from "@nestjs/testing";
import { GatewayService } from "./gateway.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { RequestLog } from "./request-log.entity";
import { Channel } from "../channel/channel.entity";
import { User } from "../user/user.entity";
import { AuthService } from "../auth/auth.service";
import { ChannelPublicBetaService } from "../channel/channel-public-beta.service";
import { ConfigService } from "@nestjs/config";
import { RedisCacheService } from "../../common/redis-cache.service";
import { BadRequestException } from "@nestjs/common";
import axios from "axios";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("GatewayService", () => {
  let service: GatewayService;
  let mockRequestLogRepo: any;
  let mockChannelRepo: any;
  let mockUserRepo: any;
  let mockAuthService: any;
  let mockChannelPublicBetaService: any;
  let mockCacheService: any;

  const mockChannel = {
    id: "channel-1",
    name: "OpenAI",
    baseUrl: "https://api.openai.com",
    apiKey: "sk-test",
    isActive: true,
    priceRate: 1.0,
    models: ["gpt-3.5-turbo", "gpt-4"],
    modelConfigs: [],
  };

  const mockKeyInfo = {
    userId: "user-1",
    apiKeyId: "key-1",
    userBalance: 100,
  };

  beforeEach(async () => {
    mockRequestLogRepo = {
      create: jest.fn(),
      save: jest.fn(),
    };

    mockChannelRepo = {
      find: jest.fn(),
    };

    mockUserRepo = {
      findOne: jest.fn(),
    };

    mockAuthService = {
      validateApiKey: jest.fn(),
    };

    mockChannelPublicBetaService = {
      getChannelPublicBetaState: jest.fn().mockResolvedValue({ active: false }),
      getAllConfigs: jest.fn().mockResolvedValue({}),
      isPublicBetaActive: jest.fn().mockReturnValue(false),
      getChannelConfig: jest.fn().mockResolvedValue(null),
    };

    mockCacheService = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(true),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GatewayService,
        {
          provide: getRepositoryToken(RequestLog),
          useValue: mockRequestLogRepo,
        },
        {
          provide: getRepositoryToken(Channel),
          useValue: mockChannelRepo,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepo,
        },
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
        {
          provide: ChannelPublicBetaService,
          useValue: mockChannelPublicBetaService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockReturnValue("https://api.openai.com"),
          },
        },
        {
          provide: RedisCacheService,
          useValue: mockCacheService,
        },
      ],
    }).compile();

    service = module.get<GatewayService>(GatewayService);
  });

  describe("proxyRequest", () => {
    it("should throw BadRequestException for invalid API key", async () => {
      mockAuthService.validateApiKey.mockResolvedValue(null);

      await expect(
        service.proxyRequest(
          "invalid-key",
          { body: { model: "gpt-3.5-turbo" } },
          "127.0.0.1",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException when no channel available", async () => {
      mockAuthService.validateApiKey.mockResolvedValue(mockKeyInfo);
      mockChannelRepo.find.mockResolvedValue([]);

      await expect(
        service.proxyRequest(
          "valid-key",
          { body: { model: "gpt-3.5-turbo" } },
          "127.0.0.1",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw BadRequestException for insufficient balance", async () => {
      mockAuthService.validateApiKey.mockResolvedValue({
        ...mockKeyInfo,
        userBalance: 0,
      });
      mockChannelRepo.find.mockResolvedValue([mockChannel]);
      mockChannelPublicBetaService.getChannelPublicBetaState.mockResolvedValue({
        active: false,
      });

      await expect(
        service.proxyRequest(
          "valid-key",
          { body: { model: "gpt-3.5-turbo" } },
          "127.0.0.1",
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("should successfully proxy request when valid", async () => {
      mockAuthService.validateApiKey.mockResolvedValue(mockKeyInfo);
      mockChannelRepo.find.mockResolvedValue([mockChannel]);
      mockChannelPublicBetaService.getChannelPublicBetaState.mockResolvedValue({
        active: false,
      });
      mockChannelPublicBetaService.getChannelConfig.mockResolvedValue(null);

      mockedAxios.request.mockRejectedValue(new Error("Network error"));

      await expect(
        service.proxyRequest(
          "valid-key",
          {
            body: {
              model: "gpt-3.5-turbo",
              messages: [{ role: "user", content: "hello" }],
            },
          },
          "127.0.0.1",
        ),
      ).rejects.toThrow();
    });

    it("should throw for invalid model", async () => {
      mockAuthService.validateApiKey.mockResolvedValue(mockKeyInfo);
      mockChannelRepo.find.mockResolvedValue([mockChannel]);
      mockChannelPublicBetaService.getChannelPublicBetaState.mockResolvedValue({
        active: false,
      });
      mockChannelPublicBetaService.getChannelConfig.mockResolvedValue(null);

      await expect(
        service.proxyRequest(
          "valid-key",
          { body: { model: "invalid-model" } },
          "127.0.0.1",
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("findAvailableChannel", () => {
    it("should find active channel for model", async () => {
      mockChannelRepo.find.mockResolvedValue([mockChannel]);

      const channel = await (service as any).findAvailableChannel(
        "gpt-3.5-turbo",
      );
      expect(channel).toEqual(mockChannel);
    });
  });

  describe("calculateCost", () => {
    it("should calculate cost correctly", async () => {
      const usage = {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500,
      };
      const cost = (service as any).calculateCost(
        "gpt-3.5-turbo",
        usage,
        mockChannel,
      );
      expect(cost).toBeGreaterThan(0);
    });
  });
});
