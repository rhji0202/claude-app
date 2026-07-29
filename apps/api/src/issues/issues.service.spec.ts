import { IssueStatus } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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
import { UsageService } from "../usage/usage.service";
import { IssueEventsService } from "./issue-events.service";

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
      create: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
    issueNote: { findMany: jest.Mock; create: jest.Mock };
    project: { findUnique: jest.Mock };
    usageRecord: { aggregate: jest.Mock };
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
  let github: {
    setLabels: jest.Mock;
    createComment: jest.Mock;
    getIssue: jest.Mock;
    listComments: jest.Mock;
  };
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
      // signRelPath는 toDto가 images를 서명 URL로 변환할 때 호출 → 통과 스텁 제공.
      // readAsBase64는 실행 시 images[]를 첨부로 싣는 경로에서 호출.
      {
        signRelPath: (rel: string) => rel,
        readAsBase64: (rel: string) =>
          Promise.resolve({ data: `b64:${rel}`, mediaType: "image/png" }),
        readFile: (rel: string) => Promise.resolve(Buffer.from(`bin:${rel}`)),
      } as unknown as UploadsService,
      repos as unknown as RepoManagerService,
      worktrees as unknown as WorktreeService,
      makeConfig(cfg),
      notify as unknown as NotifyService,
      { record: jest.fn().mockResolvedValue(undefined) } as unknown as UsageService,
      { publish: jest.fn() } as unknown as IssueEventsService,
    );
  }

  beforeEach(() => {
    prisma = {
      issueTask: {
        findMany: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn(),
        create: jest.fn(),
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
      usageRecord: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }),
      },
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
      getIssue: jest.fn().mockResolvedValue({ body: "본문", title: "t" }),
      listComments: jest.fn().mockResolvedValue([]),
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
      files: [],
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

    it("완료 알림 detail은 결과 전문이 아니라 SUMMARY를 쓴다", async () => {
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
        text:
          "장문의 조사·수정 서술...\n<<<RESULT\nSUMMARY: 결제대기 전환 게이트를 제거해 부분 결제건도 확인되도록 고쳤습니다.\nDECISION_NEEDED: none\n>>>",
      });
      await service.executeClaimed(task);

      expect(notify.notify).toHaveBeenCalledWith(
        "p1",
        expect.objectContaining({
          event: "issue.done",
          detail:
            "결제대기 전환 게이트를 제거해 부분 결제건도 확인되도록 고쳤습니다.",
        }),
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

    it("재실행 지시에 첨부한 이미지를 첨부로 싣고 메모의 이미지 마크다운은 표기로 줄인다", async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitRepo: "o/r",
        gitBranch: "main",
        gitTokenEnc: "enc",
        ownerId: "u1",
      });
      // 지시 저장 시 업로드된 이미지가 images[]에 쌓인 상태.
      const withImage = { ...(task as object), images: ["issue-images/i1/a.png"] } as never;
      prisma.issueNote.findMany.mockResolvedValue([
        {
          issueId: "i1",
          author: "HUMAN",
          content: "이 화면처럼 고쳐줘\n![screen.png](http://h/uploads/issue-images/i1/a.png?exp=1&sig=ab)",
          createdAt: new Date(0),
        },
      ]);
      mockAgentResult({ status: "ok", sessionId: "s1", text: "done" });
      await service.executeClaimed(withImage);

      const opts = agent.runStream.mock.calls[0][1];
      // 이미지는 실제 첨부로 전달된다.
      expect(opts.images).toEqual([
        { data: "b64:issue-images/i1/a.png", mediaType: "image/png" },
      ]);
      // 지시 본문은 유지하되 서명 URL은 프롬프트에 싣지 않는다.
      expect(opts.prompt).toContain("이 화면처럼 고쳐줘");
      expect(opts.prompt).toContain("(첨부 이미지: screen.png)");
      expect(opts.prompt).not.toContain("sig=ab");
    });

    it("첨부 파일을 worktree로 복사하고 프롬프트에 경로를 알려준다", async () => {
      // 실제 파일을 쓰므로 임시 디렉터리를 worktree 경로로 준다.
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "issue-att-"));
      worktrees.create.mockResolvedValue({ path: tmp, branch: "issue/i1" });
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitRepo: "o/r",
        gitBranch: "main",
        gitTokenEnc: "enc",
        ownerId: "u1",
      });
      const withFile = {
        ...(task as object),
        files: ["issue-images/i1/uuid.xlsx|매출.xlsx"],
      } as never;
      mockAgentResult({ status: "ok", sessionId: "s1", text: "done" });
      await service.executeClaimed(withFile);

      // 파일이 실제로 복사됐다(원본 파일명 유지).
      const copied = await fs.readFile(
        path.join(tmp, "첨부파일", "매출.xlsx"),
        "utf8",
      );
      expect(copied).toBe("bin:issue-images/i1/uuid.xlsx");
      // 커밋 오염 방지용 .gitignore도 함께 놓는다.
      expect(await fs.readFile(path.join(tmp, "첨부파일", ".gitignore"), "utf8")).toBe(
        "*\n",
      );
      // 프롬프트가 경로를 알려준다.
      const opts = agent.runStream.mock.calls[0][1];
      expect(opts.prompt).toContain("첨부파일/매출.xlsx");

      await fs.rm(tmp, { recursive: true, force: true });
    });

    it("첨부 파일명이 겹치면 순번을 붙여 덮어쓰지 않는다", async () => {
      const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "issue-dup-"));
      worktrees.create.mockResolvedValue({ path: tmp, branch: "issue/i1" });
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitRepo: "o/r",
        gitBranch: "main",
        gitTokenEnc: "enc",
        ownerId: "u1",
      });
      const dup = {
        ...(task as object),
        files: ["issue-images/i1/a.pdf|보고서.pdf", "issue-images/i1/b.pdf|보고서.pdf"],
      } as never;
      mockAgentResult({ status: "ok", sessionId: "s1", text: "done" });
      await service.executeClaimed(dup);

      // 두 파일이 각각 남는다(뒤엣것은 순번 접두).
      expect(await fs.readFile(path.join(tmp, "첨부파일", "보고서.pdf"), "utf8")).toBe(
        "bin:issue-images/i1/a.pdf",
      );
      expect(
        await fs.readFile(path.join(tmp, "첨부파일", "2_보고서.pdf"), "utf8"),
      ).toBe("bin:issue-images/i1/b.pdf");

      await fs.rm(tmp, { recursive: true, force: true });
    });

    it("ISSUE_COMMENT가 있으면 그 문구로 이슈 코멘트를 게시한다", async () => {
      const ghTask = {
        id: "i1",
        projectId: "p1",
        images: [],
        files: [],
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
        autoPr: true,
        autoMerge: false,
      });
      mockAgentResult({
        status: "ok",
        sessionId: "s1",
        text:
          "완료.\n<<<RESULT\nPR_URL: https://github.com/o/r/pull/42\nISSUE_COMMENT: 로그인 리다이렉트 버그를 고쳐서 PR 올렸어요: https://github.com/o/r/pull/42\nDECISION_NEEDED: none\n>>>",
      });
      await service.executeClaimed(ghTask);

      // 에이전트가 쓴 사람 말투 문구로 게시(기본 봇 문구/이모지 아님)
      const [, , body] = github.createComment.mock.calls[0];
      expect(body).toBe(
        "로그인 리다이렉트 버그를 고쳐서 PR 올렸어요: https://github.com/o/r/pull/42",
      );
      expect(body).not.toContain("🤖");
    });

    it("ISSUE_COMMENT가 없으면 기본 문구로 폴백해 게시한다", async () => {
      const ghTask = {
        id: "i1",
        projectId: "p1",
        images: [],
        files: [],
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
        autoPr: true,
        autoMerge: false,
      });
      mockAgentResult({
        status: "ok",
        sessionId: "s1",
        text:
          "완료.\n<<<RESULT\nPR_URL: https://github.com/o/r/pull/42\nISSUE_COMMENT: none\nDECISION_NEEDED: none\n>>>",
      });
      await service.executeClaimed(ghTask);

      const [, , body] = github.createComment.mock.calls[0];
      expect(body).toContain("https://github.com/o/r/pull/42");
      expect(body).not.toContain("🤖");
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
        files: [],
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
        files: [],
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

    it("코멘트가 10개를 초과하면 생략 안내를 프롬프트에 넣는다", async () => {
      const ghTask = {
        id: "i1",
        projectId: "p1",
        images: [],
        files: [],
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
      });
      github.listComments.mockResolvedValue(
        Array.from({ length: 13 }, (_, i) => ({ author: "u", body: `c${i}` })),
      );
      mockAgentResult({ status: "ok", sessionId: "s1", text: "완료" });
      await service.executeClaimed(ghTask);

      const prompt = agent.runStream.mock.calls[0][1].prompt;
      expect(prompt).toContain("코멘트 (13개)");
      expect(prompt).toContain("코멘트 3개 생략");
    });

    it("DECISION_NEEDED 플레이스홀더를 그대로 에코해도 결정 대기로 가지 않는다", async () => {
      const ghTask = {
        id: "i1",
        projectId: "p1",
        images: [],
        files: [],
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
        autoPr: true,
        autoMerge: false,
        autoTriage: true,
      });
      // 모델이 템플릿 플레이스홀더를 채우지 않고 그대로 출력한 경우
      mockAgentResult({
        status: "ok",
        sessionId: "s1",
        text:
          "수정 완료.\n<<<RESULT\nTRIAGE: auto-fix\nPR_URL: https://github.com/o/r/pull/42\nDECISION_NEEDED: <사람에게 묻는 구체적 질문 또는 none>\n>>>",
      });
      await service.executeClaimed(ghTask);

      const upd = statusUpdate();
      // 플레이스홀더는 무시되어야 하며, 성공 결과(PR/triage)가 보존되어야 한다
      expect(upd.status).toBe(IssueStatus.DONE);
      expect(upd.prUrl).toBe("https://github.com/o/r/pull/42");
      expect(upd.category).toBe("auto-fix");
    });

    it("DECISION_NEEDED 값이 'none.'이면 결정 대기로 가지 않는다", async () => {
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
        text: "완료.\n<<<RESULT\nDECISION_NEEDED: none.\n>>>",
      });
      await service.executeClaimed(task);
      expect(statusUpdate().status).toBe(IssueStatus.DONE);
    });

    it("이슈 본문의 백틱 펜스가 구획을 깨지 않도록 더 긴 펜스로 감싼다", async () => {
      const ghTask = {
        id: "i1",
        projectId: "p1",
        images: [],
        files: [],
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
      });
      // 본문에 코드펜스가 포함된 경우(버그 리포트에 흔함)
      github.getIssue.mockResolvedValue({
        body: "재현:\n```\ncode\n```\n끝",
        title: "t",
      });
      mockAgentResult({ status: "ok", sessionId: "s1", text: "완료" });
      await service.executeClaimed(ghTask);

      const prompt = agent.runStream.mock.calls[0][1].prompt as string;
      // 본문 속 ``` 보다 긴 ```` 펜스로 감싸져야 한다
      expect(prompt).toContain("````");
    });

    it("RESULT 블록으로 PR_URL·TRIAGE를 함께 파싱한다", async () => {
      const ghTask = {
        id: "i1",
        projectId: "p1",
        images: [],
        files: [],
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
        autoPr: true,
        autoMerge: false,
        autoTriage: true,
      });
      mockAgentResult({
        status: "ok",
        sessionId: "s1",
        text:
          "수정 완료.\n\n<<<RESULT\nTRIAGE: auto-fix\nPR_URL: https://github.com/o/r/pull/42\nDECISION_NEEDED: none\n>>>",
      });
      await service.executeClaimed(ghTask);

      const upd = statusUpdate();
      expect(upd.status).toBe(IssueStatus.DONE);
      expect(upd.category).toBe("auto-fix");
      expect(upd.prUrl).toBe("https://github.com/o/r/pull/42");
    });

    it("RESULT 블록의 DECISION_NEEDED가 채워지면 NEEDS_DECISION 전이", async () => {
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
        text:
          "분석함.\n<<<RESULT\nDECISION_NEEDED: A안과 B안 중 무엇으로 진행할까요?\n>>>",
      });
      await service.executeClaimed(task);

      const upd = statusUpdate();
      expect(upd.status).toBe(IssueStatus.NEEDS_DECISION);
      expect(prisma.issueNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            author: "AGENT",
            content: "A안과 B안 중 무엇으로 진행할까요?",
          }),
        }),
      );
    });

    it("DECISION_NEEDED 질문 뒤 여러 줄 선택지(A/B/C)를 잘리지 않고 메모로 저장한다", async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitRepo: "o/r",
        gitBranch: "main",
        gitTokenEnc: "enc",
        ownerId: "u1",
      });
      const question =
        "이슈는 세 가지 요청을 담고 있으며, 코드 조사 결과 대응 방향이 나뉩니다.\n" +
        "A) 전체를 한 번에 처리 — 범위 넓음\n" +
        "B) 우선순위 높은 것만 처리 — 안전\n" +
        "C) 사람이 순서를 지정";
      mockAgentResult({
        status: "ok",
        sessionId: "s1",
        text: `분석함.\n<<<RESULT\nDECISION_NEEDED: ${question}\n>>>`,
      });
      await service.executeClaimed(task);

      const upd = statusUpdate();
      expect(upd.status).toBe(IssueStatus.NEEDS_DECISION);
      expect(prisma.issueNote.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            author: "AGENT",
            content: question,
          }),
        }),
      );
    });

    it("RESULT 블록의 DECISION_NEEDED가 none이면 결정 대기로 가지 않는다", async () => {
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
        text: "완료.\n<<<RESULT\nDECISION_NEEDED: none\n>>>",
      });
      await service.executeClaimed(task);
      const upd = statusUpdate();
      expect(upd.status).toBe(IssueStatus.DONE);
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

  describe("toDto (본문 이미지 매핑)", () => {
    /** get()을 통해 toDto 결과를 얻는다(private 메서드 직접 호출 회피). */
    async function dtoOf(imageMap: unknown) {
      prisma.issueTask.findUnique.mockResolvedValue({
        id: "i1",
        projectId: "p1",
        repo: "o/r",
        issueNumber: 1,
        title: "t",
        body: "![x](https://github.com/user-attachments/assets/abc)",
        url: null,
        labels: [],
        author: null,
        source: "GITHUB",
        prompt: null,
        images: ["issue-images/i1/a.png"],
        imageMap,
        status: IssueStatus.QUEUED,
        sessionId: null,
        result: null,
        error: null,
        resultCommentUrl: null,
        prUrl: null,
        category: null,
        progress: null,
        progressLog: null,
        costUsd: null,
        inputTokens: null,
        outputTokens: null,
        createdAt: new Date("2026-07-25T00:00:00.000Z"),
        updatedAt: new Date("2026-07-25T00:00:00.000Z"),
      });
      projects.assertAccess = jest.fn().mockResolvedValue(undefined);
      return service.get("i1", "u1");
    }

    it("원본 URL → 서명 경로 매핑을 그대로 내려보낸다", async () => {
      const dto = await dtoOf({
        "https://github.com/user-attachments/assets/abc": "issue-images/i1/a.png",
      });
      expect(dto.imageMap).toEqual({
        "https://github.com/user-attachments/assets/abc": "issue-images/i1/a.png",
      });
    });

    it("imageMap이 없으면(수동 등록·기존 행) null", async () => {
      expect((await dtoOf(null)).imageMap).toBeNull();
    });

    // Json 컬럼이라 배열·문자열 등 예상 밖 형태가 들어올 수 있다 → 방어.
    it("객체가 아닌 값은 null로 처리한다", async () => {
      expect((await dtoOf(["a", "b"])).imageMap).toBeNull();
      expect((await dtoOf("nope")).imageMap).toBeNull();
    });

    it("문자열이 아닌 값·빈 문자열은 걸러낸다", async () => {
      const dto = await dtoOf({ a: "issue-images/i1/a.png", b: 1, c: "" });
      expect(dto.imageMap).toEqual({ a: "issue-images/i1/a.png" });
    });
  });

  describe("list (목록 필터)", () => {
    /** list()가 prisma에 넘긴 where 절. */
    function listWhere(): Record<string, unknown> {
      return prisma.issueTask.findMany.mock.calls[0][0].where;
    }

    beforeEach(() => {
      prisma.issueTask.findMany.mockResolvedValue([]);
      projects.assertAccess = jest.fn().mockResolvedValue(undefined);
    });

    // status 미지정이면 등록 전 초안(DRAFT)만 빼고 접근 가능한 프로젝트 전체를 본다.
    it("status 미지정이면 초안을 제외하고 접근 가능한 프로젝트만 조회한다", async () => {
      (projects.accessibleProjectIds as jest.Mock).mockResolvedValue(["p1", "p2"]);
      await service.list("u1");
      expect(listWhere()).toEqual({
        projectId: { in: ["p1", "p2"] },
        status: { not: IssueStatus.DRAFT },
      });
    });

    it("status를 DB enum으로 변환해 필터에 넣는다", async () => {
      await service.list("u1", undefined, "needs_decision");
      expect(listWhere()).toEqual({
        projectId: { in: ["p1"] },
        status: IssueStatus.NEEDS_DECISION,
      });
    });

    it("projectId와 status를 함께 적용한다(접근 검사도 수행)", async () => {
      await service.list("u1", "p1", "running");
      expect(projects.assertAccess).toHaveBeenCalledWith("p1", "u1");
      expect(listWhere()).toEqual({
        projectId: { in: ["p1"] },
        status: IssueStatus.RUNNING,
      });
    });

    // 허용 목록에 없는 값은 Prisma enum 캐스팅 에러 대신 전체 조회로 폴백해야 한다.
    it("알 수 없는 status 값은 무시하고 전체를 조회한다", async () => {
      await service.list("u1", undefined, "bogus");
      expect(listWhere()).toEqual({
        projectId: { in: ["p1"] },
        status: { not: IssueStatus.DRAFT },
      });
    });

    it("빈 문자열 status도 무시한다", async () => {
      await service.list("u1", undefined, "");
      expect(listWhere()).toEqual({
        projectId: { in: ["p1"] },
        status: { not: IssueStatus.DRAFT },
      });
    });
  });

  // 공유 링크(비로그인) 수동 등록 경로. 초안은 워커가 집지 않아야 하고,
  // 확정은 "그 프로젝트의 DRAFT"만 대상이어야 한다(공개 라우트의 쓰기 범위 제한).
  describe("createFromReport / finalizeReportDraft (공유 링크 등록)", () => {
    const row = (over: Record<string, unknown> = {}) => ({
      id: "i1",
      projectId: "p1",
      repo: "o/r",
      issueNumber: null,
      title: "t",
      body: null,
      url: null,
      labels: [],
      author: null,
      source: "MANUAL",
      prompt: null,
      images: [],
      imageMap: null,
      status: IssueStatus.QUEUED,
      sessionId: null,
      result: null,
      error: null,
      resultCommentUrl: null,
      prUrl: null,
      category: null,
      progress: null,
      progressLog: null,
      costUsd: null,
      inputTokens: null,
      outputTokens: null,
      attempts: 0,
      claimedAt: null,
      lockedBy: null,
      createdAt: new Date("2026-07-25T00:00:00.000Z"),
      updatedAt: new Date("2026-07-25T00:00:00.000Z"),
      ...over,
    });

    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue({ id: "p1", gitRepo: "o/r" });
    });

    it("draft=true면 DRAFT 상태로 만들어 워커가 집지 않게 한다", async () => {
      prisma.issueTask.create.mockResolvedValue(row({ status: IssueStatus.DRAFT }));
      await service.createFromReport("p1", { title: "(작성 중)", draft: true });
      expect(prisma.issueTask.create.mock.calls[0][0].data.status).toBe(
        IssueStatus.DRAFT,
      );
    });

    it("draft가 없으면 QUEUED로 만들어 바로 큐에 넣는다", async () => {
      prisma.issueTask.create.mockResolvedValue(row());
      await service.createFromReport("p1", { title: "버그" });
      expect(prisma.issueTask.create.mock.calls[0][0].data.status).toBe(
        IssueStatus.QUEUED,
      );
    });

    it("초안 확정은 제목·본문을 채우고 QUEUED로 넘긴다", async () => {
      prisma.issueTask.findFirst.mockResolvedValue(row({ status: IssueStatus.DRAFT }));
      prisma.issueTask.update.mockResolvedValue(row({ title: "버그", body: "![](x)" }));

      await service.finalizeReportDraft("p1", "i1", {
        title: "버그",
        body: "![](x)",
        reporter: "tester",
      });

      // 조회 범위가 (id, projectId, DRAFT)로 좁혀져 있어야 한다.
      expect(prisma.issueTask.findFirst.mock.calls[0][0].where).toEqual({
        id: "i1",
        projectId: "p1",
        status: IssueStatus.DRAFT,
      });
      expect(prisma.issueTask.update.mock.calls[0][0].data).toEqual({
        title: "버그",
        body: "![](x)",
        labels: [],
        author: "tester",
        status: IssueStatus.QUEUED,
      });
    });

    // 이미 확정된 이슈(DRAFT 아님)나 다른 프로젝트의 이슈는 findFirst가 못 찾으므로
    // 공개 경로로 남의 이슈를 덮어쓸 수 없다.
    it("DRAFT가 아니거나 다른 프로젝트면 거부한다", async () => {
      prisma.issueTask.findFirst.mockResolvedValue(null);
      await expect(
        service.finalizeReportDraft("p1", "i1", { title: "덮어쓰기" }),
      ).rejects.toThrow("등록 대기 중인 초안을 찾을 수 없습니다.");
      expect(prisma.issueTask.update).not.toHaveBeenCalled();
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
        draft: 0,
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

  describe("commentResult (결과 코멘트 수동 게시)", () => {
    const raw = {
      id: "i1",
      projectId: "p1",
      repo: "o/r",
      issueNumber: 7,
      images: [],
      labels: [],
    };

    beforeEach(() => {
      prisma.project.findUnique.mockResolvedValue({
        id: "p1",
        gitTokenEnc: "enc",
        ownerId: "u1",
      });
      // commentResult 종료 시 toDto(update 결과)를 부르므로 날짜 있는 행을 돌려준다.
      prisma.issueTask.update.mockResolvedValue({
        ...raw,
        status: IssueStatus.DONE,
        source: "GITHUB",
        title: "t",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it("에이전트가 쓴 사람 말투 ISSUE_COMMENT로 게시한다(봇 머리말·이모지 없이)", async () => {
      prisma.issueTask.findUnique.mockResolvedValue({
        ...raw,
        result:
          "완료.\n<<<RESULT\nPR_URL: none\nISSUE_COMMENT: 세션 만료 처리에 있던 널 참조를 고쳤습니다.\nDECISION_NEEDED: none\n>>>",
      });

      await service.commentResult("i1", "u1");

      const [, , body] = github.createComment.mock.calls[0];
      expect(body).toBe("세션 만료 처리에 있던 널 참조를 고쳤습니다.");
      expect(body).not.toContain("🤖");
      expect(body).not.toContain("<<<RESULT");
    });

    it("ISSUE_COMMENT가 없으면 기계 규약 블록을 걷어낸 본문으로 게시한다", async () => {
      prisma.issueTask.findUnique.mockResolvedValue({
        ...raw,
        result:
          "로그인 리다이렉트 버그를 수정했습니다.\n<<<RESULT\nPR_URL: none\nISSUE_COMMENT: none\nDECISION_NEEDED: none\n>>>",
      });

      await service.commentResult("i1", "u1");

      const [, , body] = github.createComment.mock.calls[0];
      expect(body).toBe("로그인 리다이렉트 버그를 수정했습니다.");
      expect(body).not.toContain("🤖");
      expect(body).not.toContain("<<<RESULT");
    });

    it("ISSUE_COMMENT가 없고 SUMMARY가 있으면 SUMMARY로 게시한다", async () => {
      prisma.issueTask.findUnique.mockResolvedValue({
        ...raw,
        result:
          "장문의 서술...\n<<<RESULT\nPR_URL: none\nISSUE_COMMENT: none\nSUMMARY: 세션 만료 처리의 널 참조를 고쳤습니다.\nDECISION_NEEDED: none\n>>>",
      });

      await service.commentResult("i1", "u1");

      const [, , body] = github.createComment.mock.calls[0];
      expect(body).toBe("세션 만료 처리의 널 참조를 고쳤습니다.");
      expect(body).not.toContain("<<<RESULT");
      expect(body).not.toContain("장문의 서술");
    });
  });
});
