import { IssueStatus } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { IssuesService } from "./issues.service";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";
import { AgentService } from "../agent/agent.service";
import { GithubService } from "../github/github.service";
import { ProjectsService } from "../projects/projects.service";
import { UploadsService } from "../uploads/uploads.service";
import { RepoManagerService } from "../repo/repo-manager.service";
import { WorktreeService } from "../repo/worktree.service";
import { NotifyService } from "../notify/notify.service";

/** ConfigService 스텁: 주어진 map에서 값 반환. */
function makeConfig(map: Record<string, unknown> = {}): ConfigService {
  const base = { AGENT_CONCURRENCY: 3, ISSUE_MAX_RETRY: 2, ...map };
  return { get: (k: string) => base[k as keyof typeof base] } as unknown as ConfigService;
}

describe("IssuesService (큐/워커)", () => {
  let prisma: {
    issueTask: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
    issueNote: { findMany: jest.Mock; create: jest.Mock };
    project: { findUnique: jest.Mock };
  };
  let projects: {
    assertCanEdit: jest.Mock;
    assertAccess?: jest.Mock;
    accessibleProjectIds?: jest.Mock;
    list?: jest.Mock;
  };
  let repos: { ensureRepo: jest.Mock };
  let worktrees: { create: jest.Mock; remove: jest.Mock; pruneOrphans: jest.Mock };
  let agent: { run: jest.Mock; runStream: jest.Mock };
  let crypto: { decryptOptional: jest.Mock };
  let github: { setLabels: jest.Mock; createComment: jest.Mock };
  let notify: { notify: jest.Mock };
  let service: IssuesService;

  /**
   * executeClaimed는 runViaStream(→agent.runStream)으로 실행한다.
   * 원하는 결과({status,text,sessionId})를 이벤트 시퀀스로 방출하도록 runStream을 구성.
   */
  /** finishRun의 상태 기록 update 인자(진행상황 write와 구분해 status가 있는 호출). */
  function statusUpdate(): { status?: unknown; [k: string]: unknown } {
    const call = [...prisma.issueTask.update.mock.calls]
      .reverse()
      .find((c) => c[0]?.data?.status !== undefined);
    return call?.[0]?.data ?? {};
  }

  function mockAgentResult(r: {
    status: "ok" | "error";
    text?: string;
    sessionId?: string;
    error?: string;
  }): void {
    agent.runStream.mockImplementation(
      async (
        _pid: string,
        _opts: unknown,
        onEvent: (e: {
          type: string;
          sessionId?: string;
          id?: string;
          text?: string;
          error?: string;
          name?: string;
        }) => void,
      ) => {
        if (r.sessionId) onEvent({ type: "session", sessionId: r.sessionId });
        if (r.status === "ok") {
          if (r.text) onEvent({ type: "text_end", id: "1:0", text: r.text });
          onEvent({ type: "done", text: r.text ?? "", sessionId: r.sessionId });
        } else {
          onEvent({ type: "error", error: r.error ?? "실패", sessionId: r.sessionId });
        }
      },
    );
  }

  function makeService(cfg: Record<string, unknown> = {}): IssuesService {
    return new IssuesService(
      prisma as unknown as PrismaService,
      crypto as unknown as CryptoService,
      agent as unknown as AgentService,
      github as unknown as GithubService,
      projects as unknown as ProjectsService,
      {} as unknown as UploadsService,
      repos as unknown as RepoManagerService,
      worktrees as unknown as WorktreeService,
      makeConfig(cfg),
      notify as unknown as NotifyService,
    );
  }

  beforeEach(() => {
    prisma = {
      issueTask: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      issueNote: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({}),
      },
      project: { findUnique: jest.fn() },
    };
    projects = {
      assertCanEdit: jest.fn().mockResolvedValue(undefined),
      accessibleProjectIds: jest.fn().mockResolvedValue(["p1"]),
    };
    repos = { ensureRepo: jest.fn().mockResolvedValue("/repos/p1") };
    worktrees = {
      create: jest.fn().mockResolvedValue({ path: "/wt/p1/i1", branch: "issue/i1" }),
      remove: jest.fn().mockResolvedValue(undefined),
      pruneOrphans: jest.fn().mockResolvedValue(undefined),
    };
    agent = { run: jest.fn(), runStream: jest.fn() };
    crypto = { decryptOptional: jest.fn().mockReturnValue("tok") };
    github = {
      setLabels: jest.fn().mockResolvedValue(["triage:auto-fix"]),
      createComment: jest.fn().mockResolvedValue({ html_url: "u" }),
    };
    notify = { notify: jest.fn().mockResolvedValue(undefined) };
    service = makeService();
  });

  describe("batchRun (일괄 큐잉)", () => {
    it("편집 권한 있는 이슈만 QUEUED로 만들고 attempts를 0으로 초기화한다", async () => {
      prisma.issueTask.findMany.mockResolvedValue([
        { id: "i1", projectId: "p1" },
        { id: "i2", projectId: "p2" },
      ]);
      // p2는 권한 없음
      projects.assertCanEdit.mockImplementation((pid: string) => {
        if (pid === "p2") return Promise.reject(new Error("forbidden"));
        return Promise.resolve(undefined);
      });
      // batchRun 마지막 list() 호출 대비
      (service as unknown as { list: jest.Mock }).list = jest
        .fn()
        .mockResolvedValue([{ id: "i1" }, { id: "i2" }]);

      const res = await service.batchRun(["i1", "i2"], "u1");

      // enqueue는 허용된 id만
      const enq = prisma.issueTask.updateMany.mock.calls[0][0];
      expect(enq.where.id.in).toEqual(["i1"]);
      expect(enq.data).toMatchObject({
        status: IssueStatus.QUEUED,
        attempts: 0,
        error: null,
      });
      // 반환은 허용된 이슈만
      expect(res.map((r) => r.id)).toEqual(["i1"]);
    });
  });

  describe("executeClaimed", () => {
    const task = {
      id: "i1",
      projectId: "p1",
      images: [],
      sessionId: null,
      repo: "o/r",
      title: "t",
      labels: [],
    } as never;

    it("gitRepo 없으면 ERROR로 종료하고 실행하지 않는다", async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitRepo: null,
        ownerId: "u1",
      });
      await service.executeClaimed(task);
      expect(agent.runStream).not.toHaveBeenCalled();
      const upd = statusUpdate();
      expect(upd.status).toBe(IssueStatus.ERROR);
    });

    it("clone→worktree→run 후 worktree를 정리하고 DONE으로 기록한다", async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitRepo: "o/r",
        gitBranch: "main",
        gitTokenEnc: "enc",
        ownerId: "u1",
      });
      mockAgentResult({ status: "ok", sessionId: "s1", text: "done" });
      // buildPrompt가 github 호출 없이 진행되도록 issueNumber 없음(task)
      await service.executeClaimed(task);

      expect(repos.ensureRepo).toHaveBeenCalledWith("p1", "o/r", "tok");
      expect(worktrees.create).toHaveBeenCalledWith("p1", "i1", "main");
      // 에이전트는 worktree 경로를 cwd로 받음
      expect(agent.runStream.mock.calls[0][1]).toMatchObject({ cwd: "/wt/p1/i1" });
      // 정리는 반드시 호출
      expect(worktrees.remove).toHaveBeenCalledWith("p1", "i1");
      const upd = statusUpdate();
      expect(upd.status).toBe(IssueStatus.DONE);
      // 완료 알림 전송
      expect(notify.notify).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({ event: "issue.done" }),
      );
    });

    it("worktree 생성 실패해도 ERROR로 흡수하고 throw하지 않는다", async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitRepo: "o/r",
        gitTokenEnc: "enc",
        ownerId: "u1",
      });
      worktrees.create.mockRejectedValue(new Error("worktree fail"));
      await expect(service.executeClaimed(task)).resolves.toBeUndefined();
      expect(agent.runStream).not.toHaveBeenCalled();
      const upd = statusUpdate();
      expect(upd.status).toBe(IssueStatus.ERROR);
    });

    it("autoPr이면 PR 지시를 프롬프트에 넣고 결과의 PR_URL을 파싱해 저장한다", async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitRepo: "o/r",
        gitBranch: "main",
        gitTokenEnc: "enc",
        ownerId: "u1",
        autoPr: true,
        autoMerge: false,
      });
      mockAgentResult({
        status: "ok",
        sessionId: "s1",
        text: "수정 완료.\nPR_URL: https://github.com/o/r/pull/42",
      });
      await service.executeClaimed(task);

      // 프롬프트에 PR 생성 지시 + base 브랜치 포함
      const opts = agent.runStream.mock.calls[0][1];
      expect(opts.prompt).toContain("gh pr create");
      expect(opts.prompt).toContain("--base main");
      // 결과에서 PR URL 파싱 → prUrl 저장 + DONE
      const upd = statusUpdate();
      expect(upd.status).toBe(IssueStatus.DONE);
      expect(upd.prUrl).toBe("https://github.com/o/r/pull/42");
    });

    it("autoPr인데 PR_URL이 none이면 prUrl은 null로 저장한다", async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitRepo: "o/r",
        gitBranch: "main",
        gitTokenEnc: "enc",
        ownerId: "u1",
        autoPr: true,
        autoMerge: false,
      });
      mockAgentResult({
        status: "ok",
        sessionId: "s1",
        text: "변경할 것이 없습니다.\nPR_URL: none",
      });
      await service.executeClaimed(task);
      const upd = statusUpdate();
      expect(upd.prUrl).toBeNull();
    });

    it("autoTriage면 분류를 파싱해 category 저장 + triage 라벨을 적용한다", async () => {
      const ghTask = {
        id: "i1",
        projectId: "p1",
        images: [],
        sessionId: null,
        repo: "o/r",
        issueNumber: 7,
        title: "t",
        labels: ["bug"],
      } as never;
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitRepo: "o/r",
        gitBranch: "main",
        gitTokenEnc: "enc",
        ownerId: "u1",
        autoTriage: true,
      });
      mockAgentResult({
        status: "ok",
        sessionId: "s1",
        text: "분석 결과…\nTRIAGE: auto-fix",
      });
      await service.executeClaimed(ghTask);

      // 프롬프트에 triage 분류 지시 포함
      expect(agent.runStream.mock.calls[0][1].prompt).toContain("TRIAGE:");
      // category 저장
      const upd = statusUpdate();
      expect(upd.category).toBe("auto-fix");
      // 기존 라벨 유지 + triage:auto-fix 추가로 setLabels 호출
      expect(github.setLabels).toHaveBeenCalledWith(
        "o/r",
        7,
        ["bug", "triage:auto-fix"],
        "tok",
      );
    });

    it("autoTriage인데 TRIAGE 규약이 없으면 category는 null, 라벨 미적용", async () => {
      const ghTask = {
        id: "i1",
        projectId: "p1",
        images: [],
        sessionId: null,
        repo: "o/r",
        issueNumber: 7,
        title: "t",
        labels: [],
      } as never;
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitRepo: "o/r",
        gitBranch: "main",
        gitTokenEnc: "enc",
        ownerId: "u1",
        autoTriage: true,
      });
      mockAgentResult({ status: "ok", sessionId: "s1", text: "요약만" });
      await service.executeClaimed(ghTask);
      const upd = statusUpdate();
      expect(upd.category).toBeNull();
      expect(github.setLabels).not.toHaveBeenCalled();
    });

    it("DECISION_NEEDED가 있으면 NEEDS_DECISION 전이 + AGENT 메모 저장", async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitRepo: "o/r",
        gitBranch: "main",
        gitTokenEnc: "enc",
        ownerId: "u1",
      });
      mockAgentResult({
        status: "ok",
        sessionId: "s1",
        text: "분석함.\nDECISION_NEEDED: A안과 B안 중 무엇으로 진행할까요?",
      });
      await service.executeClaimed(task);

      const upd = statusUpdate();
      expect(upd.status).toBe(IssueStatus.NEEDS_DECISION);
      // 질문이 AGENT 메모로 저장됨
      expect(prisma.issueNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            author: "AGENT",
            content: "A안과 B안 중 무엇으로 진행할까요?",
          }),
        }),
      );
    });
  });

  describe("resume (결정 대기 재개)", () => {
    it("NEEDS_DECISION 이슈를 QUEUED로 되돌린다", async () => {
      prisma.issueTask.findUnique.mockResolvedValue({
        id: "i1",
        projectId: "p1",
        status: IssueStatus.NEEDS_DECISION,
      });
      (service as unknown as { get: jest.Mock }).get = jest
        .fn()
        .mockResolvedValue({ id: "i1", status: "queued" });
      await service.resume("i1", "u1");
      const call = prisma.issueTask.update.mock.calls.find(
        (c) => c[0]?.data?.status === IssueStatus.QUEUED,
      );
      expect(call).toBeTruthy();
    });

    it("NEEDS_DECISION이 아니면 거부한다", async () => {
      prisma.issueTask.findUnique.mockResolvedValue({
        id: "i1",
        projectId: "p1",
        status: IssueStatus.DONE,
      });
      await expect(service.resume("i1", "u1")).rejects.toThrow();
    });
  });

  describe("stats (대시보드 요약)", () => {
    it("상태별 카운트·슬롯·재시도·워커 상태를 집계한다", async () => {
      prisma.issueTask.groupBy.mockResolvedValue([
        { status: IssueStatus.QUEUED, _count: { _all: 4 } },
        { status: IssueStatus.RUNNING, _count: { _all: 2 } },
        { status: IssueStatus.ERROR, _count: { _all: 1 } },
      ]);
      prisma.issueTask.count.mockResolvedValue(3); // 재시도 대기 카운트
      prisma.issueTask.findFirst.mockResolvedValue({
        createdAt: new Date("2026-07-23T00:00:00.000Z"),
      });

      const res = await service.stats("u1", { workerId: "w1", paused: false });

      // 슬롯: concurrency=3, running=2 → free=1
      expect(res.slots).toEqual({ concurrency: 3, running: 2, free: 1 });
      // 미등장 상태는 0으로 채움
      expect(res.counts).toEqual({
        queued: 4,
        running: 2,
        done: 0,
        error: 1,
        interrupted: 0,
        needs_decision: 0,
      });
      expect(res.retrying).toBe(3);
      expect(res.oldestQueuedAt).toBe("2026-07-23T00:00:00.000Z");
      expect(res.worker).toEqual({ workerId: "w1", paused: false });
    });

    it("접근 가능한 프로젝트로만 집계 범위를 제한한다", async () => {
      (projects.accessibleProjectIds as jest.Mock).mockResolvedValue(["p1", "p2"]);
      await service.stats("u1", { workerId: "w1", paused: true });
      const where = prisma.issueTask.groupBy.mock.calls[0][0].where;
      expect(where).toEqual({ projectId: { in: ["p1", "p2"] } });
    });

    it("maxRetry=0이면 재시도 대기 카운트를 조회하지 않고 0을 반환한다", async () => {
      const svc = makeService({ ISSUE_MAX_RETRY: 0 });
      const res = await svc.stats("u1", { workerId: "w1", paused: false });
      expect(res.retrying).toBe(0);
      expect(prisma.issueTask.count).not.toHaveBeenCalled();
    });
  });

  describe("requeue (개별 재큐)", () => {
    it("QUEUED로 되돌리고 오류·클레임을 초기화한다", async () => {
      prisma.issueTask.findUnique.mockResolvedValue({ id: "i1", projectId: "p1" });
      (projects.assertAccess = jest.fn().mockResolvedValue(undefined));
      prisma.issueTask.findUnique
        .mockResolvedValueOnce({ id: "i1", projectId: "p1" }) // getRaw
        .mockResolvedValueOnce({
          id: "i1",
          projectId: "p1",
          status: IssueStatus.QUEUED,
          labels: [],
          images: [],
          source: "MANUAL",
          repo: "o/r",
          title: "t",
          createdAt: new Date(),
          updatedAt: new Date(),
        }); // get() 내부 getRaw

      await service.requeue("i1", "u1");

      const upd = prisma.issueTask.update.mock.calls[0][0];
      expect(upd.where.id).toBe("i1");
      expect(upd.data).toMatchObject({
        status: IssueStatus.QUEUED,
        error: null,
        claimedAt: null,
        lockedBy: null,
      });
    });
  });
});
