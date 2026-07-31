import { HttpException, Injectable, NotFoundException } from "@nestjs/common";
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
import { WorktreeService } from "../repo/worktree.service";
import { UsageService } from "../usage/usage.service";
import { ATTACHMENT_DIR, UploadsService } from "../uploads/uploads.service";
import * as path from "node:path";

export interface ChatSessionDto {
  id: string;
  projectId: string;
  title: string | null;
  /** 전용 worktree에서 실행하는 대화인가(목록 배지·삭제 경고에 쓴다). */
  useWorktree: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * 사용자 메시지에 붙는 첨부. attachments 컬럼에 저장한다.
 * relPath는 내부 저장 경로이며, 응답 DTO에서는 서명 URL로 바꿔 내보낸다.
 */
export interface ChatAttachment {
  kind: "image" | "file";
  relPath: string;
  /** 표시용 이름. 이미지는 원본 파일명, 파일은 정리된 파일명. */
  name: string;
}

/** 프론트로 내보내는 첨부(서명 URL). relPath는 노출하지 않는다. */
export interface ChatAttachmentDto {
  kind: "image" | "file";
  url: string;
  name: string;
}

/** 업로드에 실패한 파일. 어느 파일이 왜 실패했는지 사용자에게 알린다. */
export interface ChatUploadFailure {
  name: string;
  reason: string;
}

/** 첨부 업로드 결과. 일부만 성공할 수 있어 성공·실패를 함께 돌려준다. */
export interface ChatUploadResult {
  saved: ChatAttachmentDto[];
  failed: ChatUploadFailure[];
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
    private readonly uploads: UploadsService,
    // 이슈 세션을 이어받을 때 그 실행이 쓰던 worktree 경로를 알아야 한다.
    private readonly worktrees: WorktreeService,
  ) {}

  async listSessions(userId: string): Promise<ChatSessionDto[]> {
    const rows = await this.prisma.chatSession.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  /**
   * 새 대화를 만든다.
   *
   * fromIssueId를 주면 그 이슈의 실행 세션을 이어받는다(설계: 결정 대기 이슈를
   * 대화로 이어가기). 이슈 실행과 채팅은 같은 성격의 SDK 세션 id를 쓰므로
   * sdkSessionId에 이슈의 sessionId를 그대로 넣으면 맥락이 유지된다.
   *
   * 이슈 상태는 건드리지 않는다 — 대화에서 결론이 나도 이슈를 자동으로 완료
   * 처리하지 않는다. 오판 위험이 크고, 이슈 화면에서 사람이 명시적으로
   * 재개·완료하는 편이 예측 가능하다.
   *
   * 주의: 이어받는 것은 **대화 맥락뿐이고 작업 디렉터리는 다르다.** 이슈는
   * per-run worktree(`worktrees/<projectId>/<issueId>`)에서 돌고 그 디렉터리는
   * 실행이 끝나면 지워지지만, 채팅은 관리 clone base에서 돈다. 즉 이슈가 고치던
   * 미커밋 변경은 대화에 없다. 결정을 논의하는 용도이며, 실제 수정은 대화에서
   * 결론을 낸 뒤 이슈를 재개해 수행하는 흐름을 전제한다.
   */
  async createSession(
    userId: string,
    projectId: string,
    fromIssueId?: string,
    useWorktree = false,
  ): Promise<ChatSessionDto> {
    if (!fromIssueId) {
      // 접근 권한 확인
      await this.projects.assertAccess(projectId, userId);
      const s = await this.prisma.chatSession.create({
        data: { userId, projectId, useWorktree },
      });
      return this.toDto(s);
    }

    const issue = await this.prisma.issueTask.findUnique({
      where: { id: fromIssueId },
      select: { id: true, projectId: true, title: true, sessionId: true },
    });
    if (!issue) throw new NotFoundException("이슈를 찾을 수 없습니다.");
    // 프로젝트는 클라이언트가 보낸 값이 아니라 이슈의 것을 쓴다 — 남의 프로젝트
    // id를 실어 보내 권한 검사를 우회하지 못하게 한다.
    await this.projects.assertAccess(issue.projectId, userId);

    // 세션 행을 먼저 만든다 — worktree 경로가 세션 id에 묶여 있어, 트랜스크립트를
    // 어디로 옮길지 정하려면 id가 필요하다.
    const s = await this.prisma.chatSession.create({
      data: {
        userId,
        projectId: issue.projectId,
        useWorktree,
        title: `이슈: ${issue.title}`.slice(0, 60),
      },
    });

    // CLI 세션은 **작업 디렉터리별로** 저장된다. 이슈는 per-run worktree에서
    // 돌았고 채팅은 다른 디렉터리에서 도므로, 트랜스크립트를 옮겨두지 않으면
    // resume이 "No conversation found"로 실패한다.
    let sdkSessionId: string | null = null;
    if (issue.sessionId) {
      const ok = await this.agent.transferSession(
        issue.sessionId,
        this.worktrees.pathFor(issue.projectId, issue.id),
        // 이 대화가 실제로 돌 디렉터리로 옮긴다(worktree 모드면 그쪽).
        useWorktree
          ? this.worktrees.pathFor(issue.projectId, s.id)
          : this.repos.baseDir(issue.projectId),
      );
      // 이관에 실패하면(worktree 세션이 이미 정리됨 등) 맥락 없이 새로 시작한다 —
      // 죽은 세션 id를 물려주면 첫 메시지가 통째로 실패한다.
      sdkSessionId = ok ? issue.sessionId : null;
    }
    if (!sdkSessionId) return this.toDto(s);

    return this.toDto(
      await this.prisma.chatSession.update({
        where: { id: s.id },
        data: { sdkSessionId },
      }),
    );
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
    //
    // worktree 모드는 clone base가 아니라 전용 worktree에서 도므로 그 브랜치를
    // 보여준다. 아직 첫 실행 전이라 worktree가 없으면 앞으로 쓸 이름을 미리 알린다.
    const branch = s.useWorktree
      ? `chat/${s.id}`
      : await this.repos.currentBranch(s.projectId);
    return {
      ...this.toDto(s),
      sdkSessionId: s.sdkSessionId,
      branch,
      messages: s.messages.map((m) => ({
        id: m.id,
        role: m.role === ChatRole.USER ? "user" : "assistant",
        content: m.content,
        parts: (m.parts as ChatPart[] | null) ?? undefined,
        attachments: this.signAttachments(m.attachments),
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  async deleteSession(userId: string, id: string): Promise<void> {
    const s = await this.prisma.chatSession.findFirst({ where: { id, userId } });
    if (!s) throw new NotFoundException("세션을 찾을 수 없습니다.");
    await this.prisma.chatSession.delete({ where: { id } });
    // 메시지는 cascade로 지워지지만 업로드 파일은 남으므로 함께 정리한다.
    await this.uploads.removeChatDir(id);
    // worktree 모드였으면 작업 디렉터리도 함께 정리한다(세션과 수명을 같이한다).
    // 커밋하지 않은 변경은 여기서 사라지므로, UI가 삭제 전에 경고한다.
    if (s.useWorktree) await this.worktrees.remove(s.projectId, id);
  }

  /**
   * 첨부를 업로드하고 저장 메타를 돌려준다. 실제 메시지 기록은 전송 시점에
   * 이뤄지므로, 여기서는 파일만 세션 디렉터리에 올려두고 클라이언트가
   * 그 결과를 다음 전송에 실어 보낸다.
   */
  async uploadAttachments(
    userId: string,
    sessionId: string,
    files: Array<{ buffer: Buffer; mimetype: string; originalname: string }>,
  ): Promise<ChatUploadResult> {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new NotFoundException("세션을 찾을 수 없습니다.");

    const saved: ChatAttachmentDto[] = [];
    const failed: ChatUploadFailure[] = [];
    for (const f of files) {
      // 파일 하나가 형식·크기 검증에 걸려도 나머지는 올라가야 한다. 예전에는
      // 첫 예외가 요청 전체를 400으로 끝내, 함께 고른 멀쩡한 파일까지 사라지고
      // 어느 파일이 문제였는지도 알 수 없었다.
      try {
        // 이미지 MIME이면 이미지로, 아니면 확장자 화이트리스트를 타는 파일로 저장한다.
        const isImage = f.mimetype?.toLowerCase().startsWith("image/");
        if (isImage) {
          const { relPath } = await this.uploads.saveChatImage(
            sessionId,
            f.buffer,
            f.mimetype,
          );
          saved.push({
            kind: "image",
            url: this.uploads.signRelPath(relPath),
            name: path.basename(f.originalname || "image"),
          });
        } else {
          const { relPath, fileName } = await this.uploads.saveChatFile(
            sessionId,
            f.buffer,
            f.originalname,
          );
          saved.push({
            kind: "file",
            url: this.uploads.signRelPath(relPath),
            name: fileName,
          });
        }
      } catch (err) {
        failed.push({
          name: path.basename(f.originalname || "file"),
          // BadRequestException의 사용자용 문구를 그대로 전달한다(형식·크기 안내).
          reason:
            err instanceof HttpException
              ? ((err.getResponse() as { message?: string })?.message ??
                err.message)
              : "업로드에 실패했습니다.",
        });
      }
    }
    return { saved, failed };
  }

  /** 저장된 첨부 메타를 서명 URL DTO로 변환. */
  private signAttachments(raw: unknown): ChatAttachmentDto[] | undefined {
    if (!Array.isArray(raw) || raw.length === 0) return undefined;
    return (raw as ChatAttachment[])
      .filter((a) => a && typeof a.relPath === "string")
      .map((a) => ({
        kind: a.kind,
        url: this.uploads.signRelPath(a.relPath),
        name: a.name,
      }));
  }

  /**
   * 클라이언트가 되돌려준 첨부 URL을 신뢰 가능한 저장 경로로 되돌린다.
   * 서명·쿼리를 떼고 반드시 이 세션의 디렉터리 아래인지 확인한다 —
   * 남의 세션 파일이나 traversal 경로를 실행에 끌어오지 못하게 막는다.
   */
  private resolveAttachments(
    sessionId: string,
    raw: ChatAttachmentDto[] | undefined,
  ): ChatAttachment[] {
    if (!Array.isArray(raw)) return [];
    const prefix = `chat-files/${sessionId}/`;
    const out: ChatAttachment[] = [];
    for (const a of raw) {
      if (!a || typeof a.url !== "string") continue;
      // 서명 쿼리 제거 + 절대 URL로 와도 경로만 취한다.
      let rel = a.url.split("?")[0].replace(/^https?:\/\/[^/]+/, "");
      rel = rel.replace(/^\/+/, "").replace(/^uploads\//, "");
      if (!rel.startsWith(prefix)) continue;
      // 정규화 후에도 여전히 이 세션 디렉터리 안이어야 한다(../ 차단).
      if (path.posix.normalize(rel) !== rel) continue;
      out.push({
        kind: a.kind === "image" ? "image" : "file",
        relPath: rel,
        name: path.basename(a.name || rel),
      });
    }
    return out;
  }

  /**
   * 이 세션이 실행될 작업 디렉터리를 준비하고 절대경로를 돌려준다.
   *
   * - 기본: 관리 clone base(여러 대화가 공유한다).
   * - worktree 모드: `chat/<세션id>` 브랜치의 전용 worktree.
   *
   * worktree는 세션이 사는 동안 유지한다 — 대화형이라 앞 턴에서 고친 파일이
   * 남아 있어야 한다(이슈 실행처럼 매번 지우면 대화가 성립하지 않는다).
   * 이미 있으면 그대로 재사용하고, 없을 때만 만든다.
   */
  private async resolveCwd(
    projectId: string,
    sessionId: string,
    useWorktree: boolean,
  ): Promise<string> {
    // clone 준비는 두 경우 모두 필요하다(worktree는 이 clone을 base로 만든다).
    const base = await this.repos.prepareForProject(projectId);
    if (!useWorktree) return base;

    if (await this.worktrees.exists(projectId, sessionId)) {
      return this.worktrees.pathFor(projectId, sessionId);
    }
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { gitBranch: true },
    });
    const wt = await this.worktrees.create(
      projectId,
      sessionId,
      project?.gitBranch,
      "chat",
    );
    return wt.path;
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
    /** 클라이언트가 이번 턴에 붙인 첨부(업로드 응답을 그대로 되돌려준 값). */
    rawAttachments?: ChatAttachmentDto[],
  ): Promise<void> {
    const session = await this.prisma.chatSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) throw new NotFoundException("세션을 찾을 수 없습니다.");
    await this.projects.assertAccess(session.projectId, userId);

    const attachments = this.resolveAttachments(sessionId, rawAttachments);

    // 사용자 메시지 저장 + 첫 메시지면 제목 설정
    await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role: ChatRole.USER,
        content: prompt,
        attachments:
          attachments.length > 0 ? (attachments as object[]) : undefined,
      },
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

    // 실행 디렉터리 결정(설계 12.5). gitRepo 없으면 BadRequest.
    // 기본은 관리 clone base, worktree 모드면 이 세션 전용 worktree.
    const cwd = await this.resolveCwd(session.projectId, session.id, session.useWorktree);

    // 이미지는 멀티모달 블록으로 모델에 직접 보여준다.
    const images: { data: string; mediaType: string }[] = [];
    for (const a of attachments.filter((x) => x.kind === "image")) {
      try {
        images.push(await this.uploads.readAsBase64(a.relPath));
      } catch {
        /* 읽지 못한 이미지는 건너뛴다 */
      }
    }
    // 이미지를 포함한 모든 첨부를 실행 디렉터리에도 복사한다. 이미지는 위에서
    // 이미 보여주지만, 파일로도 있어야 에이전트가 도구로 다시 열거나 변환할 수 있다.
    const staged = await this.uploads.stageInto(cwd, attachments);
    const finalPrompt =
      staged.length > 0
        ? [
            prompt,
            "",
            `## 첨부 파일 (${staged.length}개)`,
            `작업 디렉터리의 \`${ATTACHMENT_DIR}/\` 안에 아래 파일이 있습니다.` +
              (images.length > 0
                ? " 첨부한 이미지도 이 안에 함께 있습니다."
                : ""),
            ...staged.map((n) => `- \`${ATTACHMENT_DIR}/${n}\``),
          ].join("\n")
        : prompt;

    await this.agent.runStream(
      session.projectId,
      {
        prompt: finalPrompt,
        images: images.length > 0 ? images : undefined,
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
    useWorktree: boolean;
    createdAt: Date;
    updatedAt: Date;
  }): ChatSessionDto {
    return {
      id: s.id,
      projectId: s.projectId,
      title: s.title,
      useWorktree: s.useWorktree,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    };
  }
}
