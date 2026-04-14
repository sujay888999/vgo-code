import { Test, TestingModule } from "@nestjs/testing";
import { UserService } from "./user.service";
import { getRepositoryToken } from "@nestjs/typeorm";
import { User } from "./user.entity";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as bcrypt from "bcrypt";

describe("UserService", () => {
  let service: UserService;
  let mockRepository: any;

  const mockUser = {
    id: "123e4567-e89b-12d3-a456-426614174000",
    email: "test@example.com",
    username: "testuser",
    password: "$2b$10$mockhashedpassword",
    balance: 100.0,
    isAdmin: false,
    lastLoginAt: new Date(),
    createdAt: new Date(),
  };

  beforeEach(async () => {
    mockRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(User),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  describe("getProfile", () => {
    it("should return user profile", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.getProfile(mockUser.id);

      expect(result).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        username: mockUser.username,
        balance: Number(mockUser.balance),
        isAdmin: mockUser.isAdmin,
        lastLoginAt: mockUser.lastLoginAt,
        createdAt: mockUser.createdAt,
      });
    });

    it("should return null if user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.getProfile("nonexistent-id");

      expect(result).toBeNull();
    });
  });

  describe("getBalance", () => {
    it("should return user balance", async () => {
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.getBalance(mockUser.id);

      expect(result).toEqual({ balance: 100 });
    });

    it("should return 0 if user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      const result = await service.getBalance("nonexistent-id");

      expect(result).toEqual({ balance: 0 });
    });
  });

  describe("updateProfile", () => {
    it("should update user profile", async () => {
      const updatedUser = {
        ...mockUser,
        email: "newemail@example.com",
        username: "newusername",
      };
      mockRepository.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce(null);
      mockRepository.save.mockImplementation((user) =>
        Promise.resolve({ ...user }),
      );

      const result = await service.updateProfile(mockUser.id, {
        email: "newemail@example.com",
        username: "newusername",
      });

      expect(mockRepository.save).toHaveBeenCalled();
    });

    it("should throw NotFoundException if user not found", async () => {
      mockRepository.findOne.mockResolvedValue(null);

      await expect(
        service.updateProfile("nonexistent-id", {
          email: "test@example.com",
          username: "test",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ConflictException if email already in use", async () => {
      mockRepository.findOne
        .mockResolvedValueOnce(mockUser)
        .mockResolvedValueOnce({ ...mockUser, id: "different-id" });

      await expect(
        service.updateProfile(mockUser.id, {
          email: "taken@example.com",
          username: "test",
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("changePassword", () => {
    it("should change password successfully", async () => {
      jest
        .spyOn(bcrypt, "compare")
        .mockImplementation(() => Promise.resolve(true));
      jest
        .spyOn(bcrypt, "hash")
        .mockImplementation(() => Promise.resolve("newhashedpassword"));
      mockRepository.findOne.mockResolvedValue(mockUser);

      const result = await service.changePassword(mockUser.id, {
        currentPassword: "oldpassword",
        newPassword: "newpassword",
      });

      expect(result.message).toBe("密码修改成功");
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it("should throw UnauthorizedException for incorrect current password", async () => {
      jest
        .spyOn(bcrypt, "compare")
        .mockImplementation(() => Promise.resolve(false));
      mockRepository.findOne.mockResolvedValue(mockUser);

      await expect(
        service.changePassword(mockUser.id, {
          currentPassword: "wrongpassword",
          newPassword: "newpassword",
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it("should throw BadRequestException if new password equals current", async () => {
      jest
        .spyOn(bcrypt, "compare")
        .mockImplementation(() => Promise.resolve(true));
      mockRepository.findOne.mockResolvedValue(mockUser);

      await expect(
        service.changePassword(mockUser.id, {
          currentPassword: "password",
          newPassword: "password",
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
