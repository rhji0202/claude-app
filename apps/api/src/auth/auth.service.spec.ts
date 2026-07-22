import { UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcryptjs";
import { AuthService } from "./auth.service";
import { PrismaService } from "../prisma/prisma.service";

describe("AuthService", () => {
  let service: AuthService;
  let prisma: {
    user: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock };
  };
  const jwt = new JwtService({ secret: "test-secret" });

  beforeEach(() => {
    prisma = {
      user: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    };
    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt,
    );
  });

  const fakeUser = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "u1",
    email: "a@b.com",
    name: "Tester",
    passwordHash: bcrypt.hashSync("password123", 10),
    role: "MEMBER",
    disabled: false,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  });

  describe("login", () => {
    it("존재하지 않는 이메일이면 Unauthorized", async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.login({ email: "x@y.com", password: "whatever" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("비밀번호 불일치면 Unauthorized", async () => {
      prisma.user.findUnique.mockResolvedValue(fakeUser());
      await expect(
        service.login({ email: "a@b.com", password: "wrongpass" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("비활성화된 계정이면 Unauthorized", async () => {
      prisma.user.findUnique.mockResolvedValue(fakeUser({ disabled: true }));
      await expect(
        service.login({ email: "a@b.com", password: "password123" }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it("성공하면 토큰 + 유저 DTO 반환 (passwordHash 미노출, role 포함)", async () => {
      prisma.user.findUnique.mockResolvedValue(fakeUser());
      const res = await service.login({
        email: "a@b.com",
        password: "password123",
      });
      expect(res.accessToken).toEqual(expect.any(String));
      expect(res.user).not.toHaveProperty("passwordHash");
      expect(res.user.email).toBe("a@b.com");
      expect(res.user.role).toBe("member");
      expect(res.user.disabled).toBe(false);
    });
  });
});
