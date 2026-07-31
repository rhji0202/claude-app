import { ChatRole } from "@prisma/client";
import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatService } from "./chat.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import {
  AgentService,
  type AgentStreamEvent,
} from "../agent/agent.service";
import { RepoManagerService } from "../repo/repo-manager.service";
import { WorktreeService } from "../repo/worktree.service";
import { UsageService } from "../usage/usage.service";
import { UploadsService } from "../uploads/uploads.service";

describe("ChatService", () => {
  let service: ChatService;
  let db: {
    chatSession: {
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      delete: jest.Mock;
    };
    chatMessage: { create: jest.Mock };
    project: { findUnique: jest.Mock };
    issueTask: { findUnique: jest.Mock };
  };
  let projects: { assertAccess: jest.Mock };
  let agent: { runStream: jest.Mock; transferSession: jest.Mock };
  let repos: {
    prepareForProject: jest.Mock;
    currentBranch: jest.Mock;
    baseDir: jest.Mock;
  };
  let worktrees: {
    pathFor: jest.Mock;
    exists: jest.Mock;
    create: jest.Mock;
    remove: jest.Mock;
  };
  let usage: { record: jest.Mock };
  let uploads: {
    signRelPath: jest.Mock;
    removeChatDir: jest.Mock;
    readAsBase64: jest.Mock;
    readFile: jest.Mock;
    saveChatImage: jest.Mock;
    saveChatFile: jest.Mock;
    stageInto: jest.Mock;
  };

  beforeEach(() => {
    db = {
      chatSession: {
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
      },
      chatMessage: { create: jest.fn().mockResolvedValue({}) },
      project: {
        findUnique: jest.fn().mockResolvedValue({ claudeAccountId: null }),
      },
      issueTask: { findUnique: jest.fn() },
    };
    projects = { assertAccess: jest.fn().mockResolvedValue("owner") };
    agent = {
      runStream: jest.fn(),
      transferSession: jest.fn().mockResolvedValue(true),
    };
    repos = {
      prepareForProject: jest.fn().mockResolvedValue("/repos/p1"),
      currentBranch: jest.fn().mockResolvedValue("master"),
      baseDir: jest.fn((pid: string) => `/repos/${pid}`),
    };
    worktrees = {
      pathFor: jest.fn((pid: string, key: string) => `/worktrees/${pid}/${key}`),
      exists: jest.fn().mockResolvedValue(false),
      create: jest.fn((pid: string, key: string) =>
        Promise.resolve({ path: `/worktrees/${pid}/${key}`, branch: `chat/${key}` }),
      ),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    usage = { record: jest.fn().mockResolvedValue(undefined) };
    uploads = {
      signRelPath: jest.fn((rel: string) => `${rel}?exp=1&sig=x`),
      removeChatDir: jest.fn().mockResolvedValue(undefined),
      readAsBase64: jest
        .fn()
        .mockResolvedValue({ data: "BASE64", mediaType: "image/png" }),
      readFile: jest.fn().mockResolvedValue(Buffer.from("data")),
      saveChatImage: jest.fn(),
      saveChatFile: jest.fn(),
      // 복사 규칙(중복명·gitignore)은 실물이 갖고 있으므로 빌려 쓴다.
      // readFile 스텁을 통해 동작하므로 실제 업로드 저장소는 건드리지 않는다.
      stageInto: jest.fn(function (
        this: void,
        ...args: Parameters<UploadsService["stageInto"]>
      ) {
        return UploadsService.prototype.stageInto.apply(uploads, args);
      }),
    };
    service = new ChatService(
      db as unknown as PrismaService,
      projects as unknown as ProjectsService,
      agent as unknown as AgentService,
      repos as unknown as RepoManagerService,
      usage as unknown as UsageService,
      // get()이 undefined를 돌려주면 코드가 기본값 300으로 폴백한다.
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      uploads as unknown as UploadsService,
      worktrees as unknown as WorktreeService,
    );
  });

  describe("getSession", () => {
    beforeEach(() => {
      db.chatSession.findFirst.mockResolvedValue({
        id: "s1",
        projectId: "p1",
        title: null,
        sdkSessionId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        messages: [],
      });
    });

    it("관리 clone의 실제 브랜치를 함께 내린다", async () => {
      const s = await service.getSession("u1", "s1");
      expect(repos.currentBranch).toHaveBeenCalledWith("p1");
      expect(s.branch).toBe("master");
    });

    it("clone이 없으면 branch는 null이다(오류 아님)", async () => {
      repos.currentBranch.mockResolvedValue(null);
      const s = await service.getSession("u1", "s1");
      expect(s.branch).toBeNull();
    });
  });

  describe("createSession", () => {
    it("접근 권한을 확인한 뒤 세션을 만든다", async () => {
      db.chatSession.create.mockResolvedValue({
        id: "s1",
        projectId: "p1",
        title: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await service.createSession("u1", "p1");
      expect(projects.assertAccess).toHaveBeenCalledWith("p1", "u1");
      expect(db.chatSession.create).toHaveBeenCalled();
    });

    describe("fromIssueId (이슈 → 대화 이어가기)", () => {
      beforeEach(() => {
        const row = {
          id: "s9",
          projectId: "p-issue",
          title: "이슈: 로그인 실패",
          useWorktree: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        // 세션 행을 먼저 만들고(worktree 경로가 세션 id에 묶임) 이관 성공 시 update.
        db.chatSession.create.mockResolvedValue(row);
        db.chatSession.update.mockImplementation(
          ({ data }: { data: Record<string, unknown> }) =>
            Promise.resolve({ ...row, ...data }),
        );
      });

      it("이슈의 SDK 세션을 이어받아 대화를 만든다", async () => {
        db.issueTask.findUnique.mockResolvedValue({
          id: "i1",
          projectId: "p-issue",
          title: "로그인 실패",
          sessionId: "sdk-issue-1",
        });
        await service.createSession("u1", "", "i1");
        expect(db.chatSession.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            projectId: "p-issue",
            title: "이슈: 로그인 실패",
          }),
        });
        // 세션 id가 있어야 이관 대상 경로를 정할 수 있어, sdkSessionId는 이관 뒤 붙는다.
        expect(db.chatSession.update).toHaveBeenCalledWith({
          where: { id: "s9" },
          data: { sdkSessionId: "sdk-issue-1" },
        });
      });

      /**
       * CLI 세션은 작업 디렉터리별로 저장된다. 이슈 worktree에서 만든 세션을
       * 채팅의 clone base로 옮기지 않으면 resume이 "No conversation found"로 깨진다.
       */
      it("이슈 worktree의 세션을 채팅 cwd로 이관한다", async () => {
        db.issueTask.findUnique.mockResolvedValue({
          id: "i1",
          projectId: "p-issue",
          title: "t",
          sessionId: "sdk-issue-1",
        });
        await service.createSession("u1", "", "i1");
        expect(agent.transferSession).toHaveBeenCalledWith(
          "sdk-issue-1",
          "/worktrees/p-issue/i1",
          "/repos/p-issue",
        );
      });

      it("세션 이관에 실패하면 맥락 없이 새 세션으로 시작한다", async () => {
        db.issueTask.findUnique.mockResolvedValue({
          id: "i1",
          projectId: "p-issue",
          title: "t",
          sessionId: "sdk-죽은세션",
        });
        agent.transferSession.mockResolvedValue(false);
        await service.createSession("u1", "", "i1");
        // 죽은 세션 id를 물려주면 첫 메시지가 통째로 실패한다 → 붙이지 않는다.
        expect(db.chatSession.update).not.toHaveBeenCalled();
      });

      it("worktree 모드면 이슈 브랜치를 기준으로 기록한다", async () => {
        db.issueTask.findUnique.mockResolvedValue({
          id: "i1",
          projectId: "p-issue",
          title: "t",
          sessionId: null,
        });
        await service.createSession("u1", "", "i1", true);
        expect(db.chatSession.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            useWorktree: true,
            baseBranch: "issue/i1",
          }),
        });
      });

      it("worktree를 안 쓰면 기준 브랜치를 남기지 않는다", async () => {
        db.issueTask.findUnique.mockResolvedValue({
          id: "i1",
          projectId: "p-issue",
          title: "t",
          sessionId: null,
        });
        await service.createSession("u1", "", "i1", false);
        expect(db.chatSession.create).toHaveBeenCalledWith({
          data: expect.objectContaining({ useWorktree: false, baseBranch: null }),
        });
      });

      it("프로젝트는 이슈의 것을 쓴다(클라이언트 값 무시)", async () => {
        db.issueTask.findUnique.mockResolvedValue({
          id: "i1",
          projectId: "p-issue",
          title: "t",
          sessionId: null,
        });
        // 남의 프로젝트 id를 실어 보내도 권한 검사는 이슈의 프로젝트로 이뤄져야 한다.
        await service.createSession("u1", "p-남의것", "i1");
        expect(projects.assertAccess).toHaveBeenCalledWith("p-issue", "u1");
        expect(projects.assertAccess).not.toHaveBeenCalledWith(
          "p-남의것",
          "u1",
        );
      });

      it("실행된 적 없는 이슈면 새 세션으로 시작한다", async () => {
        db.issueTask.findUnique.mockResolvedValue({
          id: "i1",
          projectId: "p-issue",
          title: "t",
          sessionId: null,
        });
        await service.createSession("u1", "", "i1");
        // 이어받을 세션이 없으므로 이관도, sdkSessionId 갱신도 하지 않는다.
        expect(agent.transferSession).not.toHaveBeenCalled();
        expect(db.chatSession.update).not.toHaveBeenCalled();
      });

      it("없는 이슈면 404", async () => {
        db.issueTask.findUnique.mockResolvedValue(null);
        await expect(service.createSession("u1", "", "없음")).rejects.toThrow(
          "이슈를 찾을 수 없습니다.",
        );
        expect(db.chatSession.create).not.toHaveBeenCalled();
      });
    });
  });

  describe("worktree 모드", () => {
    beforeEach(() => {
      db.chatSession.update.mockResolvedValue({});
      db.chatMessage.create.mockResolvedValue({});
      agent.runStream.mockResolvedValue(undefined);
    });

    /** useWorktree 값으로 세션을 열어두고 streamMessage를 한 번 돌린다. */
    async function run(useWorktree: boolean) {
      db.chatSession.findFirst.mockResolvedValue({
        id: "s1",
        userId: "u1",
        projectId: "p1",
        title: "t",
        sdkSessionId: null,
        useWorktree,
      });
      await service.streamMessage("u1", "s1", "안녕", () => {});
      return agent.runStream.mock.calls[0][1].cwd as string;
    }

    it("기본(off)은 관리 clone base에서 실행한다", async () => {
      expect(await run(false)).toBe("/repos/p1");
      expect(worktrees.create).not.toHaveBeenCalled();
    });

    it("worktree 모드는 chat 접두사로 전용 worktree를 만들어 실행한다", async () => {
      worktrees.exists.mockResolvedValue(false);
      db.project.findUnique.mockResolvedValue({ gitBranch: "master-qa" });
      const cwd = await run(true);
      expect(worktrees.create).toHaveBeenCalledWith(
        "p1",
        "s1",
        "master-qa",
        "chat",
        // baseBranch 미지정(일반 대화) → 로컬 ref 허용 안 함
        false,
      );
      expect(cwd).toBe("/worktrees/p1/s1");
    });

    /**
     * 대화형이라 앞 턴에서 고친 파일이 남아 있어야 한다. 이슈 실행처럼 매번
     * 새로 만들면 대화가 성립하지 않는다.
     */
    it("이미 있으면 재사용한다(턴마다 새로 만들지 않는다)", async () => {
      worktrees.exists.mockResolvedValue(true);
      const cwd = await run(true);
      expect(worktrees.create).not.toHaveBeenCalled();
      expect(cwd).toBe("/worktrees/p1/s1");
    });

    /**
     * 이슈에서 이어받은 대화는 그 이슈가 작업하던 브랜치를 기준으로 삼아야
     * 고친 결과를 보면서 이어갈 수 있다. 이슈 브랜치는 push 전이면 로컬에만
     * 있으므로 로컬 ref 조회를 허용해야 한다.
     */
    it("baseBranch가 있으면 그 브랜치를 기준으로(로컬 ref 허용) 만든다", async () => {
      worktrees.exists.mockResolvedValue(false);
      db.project.findUnique.mockResolvedValue({ gitBranch: "master-qa" });
      db.chatSession.findFirst.mockResolvedValue({
        id: "s1",
        userId: "u1",
        projectId: "p1",
        title: "t",
        sdkSessionId: null,
        useWorktree: true,
        baseBranch: "issue/i1",
      });
      await service.streamMessage("u1", "s1", "안녕", () => {});
      expect(worktrees.create).toHaveBeenCalledWith(
        "p1",
        "s1",
        "issue/i1",
        "chat",
        true,
      );
    });

    /**
     * 이어받으려던 이슈 브랜치가 사라졌다고 대화 자체를 못 열면 안 된다.
     * 기준만 프로젝트 기본으로 낮춰 계속한다.
     */
    it("기준 브랜치가 없으면 프로젝트 기본으로 폴백한다", async () => {
      worktrees.exists.mockResolvedValue(false);
      db.project.findUnique.mockResolvedValue({ gitBranch: "master-qa" });
      db.chatSession.findFirst.mockResolvedValue({
        id: "s1",
        userId: "u1",
        projectId: "p1",
        title: "t",
        sdkSessionId: null,
        useWorktree: true,
        baseBranch: "issue/사라진브랜치",
      });
      worktrees.create
        .mockRejectedValueOnce(new Error("기준 브랜치를 찾을 수 없습니다."))
        .mockResolvedValueOnce({ path: "/worktrees/p1/s1", branch: "chat/s1" });

      await service.streamMessage("u1", "s1", "안녕", () => {});
      expect(worktrees.create).toHaveBeenCalledTimes(2);
      // 2회차는 프로젝트 기본 브랜치로, 로컬 ref 허용 없이.
      expect(worktrees.create).toHaveBeenLastCalledWith(
        "p1",
        "s1",
        "master-qa",
        "chat",
      );
      expect(agent.runStream.mock.calls[0][1].cwd).toBe("/worktrees/p1/s1");
    });

    it("세션 삭제 시 worktree도 정리한다", async () => {
      db.chatSession.findFirst.mockResolvedValue({
        id: "s1",
        userId: "u1",
        projectId: "p1",
        useWorktree: true,
      });
      db.chatSession.delete.mockResolvedValue({});
      await service.deleteSession("u1", "s1");
      expect(worktrees.remove).toHaveBeenCalledWith("p1", "s1");
    });

    it("worktree를 안 쓰는 세션은 삭제해도 worktree를 건드리지 않는다", async () => {
      db.chatSession.findFirst.mockResolvedValue({
        id: "s1",
        userId: "u1",
        projectId: "p1",
        useWorktree: false,
      });
      db.chatSession.delete.mockResolvedValue({});
      await service.deleteSession("u1", "s1");
      expect(worktrees.remove).not.toHaveBeenCalled();
    });
  });

  describe("uploadAttachments", () => {
    beforeEach(() => {
      db.chatSession.findFirst.mockResolvedValue({ id: "s1", userId: "u1" });
    });

    it("일부가 실패해도 나머지는 올리고 실패 목록을 함께 돌려준다", async () => {
      uploads.saveChatFile
        .mockRejectedValueOnce(
          new BadRequestException("지원하지 않는 파일 형식입니다: exe"),
        )
        .mockResolvedValueOnce({ relPath: "chat-files/s1/b.md", fileName: "b.md" });

      const res = await service.uploadAttachments("u1", "s1", [
        { buffer: Buffer.from("x"), mimetype: "application/x-msdownload", originalname: "bad.exe" },
        { buffer: Buffer.from("y"), mimetype: "text/markdown", originalname: "b.md" },
      ]);

      expect(res.saved).toHaveLength(1);
      expect(res.saved[0].name).toBe("b.md");
      expect(res.failed).toEqual([
        { name: "bad.exe", reason: "지원하지 않는 파일 형식입니다: exe" },
      ]);
    });

    it("모두 성공하면 failed는 비어 있다", async () => {
      uploads.saveChatFile.mockResolvedValue({
        relPath: "chat-files/s1/a.md",
        fileName: "a.md",
      });
      const res = await service.uploadAttachments("u1", "s1", [
        { buffer: Buffer.from("x"), mimetype: "text/markdown", originalname: "a.md" },
      ]);
      expect(res.failed).toEqual([]);
      expect(res.saved).toHaveLength(1);
    });
  });

  describe("streamMessage", () => {
    beforeEach(() => {
      db.chatSession.findFirst.mockResolvedValue({
        id: "s1",
        userId: "u1",
        projectId: "p1",
        title: null,
        sdkSessionId: null,
      });
      // runStream이 가짜 이벤트를 순서대로 방출 (id 기반 parts)
      agent.runStream.mockImplementation(
        async (
          _pid: string,
          _opts: unknown,
          onEvent: (e: AgentStreamEvent) => void,
        ) => {
          onEvent({ type: "session", sessionId: "sdk-123" });
          onEvent({ type: "text_start", id: "1:0" });
          onEvent({ type: "text_delta", id: "1:0", delta: "안녕" });
          onEvent({ type: "text_delta", id: "1:0", delta: "하세요" });
          onEvent({ type: "text_end", id: "1:0", text: "안녕하세요" });
          onEvent({ type: "done", text: "안녕하세요", sessionId: "sdk-123" });
        },
      );
    });

    // 예전에는 maxTurns를 넘기지 않아 runStream 기본값 20이 걸렸다 — 조사·수정이
    // 긴 대화가 턴 한도에서 끊겼다. 이슈(ISSUE_MAX_TURNS)와 같은 수준으로 맞춘다.
    it("maxTurns를 CHAT_MAX_TURNS(기본 300)로 넘긴다", async () => {
      await service.streamMessage("u1", "s1", "hi", () => {});
      expect(agent.runStream.mock.calls[0][1]).toMatchObject({ maxTurns: 300 });
    });

    it("user 메시지 저장 → parts 누적 → assistant 저장 + sdkSessionId 갱신", async () => {
      const events: AgentStreamEvent[] = [];
      await service.streamMessage("u1", "s1", "hi there", (e) => events.push(e));

      // 권한 확인
      expect(projects.assertAccess).toHaveBeenCalledWith("p1", "u1");

      // user + assistant 두 번 저장
      const savedRoles = db.chatMessage.create.mock.calls.map(
        (c) => c[0].data.role,
      );
      expect(savedRoles).toEqual([ChatRole.USER, ChatRole.ASSISTANT]);
      // content = 최종 답변, parts = 확정된 text 파트(중복 없음)
      const assistant = db.chatMessage.create.mock.calls[1][0].data;
      expect(assistant.content).toBe("안녕하세요");
      expect(assistant.parts).toEqual([
        { type: "text", id: "1:0", text: "안녕하세요" },
      ]);

      // 첫 메시지라 title 설정 + sdkSessionId 저장
      const updates = db.chatSession.update.mock.calls.map((c) => c[0].data);
      expect(updates.some((u) => u.title === "hi there")).toBe(true);
      expect(updates.some((u) => u.sdkSessionId === "sdk-123")).toBe(true);

      // 호출자에게 이벤트 전달
      expect(events.map((e) => e.type)).toEqual([
        "session",
        "text_start",
        "text_delta",
        "text_delta",
        "text_end",
        "done",
      ]);
    });

    it("tool_result는 같은 id의 tool 파트에 결과로 병합된다", async () => {
      agent.runStream.mockImplementation(
        async (
          _pid: string,
          _opts: unknown,
          onEvent: (e: AgentStreamEvent) => void,
        ) => {
          onEvent({ type: "tool", id: "tu_1", name: "Bash", input: '{"command":"ls"}' });
          onEvent({ type: "tool_result", id: "tu_1", content: "a.ts\nb.ts" });
          onEvent({ type: "tool", id: "tu_2", name: "Read" });
          onEvent({ type: "tool_result", id: "tu_2", content: "없음", isError: true });
          onEvent({ type: "done", text: "완료" });
        },
      );

      await service.streamMessage("u1", "s1", "hi", () => {});

      const assistant = db.chatMessage.create.mock.calls[1][0].data;
      // 새 파트가 늘지 않고 기존 tool 파트에 result가 붙는다
      expect(assistant.parts).toEqual([
        {
          type: "tool",
          id: "tu_1",
          name: "Bash",
          input: '{"command":"ls"}',
          result: "a.ts\nb.ts",
          resultIsError: undefined,
        },
        {
          type: "tool",
          id: "tu_2",
          name: "Read",
          input: undefined,
          result: "없음",
          resultIsError: true,
        },
      ]);
    });

    it("진행 이벤트(tool_progress·thinking_tokens)는 저장하지 않는다", async () => {
      agent.runStream.mockImplementation(
        async (
          _pid: string,
          _opts: unknown,
          onEvent: (e: AgentStreamEvent) => void,
        ) => {
          onEvent({ type: "tool", id: "tu_1", name: "Bash", input: "{}" });
          onEvent({ type: "tool_progress", id: "tu_1", elapsedSeconds: 3 });
          onEvent({ type: "thinking_tokens", tokens: 1200 });
          onEvent({ type: "tool_result", id: "tu_1", content: "ok" });
          onEvent({ type: "done", text: "완료" });
        },
      );

      const seen: string[] = [];
      await service.streamMessage("u1", "s1", "hi", (e) => seen.push(e.type));

      // 클라이언트에는 전달된다(진행 표시용)
      expect(seen).toContain("tool_progress");
      expect(seen).toContain("thinking_tokens");

      // 그러나 parts에는 남지 않는다 — tool 파트 1개, elapsed 필드 없음
      const assistant = db.chatMessage.create.mock.calls[1][0].data;
      expect(assistant.parts).toEqual([
        {
          type: "tool",
          id: "tu_1",
          name: "Bash",
          input: "{}",
          result: "ok",
          resultIsError: undefined,
        },
      ]);
    });

    it("서브에이전트 파트(parentId 있음)는 저장하지 않는다", async () => {
      agent.runStream.mockImplementation(
        async (
          _pid: string,
          _opts: unknown,
          onEvent: (e: AgentStreamEvent) => void,
        ) => {
          // 메인 스레드: Task 도구 호출
          onEvent({ type: "tool", id: "tu_parent", name: "Task", input: "{}" });
          // 서브에이전트 내부 활동 — 저장 대상이 아니다
          onEvent({ type: "text_start", id: "tu_parent#1:0", parentId: "tu_parent" });
          onEvent({
            type: "text_end",
            id: "tu_parent#1:0",
            text: "서브 결과",
            parentId: "tu_parent",
          });
          onEvent({
            type: "tool",
            id: "tu_child",
            name: "Grep",
            parentId: "tu_parent",
          });
          onEvent({
            type: "tool_result",
            id: "tu_child",
            content: "3건",
            parentId: "tu_parent",
          });
          // 메인 스레드 최종 답변(agent.service는 text_end 전에 항상 start를 보낸다)
          onEvent({ type: "text_start", id: "1:0" });
          onEvent({ type: "text_end", id: "1:0", text: "완료했습니다" });
          onEvent({ type: "done", text: "완료했습니다" });
        },
      );

      await service.streamMessage("u1", "s1", "hi", () => {});

      // 저장된 parts에는 메인 스레드 것만 남는다(서브 파트 4건 제외).
      const assistant = db.chatMessage.create.mock.calls[1][0].data;
      expect(assistant.parts).toEqual([
        { type: "tool", id: "tu_parent", name: "Task", input: "{}" },
        { type: "text", id: "1:0", text: "완료했습니다" },
      ]);
    });

    it("done의 accountId(실사용 계정)로 사용량을 기록한다", async () => {
      agent.runStream.mockImplementation(
        async (
          _pid: string,
          _opts: unknown,
          onEvent: (e: AgentStreamEvent) => void,
        ) => {
          onEvent({ type: "session", sessionId: "sdk-123" });
          onEvent({ type: "text_end", id: "1:0", text: "답변" });
          onEvent({
            type: "done",
            text: "답변",
            sessionId: "sdk-123",
            usage: {
              costUsd: 0.01,
              inputTokens: 10,
              outputTokens: 20,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
            },
            accountId: "acc-active",
          });
        },
      );

      await service.streamMessage("u1", "s1", "hi", () => {});

      expect(usage.record).toHaveBeenCalledWith(
        expect.objectContaining({ claudeAccountId: "acc-active" }),
      );
      // 실사용 계정이 잡혔으므로 프로젝트 계정 조회로 폴백하지 않는다.
      expect(db.project.findUnique).not.toHaveBeenCalled();
    });

    it("accountId 미확인 시 프로젝트 지정 계정으로 폴백해 기록한다", async () => {
      db.project.findUnique.mockResolvedValue({ claudeAccountId: "acc-proj" });
      agent.runStream.mockImplementation(
        async (
          _pid: string,
          _opts: unknown,
          onEvent: (e: AgentStreamEvent) => void,
        ) => {
          // accountId 없는 done(구 경로 호환)
          onEvent({
            type: "done",
            text: "답변",
            sessionId: "sdk-1",
            usage: {
              costUsd: 0.01,
              inputTokens: 1,
              outputTokens: 1,
              cacheReadTokens: 0,
              cacheCreationTokens: 0,
            },
          });
        },
      );

      await service.streamMessage("u1", "s1", "hi", () => {});

      expect(usage.record).toHaveBeenCalledWith(
        expect.objectContaining({ claudeAccountId: "acc-proj" }),
      );
    });
  });

  describe("첨부", () => {
    beforeEach(() => {
      db.chatSession.findFirst.mockResolvedValue({
        id: "s1",
        userId: "u1",
        projectId: "p1",
        title: "t",
        sdkSessionId: "sdk-prev",
      });
      agent.runStream.mockImplementation(
        async (
          _pid: string,
          _opts: unknown,
          onEvent: (e: AgentStreamEvent) => void,
        ) => {
          onEvent({ type: "done", text: "ok", sessionId: "sdk-prev" });
        },
      );
    });

    const image = (rel = "chat-files/s1/a.png") => ({
      kind: "image" as const,
      url: `${rel}?exp=1&sig=x`,
      name: "a.png",
    });

    it("이미지는 base64 블록으로 에이전트에 전달한다", async () => {
      await service.streamMessage("u1", "s1", "이거 봐줘", () => {}, undefined, [
        image(),
      ]);
      expect(uploads.readAsBase64).toHaveBeenCalledWith("chat-files/s1/a.png");
      expect(agent.runStream.mock.calls[0][1]).toMatchObject({
        images: [{ data: "BASE64", mediaType: "image/png" }],
      });
    });

    // 이미지를 붙여도 대화가 이어져야 한다(멀티턴 채팅의 핵심 요구사항).
    it("이미지가 있어도 resume을 유지한다", async () => {
      await service.streamMessage("u1", "s1", "이거 봐줘", () => {}, undefined, [
        image(),
      ]);
      expect(agent.runStream.mock.calls[0][1]).toMatchObject({
        resume: "sdk-prev",
      });
    });

    it("첨부 메타를 user 메시지에 저장한다", async () => {
      await service.streamMessage("u1", "s1", "hi", () => {}, undefined, [
        image(),
      ]);
      expect(db.chatMessage.create.mock.calls[0][0].data.attachments).toEqual([
        { kind: "image", relPath: "chat-files/s1/a.png", name: "a.png" },
      ]);
    });

    it("다른 세션·traversal 경로의 첨부는 무시한다", async () => {
      await service.streamMessage("u1", "s1", "hi", () => {}, undefined, [
        image("chat-files/s2/secret.png"), // 남의 세션
        image("chat-files/s1/../s2/x.png"), // traversal
        image("issue-images/i1/x.png"), // 다른 기능 영역
      ]);
      expect(uploads.readAsBase64).not.toHaveBeenCalled();
      expect(
        db.chatMessage.create.mock.calls[0][0].data.attachments,
      ).toBeUndefined();
    });

    it("파일 첨부는 실행 디렉터리에 복사하고 프롬프트에 경로를 알린다", async () => {
      await service.streamMessage("u1", "s1", "정리해줘", () => {}, undefined, [
        { kind: "file", url: "chat-files/s1/b.xlsx?exp=1&sig=x", name: "b.xlsx" },
      ]);
      expect(uploads.readFile).toHaveBeenCalledWith("chat-files/s1/b.xlsx");
      const prompt = agent.runStream.mock.calls[0][1].prompt as string;
      expect(prompt).toContain("정리해줘");
      expect(prompt).toContain("첨부파일/b.xlsx");
    });

    it("세션 삭제 시 첨부 디렉터리도 지운다", async () => {
      await service.deleteSession("u1", "s1");
      expect(uploads.removeChatDir).toHaveBeenCalledWith("s1");
    });
  });
});
