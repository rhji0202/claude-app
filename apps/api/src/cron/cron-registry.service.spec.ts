import { CronStatus, CronType } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { SchedulerRegistry } from "@nestjs/schedule";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";
import { AgentService } from "../agent/agent.service";
import { RepoManagerService } from "../repo/repo-manager.service";
import { WorktreeService } from "../repo/worktree.service";
import { NotifyService } from "../notify/notify.service";
import { IssuesService } from "../issues/issues.service";
import { UsageService } from "../usage/usage.service";
import { CronRegistryService } from "./cron-registry.service";

describe("CronRegistryService.fire (실행 이력)", () => {
  let prisma: {
    cronJob: { findUnique: jest.Mock; update: jest.Mock };
    cronRun: {
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let agent: { run: jest.Mock };
  let repos: { ensureRepo: jest.Mock };
  let worktrees: { create: jest.Mock; remove: jest.Mock };
  let crypto: { decryptOptional: jest.Mock };
  let issues: { importAllOpen: jest.Mock };
  let service: CronRegistryService;

  beforeEach(() => {
    prisma = {
      cronJob: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      cronRun: {
        create: jest.fn().mockResolvedValue({ id: "run-1" }),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    agent = { run: jest.fn() };
    repos = { ensureRepo: jest.fn().mockResolvedValue("/repos/p1") };
    worktrees = {
      create: jest.fn().mockResolvedValue({ path: "/wt", branch: "issue/x" }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    crypto = { decryptOptional: jest.fn().mockReturnValue("tok") };
    issues = { importAllOpen: jest.fn().mockResolvedValue(3) };
    service = new CronRegistryService(
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {} as unknown as SchedulerRegistry,
      prisma as unknown as PrismaService,
      crypto as unknown as CryptoService,
      agent as unknown as AgentService,
      repos as unknown as RepoManagerService,
      worktrees as unknown as WorktreeService,
      { notify: jest.fn().mockResolvedValue(undefined) } as unknown as NotifyService,
      issues as unknown as IssuesService,
      {
        record: jest.fn().mockResolvedValue(undefined),
        budgetStatus: jest
          .fn()
          .mockResolvedValue({ over: false, nearLimit: false }),
      } as unknown as UsageService,
    );
  });

  it("잡이 없으면 아무 것도 하지 않는다", async () => {
    prisma.cronJob.findUnique.mockResolvedValue(null);
    await service.fire("nope");
    expect(prisma.cronRun.create).not.toHaveBeenCalled();
  });

  it("gitRepo 없으면 실행 이력을 ERROR로 마감하고 에이전트를 부르지 않는다", async () => {
    prisma.cronJob.findUnique.mockResolvedValue({
      id: "c1",
      name: "j",
      projectId: "p1",
      prompt: "p",
      project: { ownerId: "u1", gitRepo: null, gitTokenEnc: null },
    });
    await service.fire("c1");
    expect(agent.run).not.toHaveBeenCalled();
    // 진행 중 run 생성 후 ERROR로 마감
    expect(prisma.cronRun.create).toHaveBeenCalled();
    const upd = prisma.cronRun.update.mock.calls[0][0];
    expect(upd.where.id).toBe("run-1");
    expect(upd.data.status).toBe(CronStatus.ERROR);
    // 요약도 ERROR
    const jobUpd = prisma.cronJob.update.mock.calls[0][0];
    expect(jobUpd.data.lastStatus).toBe(CronStatus.ERROR);
  });

  it("성공 실행: clone→worktree→run 후 이력을 OK로 마감하고 worktree를 정리한다", async () => {
    prisma.cronJob.findUnique.mockResolvedValue({
      id: "c1",
      name: "j",
      projectId: "p1",
      prompt: "테스트 실행",
      project: { ownerId: "u1", gitRepo: "o/r", gitTokenEnc: "enc" },
    });
    agent.run.mockResolvedValue({ status: "ok", text: "완료", sessionId: "s1" });

    await service.fire("c1");

    expect(repos.ensureRepo).toHaveBeenCalledWith("p1", "o/r", "tok");
    expect(worktrees.create).toHaveBeenCalledWith("p1", "cron-c1");
    expect(agent.run.mock.calls[0][1]).toMatchObject({ cwd: "/wt" });
    expect(worktrees.remove).toHaveBeenCalledWith("p1", "cron-c1");

    const upd = prisma.cronRun.update.mock.calls[0][0];
    expect(upd.data.status).toBe(CronStatus.OK);
    expect(upd.data.result).toBe("완료");
    expect(upd.data.sessionId).toBe("s1");
    expect(typeof upd.data.durationMs).toBe("number");
  });

  it("이력 상한 초과분(50건 초과)을 정리한다", async () => {
    prisma.cronJob.findUnique.mockResolvedValue({
      id: "c1",
      name: "j",
      projectId: "p1",
      prompt: "p",
      project: { ownerId: "u1", gitRepo: "o/r", gitTokenEnc: "enc" },
    });
    agent.run.mockResolvedValue({ status: "ok", text: "ok" });
    // skip:50 이후로 2건 남아있다고 가정
    prisma.cronRun.findMany.mockResolvedValue([{ id: "old-1" }, { id: "old-2" }]);

    await service.fire("c1");

    // skip: MAX_RUNS(50)로 조회
    expect(prisma.cronRun.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 50, where: { cronJobId: "c1" } }),
    );
    expect(prisma.cronRun.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["old-1", "old-2"] } },
    });
  });

  it("IMPORT 유형: 에이전트 대신 importAllOpen을 호출하고 OK로 마감", async () => {
    prisma.cronJob.findUnique.mockResolvedValue({
      id: "c1",
      name: "sync",
      projectId: "p1",
      type: CronType.IMPORT,
      prompt: null,
      project: { ownerId: "u1", gitRepo: "o/r", gitTokenEnc: "enc" },
    });

    await service.fire("c1");

    expect(issues.importAllOpen).toHaveBeenCalledWith("p1");
    expect(agent.run).not.toHaveBeenCalled(); // 에이전트 실행 안 함
    expect(worktrees.create).not.toHaveBeenCalled(); // worktree도 안 만듦
    const upd = prisma.cronRun.update.mock.calls[0][0];
    expect(upd.data.status).toBe(CronStatus.OK);
    expect(upd.data.result).toContain("신규 3건");
  });
});
