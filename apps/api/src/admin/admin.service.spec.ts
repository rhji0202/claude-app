import { BadRequestException, ConflictException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AdminService } from "./admin.service";
import { PrismaService } from "../prisma/prisma.service";

describe("AdminService", () => {
  let service: AdminService;
  let db: {
    user: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(() => {
    db = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
    };
    service = new AdminService(
      db as unknown as PrismaService,
      { get: () => undefined } as unknown as ConfigService,
    );
  });

  const row = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "u1",
    email: "a@b.com",
    name: null,
    role: "MEMBER",
    disabled: false,
    createdAt: new Date("2026-01-01"),
    ...over,
  });

  describe("create", () => {
    it("중복 이메일이면 Conflict", async () => {
      db.user.findUnique.mockResolvedValue(row());
      await expect(
        service.create({ email: "a@b.com", password: "password123" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("role=admin으로 생성 시 해시 저장", async () => {
      db.user.findUnique.mockResolvedValue(null);
      db.user.create.mockImplementation(({ data }) =>
        Promise.resolve(row({ ...data })),
      );
      const dto = { email: "new@b.com", password: "password123", role: "admin" as const };
      const res = await service.create(dto);
      const created = db.user.create.mock.calls[0][0].data;
      expect(created.passwordHash).not.toBe("password123");
      expect(created.role).toBe("ADMIN");
      expect(res.role).toBe("admin");
    });
  });

  describe("update — 마지막 관리자 보호", () => {
    it("마지막 admin 강등 → BadRequest", async () => {
      db.user.findUnique.mockResolvedValue(row({ role: "ADMIN" }));
      db.user.count.mockResolvedValue(1); // 활성 admin 1명뿐
      await expect(
        service.update("u1", { role: "member" }, "actor"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("마지막 admin 비활성화 → BadRequest", async () => {
      db.user.findUnique.mockResolvedValue(row({ role: "ADMIN" }));
      db.user.count.mockResolvedValue(1);
      await expect(
        service.update("u1", { disabled: true }, "actor"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("admin이 2명이면 강등 허용", async () => {
      db.user.findUnique.mockResolvedValue(row({ role: "ADMIN" }));
      db.user.count.mockResolvedValue(2);
      db.user.update.mockResolvedValue(row({ role: "MEMBER" }));
      const res = await service.update("u1", { role: "member" }, "actor");
      expect(res.role).toBe("member");
    });

    it("자기 자신 비활성화 → BadRequest", async () => {
      db.user.findUnique.mockResolvedValue(row({ role: "MEMBER" }));
      await expect(
        service.update("u1", { disabled: true }, "u1"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("onModuleInit (첫 관리자 시드)", () => {
    it("ADMIN_EMAILS의 사용자를 admin으로 승격", async () => {
      const svc = new AdminService(
        db as unknown as PrismaService,
        { get: () => "a@b.com, c@d.com" } as unknown as ConfigService,
      );
      db.user.updateMany.mockResolvedValue({ count: 2 });
      await svc.onModuleInit();
      expect(db.user.updateMany).toHaveBeenCalledWith({
        where: { email: { in: ["a@b.com", "c@d.com"] }, role: { not: "ADMIN" } },
        data: { role: "ADMIN" },
      });
    });

    it("ADMIN_EMAILS 없으면 아무것도 안 함", async () => {
      await service.onModuleInit();
      expect(db.user.updateMany).not.toHaveBeenCalled();
    });
  });
});
