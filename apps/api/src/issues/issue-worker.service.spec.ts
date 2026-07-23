import { IssueStatus } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { IssuesService } from "./issues.service";
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
  };
  let issues: { executeClaimed: jest.Mock };
  let scheduler: { addInterval: jest.Mock };

  function makeWorker(cfg: Record<string, unknown> = {}): IssueWorkerService {
    return new IssueWorkerService(
      makeConfig({
        AGENT_CONCURRENCY: 3,
        ISSUE_WORKER_POLL_MS: 5000,
        ISSUE_MAX_RETRY: 2,
        ISSUE_STALE_MS: 600000,
        ...cfg,
      }),
      scheduler as unknown as SchedulerRegistry,
      prisma as unknown as PrismaService,
      issues as unknown as IssuesService,
    );
  }

  beforeEach(() => {
    prisma = {
      issueTask: {
        count: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    issues = { executeClaimed: jest.fn().mockResolvedValue(undefined) };
    scheduler = { addInterval: jest.fn() };
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
    it("staleMs 지난 RUNNING을 INTERRUPTED로 회수한다", async () => {
      const worker = makeWorker({ ISSUE_STALE_MS: 1000 });
      prisma.issueTask.count.mockResolvedValue(3); // free=0 → 클레임 스킵, 회수만 검증
      await worker.tick();
      const staleCall = prisma.issueTask.updateMany.mock.calls.find(
        (c) =>
          c[0]?.where?.status === IssueStatus.RUNNING &&
          c[0]?.where?.claimedAt?.lt instanceof Date,
      );
      expect(staleCall).toBeTruthy();
      expect(staleCall?.[0].data.status).toBe(IssueStatus.INTERRUPTED);
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
