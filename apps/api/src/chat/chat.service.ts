import { Injectable, NotFoundException } from "@nestjs/common";
import { ChatRole } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { AgentService, type AgentStreamEvent } from "../agent/agent.service";

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
  | { type: "tool"; id: string; name: string; input?: string };

/** 스트림 이벤트를 parts 배열로 누적하는 리듀서 (프론트와 동일 규칙) */
function reduceParts(parts: ChatPart[], e: AgentStreamEvent): ChatPart[] {
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
    return {
      ...this.toDto(s),
      sdkSessionId: s.sdkSessionId,
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

    await this.agent.runStream(
      session.projectId,
      {
        prompt,
        resume: session.sdkSessionId ?? undefined,
        userId,
        systemPrompt:
          "당신은 이 프로젝트 컨텍스트에서 사용자를 돕는 코딩 에이전트입니다.",
      },
      (e) => {
        if (e.type === "session") newSdkSessionId = e.sessionId;
        else if (e.type === "done") finalText = e.text || finalText;
        else parts = reduceParts(parts, e);
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
