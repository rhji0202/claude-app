import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ClaudeAccountService } from "./claude-account.service";
import { CryptoService } from "../crypto/crypto.service";
import { PrismaService } from "../prisma/prisma.service";

// 테스트용 32바이트 base64 키
const TEST_KEY = "dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLWxlbiE=";

function makeCrypto(): CryptoService {
  return new CryptoService({
    get: () => TEST_KEY,
  } as unknown as ConfigService);
}

describe("ClaudeAccountService", () => {
  let service: ClaudeAccountService;
  let crypto: CryptoService;
  let db: {
    claudeAccount: {
      count: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    crypto = makeCrypto();
    db = {
      claudeAccount: {
        count: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };
    service = new ClaudeAccountService(
      db as unknown as PrismaService,
      crypto,
    );
  });

  describe("addAccount", () => {
    it("sk-ant- 접두사가 아니면 BadRequest", async () => {
      await expect(
        service.addAccount("u1", "invalid-token"),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("첫 계정은 isActive=true, 토큰은 암호화 저장", async () => {
      db.claudeAccount.count.mockResolvedValue(0);
      db.claudeAccount.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: "a1",
          accountEmail: null,
          subscriptionType: null,
          createdAt: new Date("2026-01-01"),
          ...data,
        }),
      );

      const token = "sk-ant-oat01-SECRETVALUE123";
      const dto = await service.addAccount("u1", token, "회사");

      const stored = db.claudeAccount.create.mock.calls[0][0].data;
      expect(stored.isActive).toBe(true);
      expect(stored.label).toBe("회사");
      // 평문이 그대로 저장되면 안 됨
      expect(stored.accessTokenEnc).not.toContain("SECRETVALUE123");
      // 복호화하면 원문 복원
      expect(crypto.decrypt(stored.accessTokenEnc)).toBe(token);
      // DTO는 전체 토큰 미노출
      expect(JSON.stringify(dto)).not.toContain("SECRETVALUE123");
      expect(dto.tokenPreview.endsWith("…")).toBe(true);
    });

    it("두 번째 계정은 isActive=false", async () => {
      db.claudeAccount.count.mockResolvedValue(1);
      db.claudeAccount.create.mockImplementation(({ data }) =>
        Promise.resolve({
          id: "a2",
          accountEmail: null,
          subscriptionType: null,
          createdAt: new Date(),
          ...data,
        }),
      );
      await service.addAccount("u1", "sk-ant-oat01-SECOND");
      expect(db.claudeAccount.create.mock.calls[0][0].data.isActive).toBe(false);
    });
  });

  describe("activate", () => {
    it("대상 계정을 활성화하고 나머지를 비활성화", async () => {
      db.claudeAccount.findFirst.mockResolvedValue({ id: "a2", userId: "u1" });
      await service.activate("u1", "a2");
      expect(db.$transaction).toHaveBeenCalled();
      // 트랜잭션에 updateMany(비활성) + update(활성)가 포함되어야 함
      expect(db.claudeAccount.updateMany).toHaveBeenCalledWith({
        where: { userId: "u1" },
        data: { isActive: false },
      });
      expect(db.claudeAccount.update).toHaveBeenCalledWith({
        where: { id: "a2" },
        data: { isActive: true },
      });
    });
  });

  describe("getActiveToken", () => {
    it("활성 계정이 없으면 null", async () => {
      db.claudeAccount.findFirst.mockResolvedValue(null);
      expect(await service.getActiveToken("u1")).toBeNull();
    });

    it("활성 계정이 있으면 복호화된 토큰", async () => {
      const enc = crypto.encrypt("sk-ant-oat01-ACTIVE");
      db.claudeAccount.findFirst.mockResolvedValue({ accessTokenEnc: enc });
      expect(await service.getActiveToken("u1")).toBe("sk-ant-oat01-ACTIVE");
    });
  });

  describe("getTokenById", () => {
    it("존재하는 계정이면 복호화 토큰", async () => {
      const enc = crypto.encrypt("sk-ant-oat01-BYID");
      db.claudeAccount.findUnique.mockResolvedValue({ accessTokenEnc: enc });
      expect(await service.getTokenById("a1")).toBe("sk-ant-oat01-BYID");
    });

    it("없으면 null", async () => {
      db.claudeAccount.findUnique.mockResolvedValue(null);
      expect(await service.getTokenById("nope")).toBeNull();
    });

    it("expectedUserId가 소유자와 일치하면 토큰 반환", async () => {
      const enc = crypto.encrypt("sk-ant-oat01-OWNED");
      db.claudeAccount.findUnique.mockResolvedValue({
        userId: "owner-1",
        accessTokenEnc: enc,
      });
      expect(await service.getTokenById("a1", "owner-1")).toBe(
        "sk-ant-oat01-OWNED",
      );
    });

    it("expectedUserId가 소유자와 다르면 null(토큰 미노출)", async () => {
      const enc = crypto.encrypt("sk-ant-oat01-OTHER");
      db.claudeAccount.findUnique.mockResolvedValue({
        userId: "owner-1",
        accessTokenEnc: enc,
      });
      expect(await service.getTokenById("a1", "attacker")).toBeNull();
    });
  });
});
