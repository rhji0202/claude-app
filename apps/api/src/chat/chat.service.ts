import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ChatRole, UsageKind } from "@prisma/client";
import type { AgentUsage } from "@claude-app/shared";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import {
  AgentService,
  type AgentControl,
  type AgentStreamEvent,
} from "../agent/agent.service";
import { RepoManagerService } from "../repo/repo-manager.service";
import { UsageService } from "../usage/usage.service";

export interface ChatSessionDto {
  id: string;
  projectId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

/** assistant 메시지의 순서 있는 파트(claude.ai식 타임라인). parts 컬럼에 저장. */
export type ChatPart =
  | { type: "text"; id: string; text: string }
  | {
      type: "tool";
      id: string;
      name: string;
      input?: string;
      /** 도구 실행 결과(CLI 트랜스크립트의 `⎿` 줄). tool_result 이벤트로 채워진다. */
      result?: string;
      resultIsError?: boolean;
    };

/**
 * 스트림 이벤트를 parts 배열로 누적하는 리듀서 (프론트와 동일 규칙)
 *
 * 서브에이전트 이벤트(parentId 있음)는 저장하지 않는다 — 중첩 구조를 잃고
 * 메인 타임라인에 평평하게 섞이면 재로드 시 대화가 뒤섞여 보인다.
 * 중첩 트랜스크립트는 실행 중 화면에만 존재한다.
 */
function reduceParts(parts: ChatPart[], e: AgentStreamEvent): ChatPart[] {
  if ("parentId" in e && e.parentId) return parts;
  switch (e.type) {
    case "text_start":
      if (parts.some((p) => p.type === "text" && p.id === e.id)) return parts;
      return [...parts, { type: "text", id: e.id, text: "" }];
    case "text_delta":
      return parts.map((p) =>
        p.type === "text" && p.id === e.id
          ? { ...p, text: p.text + e.delta }
          : p,
      );
    case "text_end":
      return parts.map((p) =>
        p.type === "text" && p.id === e.id ? { ...p, text: e.text } : p,
      );
    case "tool":
      if (parts.some((p) => p.type === "tool" && p.id === e.id)) return parts;
      return [...parts, { type: "tool", id: e.id, name: e.name, input: e.input }];
    case "tool_result":
      return parts.map((p) =>
        p.type === "tool" && p.id === e.id
          ? { ...p, result: e.content, resultIsError: e.isError }
          : p,
      );
    default:
      return parts;
  }
}

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly agent: AgentService,
    private readonly repos: RepoManagerService,
    private readonly usage: UsageService,
    private readonly config: ConfigService,
  ) {}

  async listSessions(userId: string): Promise<ChatSessionDto[]> {
    const rows = await this.prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  async createSession(userId: string, projectId: string): Promise<ChatSessionDto> {
    // 접근 권한 확인
    await this.projects.assertAccess(projectId, userId);
    const s = await this.prisma.chatSession.create({
      data: { userId, projectId },
    });
    return this.toDto(s);
  }

  async getSession(userId: string, id: string) {
    const s = await this.prisma.chatSession.findFirst({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!s) throw new NotFoundException("세션을 찾을 수 없습니다.");
    // 실행 중인 브랜치(CLI 상태줄 표시용). 관리 clone이 아직 없으면 null.
    // project.gitBranch가 아니라 clone의 실제 HEAD를 읽는다 — ensureRepo는
    // gitBranch를 체크아웃하지 않으므로 둘이 다를 수 있다.
    const branch = await this.repos.currentBranch(s.projectId);
    return {
      ...this.toDto(s),
      sdkSessionId: s.sdkSessionId,
      branch,
      messages: s.messages.map((m) => ({
        id: m.id,
        role: m.role === ChatRole.USER ? "user" : "assistant",
        content: m.content,
        parts: (m.parts as ChatPart[] | null) ?? undefined,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async deleteSession(userId: string, id: string): Promise<void> {
    const s = await this.prisma.chatSession.findFirst({ where: { id, userId } });
    if (!s) throw new NotFoundException("세션을 찾을 수 없습니다.");
    await this.prisma.chatSession.delete({ where: { id } });
  }

  /**
   * 사용자 메시지를 저장하고 에이전트를 스트리밍 실행한다.
   * onEvent로 델타/완료/오류를 방출하고, 완료 시 assistant 메시지·sdkSessionId를 저장한다.
   */
  async streamMessage(
    userId: string,
    sessionId: string,
    prompt: string,
    onEvent: (e: AgentStreamEvent) => void,
    /**
     * 실행 제어 핸들을 호출측(컨트롤러)에 넘긴다. SSE 연결이 끊기면 interrupt()를
     * 호출해 턴을 중단시키는 데 쓴다 — abort와 달리 부분 응답이 보존된다.
     */
    onControl?: (control: AgentControl) => void,
  ): Promise<void> {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new NotFoundException("세션을 찾을 수 없습니다.");
    await this.projects.assertAccess(session.projectId, userId);

    // 사용자 메시지 저장 + 첫 메시지면 제목 설정
    await this.prisma.chatMessage.create({
      data: { sessionId, role: ChatRole.USER, content: prompt },
    });
    if (!session.title) {
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data: { title: prompt.slice(0, 60) },
      });
    }

    let finalText = "";
    let newSdkSessionId: string | undefined;
    let parts: ChatPart[] = [];
    let usage: AgentUsage | undefined;
    // 실행에 실제 사용된 계정 id(활성 계정 폴백 반영). 사용량 귀속에 사용.
    let accountId: string | null | undefined;

    // 실행 디렉터리: 관리 clone base(설계 12.5). gitRepo 없으면 BadRequest.
    const cwd = await this.repos.prepareForProject(session.projectId);

    await this.agent.runStream(
      session.projectId,
      {
        prompt,
        resume: session.sdkSessionId ?? undefined,
        userId,
        cwd,
        systemPrompt:
          "당신은 이 프로젝트 컨텍스트에서 사용자를 돕는 코딩 에이전트입니다.",
        maxTurns: this.config.get<number>("CHAT_MAX_TURNS") ?? 300,
        onQuery: onControl,
      },
      (e) => {
        if (e.type === "session") newSdkSessionId = e.sessionId;
        else if (e.type === "done") {
          finalText = e.text || finalText;
          if (e.usage) usage = e.usage;
          if (e.accountId !== undefined) accountId = e.accountId;
        } else if (e.type === "error") {
          if (e.usage) usage = e.usage;
          if (e.accountId !== undefined) accountId = e.accountId;
        } else parts = reduceParts(parts, e);
        onEvent(e);
      },
    );

    // content = 최종 답변(마지막 text 파트 또는 done). parts = 전체 타임라인.
    const lastText = [...parts].reverse().find((p) => p.type === "text") as
      | Extract<ChatPart, { type: "text" }>
      | undefined;
    const content = finalText || lastText?.text || "";

    // 완료 후 assistant 메시지 저장
    await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role: ChatRole.ASSISTANT,
        content,
        parts: parts.length > 0 ? (parts as object[]) : undefined,
      },
    });
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        sdkSessionId: newSdkSessionId ?? session.sdkSessionId,
        updatedAt: new Date(),
      },
    });

    // 사용량 원장 기록(있을 때만). refId=chatSessionId.
    // 계정은 실행이 실제 사용한 것(activeId 폴백 포함)을 우선하고,
    // 잡히지 않았으면(undefined) 프로젝트 지정 계정으로 폴백한다.
    if (usage) {
      let recordAccountId = accountId ?? null;
      if (accountId === undefined) {
        const project = await this.prisma.project.findUnique({
          where: { id: session.projectId },
          select: { claudeAccountId: true },
        });
        recordAccountId = project?.claudeAccountId ?? null;
      }
      await this.usage.record({
        kind: UsageKind.CHAT,
        projectId: session.projectId,
        claudeAccountId: recordAccountId,
        userId,
        refId: sessionId,
        usage,
      });
    }
  }

  private toDto(s: {
    id: string;
    projectId: string;
    title: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): ChatSessionDto {
    return {
      id: s.id,
      projectId: s.projectId,
      title: s.title,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }
}
