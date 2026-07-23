import { ChatRole } from "@prisma/client";
import { ChatService } from "./chat.service";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import {
  AgentService,
  type AgentStreamEvent,
} from "../agent/agent.service";
import { RepoManagerService } from "../repo/repo-manager.service";

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
  };
  let projects: { assertAccess: jest.Mock };
  let agent: { runStream: jest.Mock };
  let repos: { prepareForProject: jest.Mock };

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
    };
    projects = { assertAccess: jest.fn().mockResolvedValue("owner") };
    agent = { runStream: jest.fn() };
    repos = { prepareForProject: jest.fn().mockResolvedValue("/repos/p1") };
    service = new ChatService(
      db as unknown as PrismaService,
      projects as unknown as ProjectsService,
      agent as unknown as AgentService,
      repos as unknown as RepoManagerService,
    );
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
  });
});
