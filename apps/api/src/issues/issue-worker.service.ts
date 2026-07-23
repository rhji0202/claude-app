import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { IssueStatus } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { IssuesService } from "./issues.service";
import { UsageService } from "../usage/usage.service";
import { NotifyService } from "../notify/notify.service";

/**
 * DB 기반 큐 워커(설계 5.1). **API와 동일 프로세스(in-process)**로 동작한다(리스크 S1).
 *
 * 주기적으로 QUEUED 이슈를 폴링해, 남은 동시 실행 슬롯만큼 클레임(RUNNING)하고
 * IssuesService.executeClaimed로 실행한다. 실행 격리(clone/worktree)와 상태 기록은
 * executeClaimed가 담당한다.
 *
 * 동시성은 한 곳으로 통일(리스크 M1): 워커가 "클레임 수 ≤ 슬롯"을 보장하고,
 * AgentService.p-limit은 초과 방지 안전망으로만 둔다.
 */
@Injectable()
export class IssueWorkerService implements OnModuleInit {
  private readonly logger = new Logger(IssueWorkerService.name);

  /** 이 워커 인스턴스 식별자(다중 워커 대비 lockedBy 기록용). */
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;

  private readonly concurrency: number;
  private readonly pollMs: number;
  private readonly maxRetry: number;
  private readonly staleMs: number;
  /** 재시도 백오프 기준(ms). 다음 시도 대기 = base * 2^attempts. */
  private readonly backoffBaseMs = 30000;

  /** tick 재진입 방지(폴링 주기보다 tick이 길어질 때). */
  private ticking = false;

  /**
   * 일시정지 플래그(운영 제어). true면 새 QUEUED를 클레임하지 않는다(진행 중 RUNNING은 유지).
   * in-memory 단일 인스턴스 전제 — 프로세스 재시작 시 기본(재개)으로 돌아간다.
   */
  private paused = false;

  /** 예산 초과 알림 중복 방지(projectId → 마지막 발신 날짜 YYYY-MM-DD). */
  private readonly budgetNotified = new Map<string, string>();

  constructor(
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
    private readonly prisma: PrismaService,
    private readonly issues: IssuesService,
    private readonly usage: UsageService,
    private readonly notify: NotifyService,
  ) {
    this.concurrency = this.config.get<number>("AGENT_CONCURRENCY") ?? 3;
    this.pollMs = this.config.get<number>("ISSUE_WORKER_POLL_MS") ?? 5000;
    this.maxRetry = this.config.get<number>("ISSUE_MAX_RETRY") ?? 2;
    this.staleMs = this.config.get<number>("ISSUE_STALE_MS") ?? 600000;
  }

  onModuleInit(): void {
    if (this.pollMs <= 0) {
      this.logger.warn("ISSUE_WORKER_POLL_MS<=0 — 이슈 워커 폴링 비활성화");
      return;
    }
    const interval = setInterval(() => {
      void this.tick();
    }, this.pollMs);
    // SchedulerRegistry에 등록(cron-registry 패턴과 일관 · 종료 시 정리)
    this.scheduler.addInterval("issue-worker", interval);
    this.logger.log(
      `이슈 워커 시작: poll=${this.pollMs}ms, concurrency=${this.concurrency}, maxRetry=${this.maxRetry}`,
    );
  }

  // ---- 운영 제어(대시보드) ----

  /** 워커 일시정지: 새 QUEUED 클레임 중단(진행 중 RUNNING은 유지). */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    this.logger.log("이슈 워커 일시정지");
  }

  /** 워커 재개: 다음 tick부터 다시 클레임한다. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.logger.log("이슈 워커 재개");
  }

  /** 현재 워커 런타임 상태(대시보드 stats에 포함). */
  runtime(): { workerId: string; concurrency: number; paused: boolean } {
    return {
      workerId: this.workerId,
      concurrency: this.concurrency,
      paused: this.paused,
    };
  }

  /** stale 클레임 즉시 회수(대시보드 수동 트리거). 회수 건수 반환. */
  forceReclaimStale(): Promise<number> {
    return this.reclaimStale();
  }

  /** 한 번의 폴링 주기: stale 회수 → 재시도 재큐 → 여유 슬롯만큼 클레임·실행. */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.reclaimStale();
      await this.requeueRetryable();
      await this.claimAndRun();
    } catch (err) {
      this.logger.warn(`워커 tick 오류: ${String(err)}`);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * 여유 슬롯(free = concurrency - RUNNING)만큼 QUEUED를 클레임해 실행한다.
   * 클레임은 RUNNING + claimedAt + lockedBy + attempts++ 로 마킹한다.
   */
  private async claimAndRun(): Promise<void> {
    if (this.paused) return; // 일시정지 중: 새 클레임 안 함(진행 중은 유지)
    const running = await this.prisma.issueTask.count({
      where: { status: IssueStatus.RUNNING },
    });
    const free = this.concurrency - running;
    if (free <= 0) return;

    // 오래된 것부터(FIFO). 재시도 대기 중인 것은 requeueRetryable이 QUEUED로 돌린 것만 대상.
    const candidates = await this.prisma.issueTask.findMany({
      where: { status: IssueStatus.QUEUED },
      orderBy: { createdAt: "asc" },
      take: free,
    });
    if (candidates.length === 0) return;

    // 예산 판정을 프로젝트당 1회만(같은 tick의 여러 이슈가 같은 프로젝트일 수 있음).
    const budgetCache = new Map<string, { over: boolean; reason?: string }>();

    for (const task of candidates) {
      // 예산 가드레일(설계 개선): 프로젝트/계정이 월 예산 초과면 클레임하지 않고 건너뛴다.
      // 이슈는 QUEUED로 남아 예산 리셋(다음 달)·상향 시 자연히 재개된다.
      let budget = budgetCache.get(task.projectId);
      if (!budget) {
        budget = await this.budgetStatus(task.projectId);
        budgetCache.set(task.projectId, budget);
      }
      if (budget.over) {
        await this.warnBudget(task.projectId, budget.reason);
        continue;
      }

      // 단일 인스턴스 전제의 낙관적 클레임: status=QUEUED인 동안에만 RUNNING으로 전환.
      // (스케일아웃 시 FOR UPDATE SKIP LOCKED 필요 — 설계 3·10)
      const claimed = await this.prisma.issueTask.updateMany({
        where: { id: task.id, status: IssueStatus.QUEUED },
        data: {
          status: IssueStatus.RUNNING,
          claimedAt: new Date(),
          lockedBy: this.workerId,
          attempts: { increment: 1 },
          error: null,
        },
      });
      if (claimed.count === 0) continue; // 다른 tick/워커가 이미 집음

      // 실행은 병렬(동시성은 이미 free로 제한). await하지 않고 백그라운드로.
      // executeClaimed는 throw하지 않으며 상태를 스스로 기록한다.
      void this.issues.executeClaimed(task);
    }
  }

  /**
   * 프로젝트 예산 초과 여부. 프로젝트에 연결된 Claude 계정도 함께 판정한다
   * (UsageService.isOverBudget이 프로젝트+계정 양쪽 확인).
   */
  private async budgetStatus(
    projectId: string,
  ): Promise<{ over: boolean; reason?: string }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { claudeAccountId: true },
    });
    return this.usage.isOverBudget(projectId, project?.claudeAccountId ?? null);
  }

  /**
   * 예산 초과 알림(프로젝트당 하루 1회). 워커 재시작 시 캐시가 초기화돼 다시 1회 발신될 수 있다.
   */
  private async warnBudget(projectId: string, reason?: string): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.budgetNotified.get(projectId) === today) return;
    this.budgetNotified.set(projectId, today);
    this.logger.warn(`예산 초과로 클레임 건너뜀 ${projectId}: ${reason ?? ""}`);
    await this.notify.notify(projectId, {
      event: "budget.exceeded",
      title: reason ?? "월 예산 초과 — 이슈 실행 보류",
    });
  }

  /**
   * stale 클레임 회수(설계 5.1): RUNNING인데 claimedAt이 staleMs보다 오래됨 → INTERRUPTED.
   * in-process 단일 워커면 onModuleInit 정리로 대부분 커버되나, 다중 워커·긴 실행 대비.
   */
  private async reclaimStale(): Promise<number> {
    const cutoff = new Date(Date.now() - this.staleMs);
    const { count } = await this.prisma.issueTask.updateMany({
      where: { status: IssueStatus.RUNNING, claimedAt: { lt: cutoff } },
      data: {
        status: IssueStatus.INTERRUPTED,
        error: "실행이 오래 응답 없어 중단으로 회수되었습니다.",
        claimedAt: null,
        lockedBy: null,
      },
    });
    if (count > 0) this.logger.warn(`stale 이슈 ${count}건 회수(INTERRUPTED)`);
    return count;
  }

  /**
   * 재시도(설계 5.1): ERROR/INTERRUPTED이면서 attempts <= maxRetry인 이슈를,
   * 지수 백오프(base * 2^attempts) 경과 후 QUEUED로 되돌린다.
   * updatedAt을 마지막 실패 시각의 근사로 사용한다.
   */
  private async requeueRetryable(): Promise<void> {
    if (this.maxRetry <= 0) return;
    const now = Date.now();
    const rows = await this.prisma.issueTask.findMany({
      where: {
        status: { in: [IssueStatus.ERROR, IssueStatus.INTERRUPTED] },
        attempts: { lte: this.maxRetry },
      },
      select: { id: true, attempts: true, updatedAt: true },
    });
    for (const r of rows) {
      const wait = this.backoffBaseMs * 2 ** r.attempts;
      if (now - r.updatedAt.getTime() < wait) continue;
      const res = await this.prisma.issueTask.updateMany({
        where: {
          id: r.id,
          status: { in: [IssueStatus.ERROR, IssueStatus.INTERRUPTED] },
        },
        data: { status: IssueStatus.QUEUED, claimedAt: null, lockedBy: null },
      });
      if (res.count > 0)
        this.logger.log(`이슈 재시도 재큐: ${r.id} (attempt ${r.attempts + 1})`);
    }
  }
}
