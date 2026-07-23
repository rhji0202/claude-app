import { UsageKind } from "@prisma/client";
import type { AgentUsage } from "@claude-app/shared";
import { UsageService } from "./usage.service";
import { PrismaService } from "../prisma/prisma.service";

const USAGE: AgentUsage = {
  costUsd: 0.02,
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 10,
  cacheCreationTokens: 5,
  model: "claude-opus-4-8",
  durationMs: 3000,
  numTurns: 3,
};

describe("UsageService", () => {
  let prisma: {
    usageRecord: {
      create: jest.Mock;
      aggregate: jest.Mock;
      findMany: jest.Mock;
    };
    project: { findUnique: jest.Mock; findMany: jest.Mock };
    claudeAccount: { findUnique: jest.Mock; findMany: jest.Mock };
  };
  let service: UsageService;

  beforeEach(() => {
    prisma = {
      usageRecord: {
        create: jest.fn().mockResolvedValue({}),
        aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      project: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      claudeAccount: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    service = new UsageService(prisma as unknown as PrismaService);
  });

  describe("record", () => {
    it("usage를 원장에 기록한다", async () => {
      await service.record({
        kind: UsageKind.ISSUE,
        projectId: "p1",
        claudeAccountId: "a1",
        userId: "u1",
        refId: "i1",
        usage: USAGE,
      });
      expect(prisma.usageRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          kind: UsageKind.ISSUE,
          projectId: "p1",
          claudeAccountId: "a1",
          refId: "i1",
          costUsd: 0.02,
          inputTokens: 100,
          model: "claude-opus-4-8",
        }),
      });
    });

    it("usage가 없으면 no-op(기록 안 함)", async () => {
      await service.record({
        kind: UsageKind.CHAT,
        projectId: "p1",
        usage: undefined as unknown as AgentUsage,
      });
      expect(prisma.usageRecord.create).not.toHaveBeenCalled();
    });

    it("create가 실패해도 throw하지 않는다", async () => {
      prisma.usageRecord.create.mockRejectedValue(new Error("db down"));
      await expect(
        service.record({ kind: UsageKind.ISSUE, projectId: "p1", usage: USAGE }),
      ).resolves.toBeUndefined();
    });
  });

  describe("isOverBudget", () => {
    it("프로젝트 예산 미설정이면 초과 아님", async () => {
      prisma.project.findUnique.mockResolvedValue({
        monthlyBudgetUsd: null,
        name: "P",
      });
      const r = await service.isOverBudget("p1", null);
      expect(r.over).toBe(false);
    });

    it("프로젝트 이번 달 비용이 예산 이상이면 초과", async () => {
      prisma.project.findUnique.mockResolvedValue({
        monthlyBudgetUsd: 10,
        name: "P",
      });
      prisma.usageRecord.aggregate.mockResolvedValue({
        _sum: { costUsd: 12 },
      });
      const r = await service.isOverBudget("p1", null);
      expect(r.over).toBe(true);
      expect(r.reason).toContain("예산 초과");
    });

    it("계정 예산 초과면 초과(프로젝트는 여유 있어도)", async () => {
      prisma.project.findUnique.mockResolvedValue({
        monthlyBudgetUsd: null,
        name: "P",
      });
      prisma.claudeAccount.findUnique.mockResolvedValue({
        monthlyBudgetUsd: 5,
        label: "A",
      });
      prisma.usageRecord.aggregate.mockResolvedValue({ _sum: { costUsd: 6 } });
      const r = await service.isOverBudget("p1", "a1");
      expect(r.over).toBe(true);
      expect(r.reason).toContain("계정");
    });

    it("조회 실패 시 실행을 막지 않는다(over=false)", async () => {
      prisma.project.findUnique.mockRejectedValue(new Error("boom"));
      const r = await service.isOverBudget("p1", null);
      expect(r.over).toBe(false);
    });
  });

  describe("summary", () => {
    it("projectIds가 비면 빈 결과", async () => {
      const s = await service.summary({
        projectIds: [],
        from: new Date("2026-07-01"),
        to: new Date("2026-07-31"),
        groupBy: "day",
      });
      expect(s.rows).toEqual([]);
      expect(s.total.count).toBe(0);
      expect(prisma.usageRecord.findMany).not.toHaveBeenCalled();
    });

    it("day 그룹은 날짜 버킷으로 합산하고 시간순 정렬", async () => {
      prisma.usageRecord.findMany.mockResolvedValue([
        {
          projectId: "p1",
          claudeAccountId: null,
          model: "m",
          kind: "ISSUE",
          costUsd: 1,
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          createdAt: new Date("2026-07-02T10:00:00Z"),
        },
        {
          projectId: "p1",
          claudeAccountId: null,
          model: "m",
          kind: "ISSUE",
          costUsd: 2,
          inputTokens: 20,
          outputTokens: 10,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          createdAt: new Date("2026-07-02T12:00:00Z"),
        },
        {
          projectId: "p1",
          claudeAccountId: null,
          model: "m",
          kind: "ISSUE",
          costUsd: 4,
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          createdAt: new Date("2026-07-01T09:00:00Z"),
        },
      ]);
      const s = await service.summary({
        projectIds: ["p1"],
        from: new Date("2026-07-01"),
        to: new Date("2026-07-31"),
        groupBy: "day",
      });
      expect(s.rows).toHaveLength(2);
      expect(s.rows[0].key).toBe("2026-07-01");
      expect(s.rows[1].key).toBe("2026-07-02");
      expect(s.rows[1].costUsd).toBe(3); // 1 + 2
      expect(s.total.costUsd).toBe(7);
      expect(s.total.count).toBe(3);
    });

    it("project 그룹은 프로젝트 이름을 라벨로 붙인다", async () => {
      prisma.usageRecord.findMany.mockResolvedValue([
        {
          projectId: "p1",
          claudeAccountId: null,
          model: "m",
          kind: "ISSUE",
          costUsd: 1,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          createdAt: new Date("2026-07-02T10:00:00Z"),
        },
      ]);
      prisma.project.findMany.mockResolvedValue([{ id: "p1", name: "My Project" }]);
      const s = await service.summary({
        projectIds: ["p1"],
        from: new Date("2026-07-01"),
        to: new Date("2026-07-31"),
        groupBy: "project",
      });
      expect(s.rows[0].label).toBe("My Project");
    });
  });
});
