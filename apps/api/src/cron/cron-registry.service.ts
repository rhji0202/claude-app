import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { CronJob } from "cron";
import { CronStatus, CronType, UsageKind } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { IssuesService } from "../issues/issues.service";
import { CryptoService } from "../crypto/crypto.service";
import { AgentService, type RunResult } from "../agent/agent.service";
import { RepoManagerService } from "../repo/repo-manager.service";
import { WorktreeService } from "../repo/worktree.service";
import { NotifyService } from "../notify/notify.service";
import { UsageService } from "../usage/usage.service";

/**
 * 사용자 정의 크론 작업을 런타임에 등록/해제한다.
 * @Cron() 데코레이터(정적)가 아니라 SchedulerRegistry로 DB의 작업을 동적 관리하며,
 * 부팅 시 활성 작업을 복원한다. (기존 node-cron 워커 프로세스를 대체)
 */
@Injectable()
export class CronRegistryService implements OnModuleInit {
  private readonly logger = new Logger(CronRegistryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly registry: SchedulerRegistry,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly agent: AgentService,
    private readonly repos: RepoManagerService,
    private readonly worktrees: WorktreeService,
    private readonly notify: NotifyService,
    private readonly issues: IssuesService,
    private readonly usage: UsageService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      const jobs = await this.prisma.cronJob.findMany({ where: { enabled: true } });
      for (const j of jobs) this.register(j.id, j.schedule);
      this.logger.log(`크론 작업 ${jobs.length}개 복원 완료`);
    } catch (err) {
      this.logger.warn(`크론 복원 건너뜀(DB 미가동?): ${String(err)}`);
    }
  }

  register(id: string, schedule: string): void {
    this.remove(id);
    const job = CronJob.from({
      cronTime: schedule,
      onTick: () => {
        void this.fire(id);
      },
      start: true,
    });
    this.registry.addCronJob(id, job as never);
    this.logger.log(`크론 등록: ${id} → ${schedule}`);
  }

  remove(id: string): void {
    try {
      this.registry.deleteCronJob(id);
      this.logger.log(`크론 해제: ${id}`);
    } catch {
      /* 등록돼 있지 않음 */
    }
  }

  update(id: string, schedule: string, enabled: boolean): void {
    this.remove(id);
    if (enabled) this.register(id, schedule);
  }

  /** 잡별 실행 이력 보관 상한. 초과분은 fire 종료 시 자동 정리. */
  private static readonly MAX_RUNS = 50;

  /** 크론 작업을 즉시 실행 (관리 clone→worktree 격리 후 에이전트 호출 + 이력 기록) */
  async fire(id: string): Promise<void> {
    const job = await this.prisma.cronJob.findUnique({
      where: { id },
      include: {
        project: {
          select: {
            ownerId: true,
            gitRepo: true,
            gitTokenEnc: true,
            claudeAccountId: true,
          },
        },
      },
    });
    if (!job) return;
    this.logger.log(`크론 실행: ${job.name} (${id})`);

    // 실행 이력 row 생성(진행 중 = status null). 시작 시각 기준.
    const startedAt = new Date();
    const run = await this.startRunRecord(id, startedAt);

    // gitRepo 없으면 실행 불가(설계 12.5). 이력·요약에 오류 기록.
    if (!job.project.gitRepo) {
      const msg = "프로젝트에 gitRepo가 설정되어 있지 않습니다.";
      await this.finishRunRecord(id, run?.id, startedAt, {
        status: CronStatus.ERROR,
        error: msg,
      });
      await this.notifyError(job.projectId, job.name, msg);
      return;
    }

    // IMPORT 유형: 에이전트 실행 없이 GitHub 열린 이슈를 신규만 큐에 등록(워커가 자동 실행).
    if (job.type === CronType.IMPORT) {
      try {
        const n = await this.issues.importAllOpen(job.projectId);
        await this.finishRunRecord(id, run?.id, startedAt, {
          status: CronStatus.OK,
          result: `열린 이슈 동기화 완료 — 신규 ${n}건 등록`,
        });
      } catch (err) {
        this.logger.error(`이슈 가져오기 크론 실패 ${id}: ${String(err)}`);
        await this.finishRunRecord(id, run?.id, startedAt, {
          status: CronStatus.ERROR,
          error: String(err),
        });
        await this.notifyError(job.projectId, job.name, String(err));
      }
      return;
    }

    // 예산 가드레일: 프로젝트/계정이 월 예산 초과면 에이전트를 실행하지 않고 SKIPPED로 마감.
    // (크론은 무인·주기 실행이라 폭주 리스크가 크다. IMPORT는 비용이 없어 위에서 이미 처리됨.)
    const budget = await this.usage.budgetStatus(
      job.projectId,
      job.project.claudeAccountId,
      this.config.get<number>("BUDGET_WARN_RATIO") ?? 0.8,
    );
    if (budget.over) {
      this.logger.warn(`예산 초과로 크론 건너뜀 ${id}: ${budget.reason ?? ""}`);
      await this.finishRunRecord(id, run?.id, startedAt, {
        status: CronStatus.SKIPPED,
        result: budget.reason ?? "월 예산 초과 — 실행 건너뜀",
      });
      await this.notify.notify(job.projectId, {
        event: "budget.exceeded",
        title: `크론 "${job.name}" — ${budget.reason ?? "월 예산 초과로 실행 보류"}`,
      });
      return;
    }
    if (budget.nearLimit) {
      await this.notify.notify(job.projectId, {
        event: "budget.warning",
        title: `크론 "${job.name}" — ${budget.reason ?? "월 예산 소진 임박"}`,
      });
    }

    // 크론은 잡 id 기준 worktree로 격리(같은 프로젝트 이슈·다른 크론과 충돌 방지).
    const wtKey = `cron-${id}`;
    try {
      const token = this.crypto.decryptOptional(job.project.gitTokenEnc);
      await this.repos.ensureRepo(job.projectId, job.project.gitRepo, token);
      const wt = await this.worktrees.create(job.projectId, wtKey);
      try {
        const res = await this.agent.run(job.projectId, {
          prompt: job.prompt ?? "",
          userId: job.project.ownerId ?? undefined,
          cwd: wt.path,
          systemPrompt: "당신은 정기 작업을 수행하는 자동화 에이전트입니다.",
        });
        await this.finishRunRecord(id, run?.id, startedAt, {
          status: res.status === "ok" ? CronStatus.OK : CronStatus.ERROR,
          result: res.status === "ok" ? res.text : null,
          error: res.status === "ok" ? null : (res.error ?? null),
          sessionId: res.sessionId ?? null,
          usage: res.usage,
          projectId: job.projectId,
          claudeAccountId: res.accountId ?? job.project.claudeAccountId,
          userId: job.project.ownerId,
        });
        if (res.status !== "ok")
          await this.notifyError(job.projectId, job.name, res.error ?? null);
      } finally {
        await this.worktrees.remove(job.projectId, wtKey);
      }
    } catch (err) {
      this.logger.error(`크론 실행 실패 ${id}: ${String(err)}`);
      await this.finishRunRecord(id, run?.id, startedAt, {
        status: CronStatus.ERROR,
        error: String(err),
      });
      await this.notifyError(job.projectId, job.name, String(err));
    }
  }

  /** 크론 실패 알림(설정된 webhook이 있으면). 실패해도 무시. */
  private async notifyError(
    projectId: string,
    name: string,
    detail: string | null,
  ): Promise<void> {
    await this.notify.notify(projectId, {
      event: "cron.error",
      title: `크론 "${name}" 실패`,
      detail,
    });
  }

  /** 실행 시작 시 진행 중(status=null) CronRun을 만든다. 실패해도 실행은 계속. */
  private async startRunRecord(
    cronJobId: string,
    startedAt: Date,
  ): Promise<{ id: string } | null> {
    try {
      return await this.prisma.cronRun.create({
        data: { cronJobId, startedAt },
        select: { id: true },
      });
    } catch (e) {
      this.logger.warn(`크론 실행 이력 생성 실패 ${cronJobId}: ${String(e)}`);
      return null;
    }
  }

  /**
   * 실행 종료 시 CronRun을 마감하고 CronJob 요약(lastRunAt 등)을 갱신한다.
   * 이력 상한(MAX_RUNS) 초과분은 정리한다. 기록 실패는 warn만(실행 자체는 이미 끝남).
   */
  private async finishRunRecord(
    cronJobId: string,
    runId: string | undefined,
    startedAt: Date,
    data: {
      status: CronStatus;
      result?: string | null;
      error?: string | null;
      sessionId?: string | null;
      /** SDK 사용량. 있으면 CronRun 컬럼 + 원장에 기록. */
      usage?: RunResult["usage"];
      /** 원장 기록용(usage가 있을 때만). */
      projectId?: string;
      claudeAccountId?: string | null;
      userId?: string | null;
    },
  ): Promise<void> {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const u = data.usage;
    try {
      if (runId) {
        await this.prisma.cronRun.update({
          where: { id: runId },
          data: {
            status: data.status,
            result: data.result ?? null,
            error: data.error ?? null,
            sessionId: data.sessionId ?? null,
            durationMs,
            finishedAt,
            ...(u
              ? {
                  costUsd: u.costUsd,
                  inputTokens: u.inputTokens,
                  outputTokens: u.outputTokens,
                  cacheReadTokens: u.cacheReadTokens,
                  cacheCreationTokens: u.cacheCreationTokens,
                }
              : {}),
          },
        });
      }
      await this.prisma.cronJob.update({
        where: { id: cronJobId },
        data: {
          lastRunAt: finishedAt,
          lastStatus: data.status,
          lastResult: data.result ?? data.error ?? null,
        },
      });
      await this.pruneRuns(cronJobId);
    } catch (e) {
      this.logger.warn(`크론 결과 기록 실패 ${cronJobId}: ${String(e)}`);
    }

    // 사용량 원장 기록(있을 때만). refId=runId. 기록 실패는 UsageService가 흡수.
    if (u && data.projectId) {
      await this.usage.record({
        kind: UsageKind.CRON,
        projectId: data.projectId,
        claudeAccountId: data.claudeAccountId ?? null,
        userId: data.userId ?? null,
        refId: runId ?? null,
        usage: u,
      });
    }
  }

  /** 잡별 최근 MAX_RUNS건만 남기고 오래된 이력을 삭제한다. */
  private async pruneRuns(cronJobId: string): Promise<void> {
    const old = await this.prisma.cronRun.findMany({
      where: { cronJobId },
      orderBy: { startedAt: "desc" },
      skip: CronRegistryService.MAX_RUNS,
      select: { id: true },
    });
    if (old.length === 0) return;
    await this.prisma.cronRun.deleteMany({
      where: { id: { in: old.map((r) => r.id) } },
    });
  }
}
