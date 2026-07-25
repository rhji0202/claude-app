import { IssueStatus } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { IssuesService } from "./issues.service";
import { UsageService } from "../usage/usage.service";
import { NotifyService } from "../notify/notify.service";
import { IssueWorkerService } from "./issue-worker.service";

/** ConfigService 스텁: 주어진 map에서 값 반환. */
function makeConfig(map: Record<string, unknown>): ConfigService {
  return { get: (k: string) => map[k] } as unknown as ConfigService;
}

describe("IssueWorkerService", () => {
  let prisma: {
    issueTask: {
      count: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
    project: { findUnique: jest.Mock };
  };
  let issues: {
    executeClaimed: jest.Mock;
    hasActiveRun: jest.Mock;
    abortRun: jest.Mock;
  };
  let scheduler: { addInterval: jest.Mock };
  let usage: { budgetStatus: jest.Mock };
  let notify: { notify: jest.Mock };

  function makeWorker(cfg: Record<string, unknown> = {}): IssueWorkerService {
    return new IssueWorkerService(
      makeConfig({
        AGENT_CONCURRENCY: 3,
        ISSUE_WORKER_POLL_MS: 5000,
        ISSUE_MAX_RETRY: 2,
        ISSUE_STALE_MS: 1800000,
        ...cfg,
      }),
      scheduler as unknown as SchedulerRegistry,
      prisma as unknown as PrismaService,
      issues as unknown as IssuesService,
      usage as unknown as UsageService,
      notify as unknown as NotifyService,
    );
  }

  beforeEach(() => {
    prisma = {
      issueTask: {
        count: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      project: {
        findUnique: jest.fn().mockResolvedValue({ claudeAccountId: null }),
      },
    };
    issues = {
      executeClaimed: jest.fn().mockResolvedValue(undefined),
      // 기본: 이 프로세스에 실행 핸들 없음(=좀비로 취급 → DB 회수).
      hasActiveRun: jest.fn().mockReturnValue(false),
      abortRun: jest.fn().mockReturnValue(true),
    };
    scheduler = { addInterval: jest.fn() };
    // 기본: 예산 미초과(가드레일이 클레임을 막지 않음).
    usage = {
      budgetStatus: jest
        .fn()
        .mockResolvedValue({ over: false, nearLimit: false }),
    };
    notify = { notify: jest.fn().mockResolvedValue(undefined) };
  });

  describe("claimAndRun (동시성 슬롯)", () => {
    it("free = concurrency - running 만큼만 클레임한다", async () => {
      const worker = makeWorker({ AGENT_CONCURRENCY: 3 });
      prisma.issueTask.count.mockResolvedValue(1); // running=1 → free=2
      // QUEUED 조회에만 후보 반환(재시도 조회는 빈 배열)
      prisma.issueTask.findMany.mockImplementation(
        (arg: any) =>
          arg?.where?.status === IssueStatus.QUEUED
            ? [
                { id: "a", sessionId: null },
                { id: "b", sessionId: null },
              ]
            : [],
      );
      prisma.issueTask.updateMany.mockResolvedValue({ count: 1 });

      await worker.tick();

      // findMany는 take: free(=2)로 조회
      const call = prisma.issueTask.findMany.mock.calls.find(
        (c) => c[0]?.where?.status === IssueStatus.QUEUED,
      );
      expect(call?.[0].take).toBe(2);
      // 2건 모두 클레임·실행
      expect(issues.executeClaimed).toHaveBeenCalledTimes(2);
    });

    it("여유 슬롯이 없으면(running>=concurrency) 클레임하지 않는다", async () => {
      const worker = makeWorker({ AGENT_CONCURRENCY: 2 });
      prisma.issueTask.count.mockResolvedValue(2); // free=0
      await worker.tick();
      expect(issues.executeClaimed).not.toHaveBeenCalled();
    });

    it("예산 초과 프로젝트의 이슈는 클레임하지 않고 알림한다", async () => {
      const worker = makeWorker({ AGENT_CONCURRENCY: 3 });
      prisma.issueTask.count.mockResolvedValue(0);
      prisma.issueTask.findMany.mockImplementation(
        (arg: any) =>
          arg?.where?.status === IssueStatus.QUEUED
            ? [{ id: "a", projectId: "p1", sessionId: null }]
            : [],
      );
      prisma.issueTask.updateMany.mockResolvedValue({ count: 1 });
      usage.budgetStatus.mockResolvedValue({
        over: true,
        nearLimit: false,
        reason: "프로젝트 예산 초과",
      });

      await worker.tick();

      expect(issues.executeClaimed).not.toHaveBeenCalled();
      // 클레임(RUNNING 전환) updateMany는 호출되지 않아야 함
      // (reclaimStale의 updateMany와 구분: data.status === RUNNING인 호출이 없어야 함)
      const claimCall = prisma.issueTask.updateMany.mock.calls.find(
        (c) => c[0]?.data?.status === IssueStatus.RUNNING,
      );
      expect(claimCall).toBeUndefined();
      expect(notify.notify).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ event: "budget.exceeded" }),
      );
    });

    it("낙관적 클레임 실패(count=0)면 실행하지 않는다", async () => {
      const worker = makeWorker({ AGENT_CONCURRENCY: 3 });
      prisma.issueTask.count.mockResolvedValue(0);
      prisma.issueTask.findMany.mockImplementation(
        (arg: any) =>
          arg?.where?.status === IssueStatus.QUEUED
            ? [{ id: "a", sessionId: null }]
            : [],
      );
      // 클레임(RUNNING 전환) updateMany는 count=0(이미 다른 tick이 집음)
      prisma.issueTask.updateMany.mockResolvedValue({ count: 0 });
      await worker.tick();
      expect(issues.executeClaimed).not.toHaveBeenCalled();
    });
  });

  describe("pause/resume (운영 제어)", () => {
    it("일시정지 중이면 클레임하지 않는다(진행 중 RUNNING은 건드리지 않음)", async () => {
      const worker = makeWorker({ AGENT_CONCURRENCY: 3 });
      worker.pause();
      expect(worker.runtime().paused).toBe(true);
      prisma.issueTask.count.mockResolvedValue(0); // free=3이지만 paused
      prisma.issueTask.findMany.mockImplementation((arg: any) =>
        arg?.where?.status === IssueStatus.QUEUED ? [{ id: "a" }] : [],
      );
      await worker.tick();
      expect(issues.executeClaimed).not.toHaveBeenCalled();
      // QUEUED 후보 조회 자체를 하지 않음(claimAndRun 조기 반환)
      const queuedQuery = prisma.issueTask.findMany.mock.calls.find(
        (c) => c[0]?.where?.status === IssueStatus.QUEUED,
      );
      expect(queuedQuery).toBeFalsy();
    });

    it("재개하면 다시 클레임한다", async () => {
      const worker = makeWorker({ AGENT_CONCURRENCY: 3 });
      worker.pause();
      worker.resume();
      expect(worker.runtime().paused).toBe(false);
      prisma.issueTask.count.mockResolvedValue(0);
      prisma.issueTask.findMany.mockImplementation((arg: any) =>
        arg?.where?.status === IssueStatus.QUEUED ? [{ id: "a" }] : [],
      );
      prisma.issueTask.updateMany.mockResolvedValue({ count: 1 });
      await worker.tick();
      expect(issues.executeClaimed).toHaveBeenCalledTimes(1);
    });
  });

  describe("reclaimStale", () => {
    // stale RUNNING 조회(where.status === RUNNING)에만 후보 반환하는 헬퍼.
    function withStaleRows(ids: string[]) {
      prisma.issueTask.findMany.mockImplementation((arg: any) =>
        arg?.where?.status === IssueStatus.RUNNING
          ? ids.map((id) => ({ id }))
          : [],
      );
    }

    it("좀비(실행 핸들 없음)는 INTERRUPTED로 DB 회수한다", async () => {
      const worker = makeWorker({ ISSUE_STALE_MS: 1000 });
      prisma.issueTask.count.mockResolvedValue(3); // free=0 → 클레임 스킵
      withStaleRows(["z1"]);
      issues.hasActiveRun.mockReturnValue(false); // 좀비
      prisma.issueTask.updateMany.mockResolvedValue({ count: 1 });

      await worker.tick();

      const reclaim = prisma.issueTask.updateMany.mock.calls.find(
        (c) => c[0]?.data?.status === IssueStatus.INTERRUPTED,
      );
      expect(reclaim).toBeTruthy();
      expect(reclaim?.[0].where.id.in).toEqual(["z1"]);
      // 좀비는 abort 대상이 아니다.
      expect(issues.abortRun).not.toHaveBeenCalled();
    });

    it("실행 중인 이슈는 abort만 하고 DB를 뒤집지 않는다(이중 실행 방지)", async () => {
      const worker = makeWorker({ ISSUE_STALE_MS: 1000 });
      prisma.issueTask.count.mockResolvedValue(3);
      withStaleRows(["live-1"]);
      issues.hasActiveRun.mockReturnValue(true); // 이 프로세스가 실행 중

      await worker.tick();

      expect(issues.abortRun).toHaveBeenCalledWith("live-1");
      // 살아있는 실행에 대해서는 INTERRUPTED 플립을 하지 않는다.
      const reclaim = prisma.issueTask.updateMany.mock.calls.find(
        (c) => c[0]?.data?.status === IssueStatus.INTERRUPTED,
      );
      expect(reclaim).toBeUndefined();
    });
  });

  describe("requeueRetryable (지수 백오프)", () => {
    it("백오프 경과 + attempts<=maxRetry면 QUEUED로 되돌린다", async () => {
      const worker = makeWorker({ ISSUE_MAX_RETRY: 2 });
      prisma.issueTask.count.mockResolvedValue(3); // 클레임 스킵
      // attempts=1 → 백오프 = 30000*2^1 = 60000ms. updatedAt을 2분 전으로.
      prisma.issueTask.findMany.mockImplementation(
        (arg: any) => {
          // 재시도 후보 조회만 대상(status in [ERROR, INTERRUPTED])
          if (Array.isArray(arg?.where?.status?.in)) {
            return [
              {
                id: "retry-1",
                attempts: 1,
                updatedAt: new Date(Date.now() - 120000),
              },
            ];
          }
          return [];
        },
      );
      prisma.issueTask.updateMany.mockResolvedValue({ count: 1 });

      await worker.tick();

      const requeue = prisma.issueTask.updateMany.mock.calls.find(
        (c) => c[0]?.data?.status === IssueStatus.QUEUED,
      );
      expect(requeue).toBeTruthy();
      expect(requeue?.[0].where.id).toBe("retry-1");
    });

    it("백오프가 아직 안 지났으면 재큐하지 않는다", async () => {
      const worker = makeWorker({ ISSUE_MAX_RETRY: 2 });
      prisma.issueTask.count.mockResolvedValue(3);
      prisma.issueTask.findMany.mockImplementation(
        (arg: any) => {
          if (Array.isArray(arg?.where?.status?.in)) {
            return [
              { id: "retry-1", attempts: 1, updatedAt: new Date() }, // 방금 실패
            ];
          }
          return [];
        },
      );
      await worker.tick();
      const requeue = prisma.issueTask.updateMany.mock.calls.find(
        (c) => c[0]?.data?.status === IssueStatus.QUEUED,
      );
      expect(requeue).toBeFalsy();
    });

    it("maxRetry=0이면 재큐하지 않는다", async () => {
      const worker = makeWorker({ ISSUE_MAX_RETRY: 0 });
      prisma.issueTask.count.mockResolvedValue(3);
      await worker.tick();
      // 재시도 후보 조회 자체를 하지 않음
      const retryQuery = prisma.issueTask.findMany.mock.calls.find((c) =>
        Array.isArray(c[0]?.where?.status?.in),
      );
      expect(retryQuery).toBeFalsy();
    });
  });

  describe("onModuleInit", () => {
    it("pollMs<=0이면 인터벌을 등록하지 않는다", () => {
      const worker = makeWorker({ ISSUE_WORKER_POLL_MS: 0 });
      worker.onModuleInit();
      expect(scheduler.addInterval).not.toHaveBeenCalled();
    });
  });
});
