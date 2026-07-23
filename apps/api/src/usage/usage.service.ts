import { Injectable, Logger } from "@nestjs/common";
import { Prisma, UsageKind } from "@prisma/client";
import type {
  AgentUsage,
  UsageGroupBy,
  UsageSummary,
  UsageSummaryRow,
} from "@claude-app/shared";
import { PrismaService } from "../prisma/prisma.service";

export interface RecordUsageInput {
  kind: UsageKind;
  projectId: string;
  claudeAccountId?: string | null;
  userId?: string | null;
  /** 참조 대상 id: issueId / cronRunId / chatSessionId. */
  refId?: string | null;
  usage: AgentUsage;
}

/**
 * 사용량 원장(UsageRecord) 기록·집계·예산 판정.
 *
 * 기록은 부가 기능이므로 실패해도 절대 throw하지 않는다(호출측 실행에 영향 없음, notify 패턴 준수).
 * 집계는 원장을 groupBy로 조회한다(인덱스가 projectId/account/createdAt 커버).
 */
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 실행 1건의 사용량을 원장에 기록. usage가 없으면(비용 정보 미수집) no-op. */
  async record(input: RecordUsageInput): Promise<void> {
    const u = input.usage;
    if (!u) return;
    try {
      await this.prisma.usageRecord.create({
        data: {
          kind: input.kind,
          projectId: input.projectId,
          claudeAccountId: input.claudeAccountId ?? null,
          userId: input.userId ?? null,
          refId: input.refId ?? null,
          model: u.model ?? null,
          costUsd: u.costUsd,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          cacheReadTokens: u.cacheReadTokens,
          cacheCreationTokens: u.cacheCreationTokens,
          durationMs: u.durationMs ?? null,
        },
      });
    } catch (e) {
      this.logger.warn(`사용량 기록 실패 ${input.kind} ${input.refId}: ${String(e)}`);
    }
  }

  /** 이번 달(1일 00:00 이후) 시작 시각. 예산 판정·대시보드 기본 범위. */
  private monthStart(now: Date): Date {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  /**
   * 프로젝트/계정의 이번 달 누적 비용(USD)을 합산한다.
   * projectId·accountId 중 지정된 것으로 스코프(둘 다면 AND).
   */
  async monthlyCost(scope: {
    projectId?: string;
    claudeAccountId?: string;
    since?: Date;
  }): Promise<number> {
    const since = scope.since ?? this.monthStart(new Date());
    const where: Prisma.UsageRecordWhereInput = { createdAt: { gte: since } };
    if (scope.projectId) where.projectId = scope.projectId;
    if (scope.claudeAccountId) where.claudeAccountId = scope.claudeAccountId;
    const agg = await this.prisma.usageRecord.aggregate({
      where,
      _sum: { costUsd: true },
    });
    return agg._sum.costUsd ?? 0;
  }

  /**
   * 예산 초과 여부. 프로젝트 또는 계정 중 하나라도 월 예산을 넘으면 true.
   * 예산 미설정(null)이면 무제한으로 간주. 조회 실패 시 false(실행을 막지 않음).
   */
  async isOverBudget(
    projectId: string,
    claudeAccountId?: string | null,
  ): Promise<{ over: boolean; reason?: string }> {
    try {
      const [project, account] = await Promise.all([
        this.prisma.project.findUnique({
          where: { id: projectId },
          select: { monthlyBudgetUsd: true, name: true },
        }),
        claudeAccountId
          ? this.prisma.claudeAccount.findUnique({
              where: { id: claudeAccountId },
              select: { monthlyBudgetUsd: true, label: true },
            })
          : Promise.resolve(null),
      ]);

      if (project?.monthlyBudgetUsd != null) {
        const spent = await this.monthlyCost({ projectId });
        if (spent >= project.monthlyBudgetUsd)
          return {
            over: true,
            reason: `프로젝트 "${project.name}" 월 예산 초과 ($${spent.toFixed(2)} / $${project.monthlyBudgetUsd})`,
          };
      }
      if (account?.monthlyBudgetUsd != null && claudeAccountId) {
        const spent = await this.monthlyCost({ claudeAccountId });
        if (spent >= account.monthlyBudgetUsd)
          return {
            over: true,
            reason: `계정 "${account.label}" 월 예산 초과 ($${spent.toFixed(2)} / $${account.monthlyBudgetUsd})`,
          };
      }
      return { over: false };
    } catch (e) {
      this.logger.warn(`예산 판정 실패 ${projectId}: ${String(e)}`);
      return { over: false };
    }
  }

  /**
   * 사용량 집계. 접근 가능한 프로젝트로 스코프한 뒤 groupBy 기준으로 합산한다.
   * groupBy=day는 날짜(YYYY-MM-DD) 버킷, 나머지는 해당 컬럼 값 기준.
   */
  async summary(opts: {
    projectIds: string[];
    from: Date;
    to: Date;
    groupBy: UsageGroupBy;
  }): Promise<UsageSummary> {
    const { projectIds, from, to, groupBy } = opts;
    const rows: UsageSummaryRow[] = [];
    const total = { costUsd: 0, inputTokens: 0, outputTokens: 0, count: 0 };

    if (projectIds.length === 0) {
      return {
        groupBy,
        from: from.toISOString(),
        to: to.toISOString(),
        rows,
        total,
      };
    }

    const records = await this.prisma.usageRecord.findMany({
      where: { projectId: { in: projectIds }, createdAt: { gte: from, lte: to } },
      select: {
        projectId: true,
        claudeAccountId: true,
        model: true,
        kind: true,
        costUsd: true,
        inputTokens: true,
        outputTokens: true,
        cacheReadTokens: true,
        cacheCreationTokens: true,
        createdAt: true,
      },
    });

    // 라벨용 이름 해석(project·account만). 필요한 id만 모아 한 번에 조회.
    const bucket = new Map<string, UsageSummaryRow>();
    const keyOf = (r: (typeof records)[number]): string => {
      switch (groupBy) {
        case "day":
          return r.createdAt.toISOString().slice(0, 10);
        case "project":
          return r.projectId;
        case "account":
          return r.claudeAccountId ?? "(none)";
        case "model":
          return r.model ?? "(unknown)";
        case "kind":
          return r.kind;
      }
    };

    for (const r of records) {
      const key = keyOf(r);
      let row = bucket.get(key);
      if (!row) {
        row = {
          key,
          label: null,
          costUsd: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          count: 0,
        };
        bucket.set(key, row);
      }
      row.costUsd += r.costUsd;
      row.inputTokens += r.inputTokens;
      row.outputTokens += r.outputTokens;
      row.cacheReadTokens += r.cacheReadTokens;
      row.cacheCreationTokens += r.cacheCreationTokens;
      row.count += 1;

      total.costUsd += r.costUsd;
      total.inputTokens += r.inputTokens;
      total.outputTokens += r.outputTokens;
      total.count += 1;
    }

    // project/account 그룹이면 사람이 읽을 라벨을 붙인다.
    if (groupBy === "project") {
      const names = await this.prisma.project.findMany({
        where: { id: { in: [...bucket.keys()] } },
        select: { id: true, name: true },
      });
      const map = new Map(names.map((n) => [n.id, n.name]));
      for (const row of bucket.values()) row.label = map.get(row.key) ?? row.key;
    } else if (groupBy === "account") {
      const ids = [...bucket.keys()].filter((k) => k !== "(none)");
      const accts = await this.prisma.claudeAccount.findMany({
        where: { id: { in: ids } },
        select: { id: true, label: true },
      });
      const map = new Map(accts.map((a) => [a.id, a.label]));
      for (const row of bucket.values())
        row.label = row.key === "(none)" ? "(계정 없음)" : (map.get(row.key) ?? row.key);
    }

    // day는 시간순, 나머지는 비용 내림차순.
    const out = [...bucket.values()];
    out.sort((a, b) =>
      groupBy === "day" ? a.key.localeCompare(b.key) : b.costUsd - a.costUsd,
    );

    return {
      groupBy,
      from: from.toISOString(),
      to: to.toISOString(),
      rows: out,
      total,
    };
  }
}
