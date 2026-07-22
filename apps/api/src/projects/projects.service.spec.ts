import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Visibility, Role } from "@prisma/client";
import { ProjectsService } from "./projects.service";
import { CryptoService } from "../crypto/crypto.service";
import { PrismaService } from "../prisma/prisma.service";

const TEST_KEY = "dGVzdC1lbmNyeXB0aW9uLWtleS0zMmJ5dGVzLWxlbiE=";
const makeCrypto = () =>
  new CryptoService({ get: () => TEST_KEY } as unknown as ConfigService);

function rawProject(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: "p1",
    name: "proj",
    description: null,
    cwd: "/tmp/p",
    gitRepo: "o/r",
    gitBranch: "main",
    gitTokenEnc: null,
    ownerId: "owner1",
    visibility: Visibility.PRIVATE,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...over,
  };
}

describe("ProjectsService", () => {
  let service: ProjectsService;
  let crypto: CryptoService;
  let db: {
    project: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    user: { findUnique: jest.Mock };
  };

  beforeEach(() => {
    crypto = makeCrypto();
    db = {
      project: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      // 기본: 비-admin (admin 우회 테스트에서만 ADMIN 반환)
      user: { findUnique: jest.fn().mockResolvedValue({ role: "MEMBER" }) },
    };
    service = new ProjectsService(db as unknown as PrismaService, crypto);
  });

  describe("toDto (필드 제거 회귀 방지)", () => {
    it("제거된 필드가 없고 secrets는 hasGitToken만", async () => {
      db.project.findMany.mockResolvedValue([rawProject({ gitTokenEnc: "v1:x:y:z" })]);
      const [dto] = await service.list("owner1");
      expect(dto).not.toHaveProperty("model");
      expect(dto).not.toHaveProperty("allowedTools");
      expect(dto).not.toHaveProperty("anthropicBaseUrl");
      expect(dto.secrets).toEqual({ hasGitToken: true });
      expect(dto.secrets).not.toHaveProperty("hasAnthropicApiKey");
    });
  });

  describe("접근 제어", () => {
    it("owner는 owner 역할", async () => {
      db.project.findUnique.mockResolvedValue({
        ...rawProject(),
        shares: [],
      });
      expect(await service.getAccessRole("p1", "owner1")).toBe("owner");
    });

    it("공유받은 editor는 editor 역할", async () => {
      db.project.findUnique.mockResolvedValue({
        ...rawProject({ ownerId: "someoneelse" }),
        shares: [{ role: Role.EDITOR }],
      });
      expect(await service.getAccessRole("p1", "u2")).toBe("editor");
    });

    it("public 프로젝트는 무관 사용자에게 viewer", async () => {
      db.project.findUnique.mockResolvedValue({
        ...rawProject({ ownerId: "x", visibility: Visibility.PUBLIC }),
        shares: [],
      });
      expect(await service.getAccessRole("p1", "u3")).toBe("viewer");
    });

    it("권한 없으면 null → assertAccess는 Forbidden", async () => {
      db.project.findUnique.mockResolvedValue({
        ...rawProject({ ownerId: "x", visibility: Visibility.PRIVATE }),
        shares: [],
      });
      expect(await service.getAccessRole("p1", "u4")).toBeNull();
      await expect(service.assertAccess("p1", "u4")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("전역 admin은 타인 private 프로젝트에도 owner (전체 접근)", async () => {
      db.project.findUnique.mockResolvedValue({
        ...rawProject({ ownerId: "x", visibility: Visibility.PRIVATE }),
        shares: [],
      });
      db.user.findUnique.mockResolvedValue({ role: "ADMIN" });
      expect(await service.getAccessRole("p1", "admin-user")).toBe("owner");
    });

    it("viewer는 편집 불가 (assertCanEdit Forbidden)", async () => {
      db.project.findUnique.mockResolvedValue({
        ...rawProject({ ownerId: "x", visibility: Visibility.PUBLIC }),
        shares: [],
      });
      await expect(service.assertCanEdit("p1", "u5")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it("editor는 owner 아님 (assertOwner Forbidden)", async () => {
      db.project.findUnique.mockResolvedValue({
        ...rawProject({ ownerId: "x" }),
        shares: [{ role: Role.EDITOR }],
      });
      await expect(service.assertOwner("p1", "u6")).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe("create", () => {
    it("gitToken을 암호화해 저장", async () => {
      db.project.create.mockImplementation(({ data }) =>
        Promise.resolve(rawProject({ gitTokenEnc: data.gitTokenEnc })),
      );
      await service.create(
        { name: "p", cwd: "/tmp/p", gitToken: "ghp_SECRET" },
        "owner1",
      );
      const stored = db.project.create.mock.calls[0][0].data;
      expect(stored.gitTokenEnc).not.toContain("ghp_SECRET");
      expect(crypto.decrypt(stored.gitTokenEnc)).toBe("ghp_SECRET");
    });
  });
});
