import { ChatRole } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { ChatService } from "./chat.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import {
  AgentService,
  type AgentStreamEvent,
} from "../agent/agent.service";
import { RepoManagerService } from "../repo/repo-manager.service";
import { UsageService } from "../usage/usage.service";

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
  };
  let projects: { assertAccess: jest.Mock };
  let agent: { runStream: jest.Mock };
  let repos: { prepareForProject: jest.Mock; currentBranch: jest.Mock };
  let usage: { record: jest.Mock };

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
    };
    projects = { assertAccess: jest.fn().mockResolvedValue("owner") };
    agent = { runStream: jest.fn() };
    repos = {
      prepareForProject: jest.fn().mockResolvedValue("/repos/p1"),
      currentBranch: jest.fn().mockResolvedValue("master"),
    };
    usage = { record: jest.fn().mockResolvedValue(undefined) };
    service = new ChatService(
      db as unknown as PrismaService,
      projects as unknown as ProjectsService,
      agent as unknown as AgentService,
      repos as unknown as RepoManagerService,
      usage as unknown as UsageService,
      // get()이 undefined를 돌려주면 코드가 기본값 300으로 폴백한다.
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
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
});
