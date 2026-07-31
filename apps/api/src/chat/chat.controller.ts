import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { IsArray, IsBoolean, IsOptional, IsString, MinLength } from "class-validator";
import { ChatService, type ChatAttachmentDto } from "./chat.service";
import type { AgentControl } from "../agent/agent.service";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { MAX_FILE_BYTES } from "../uploads/uploads.service";

class CreateSessionDto {
  /** fromIssueId로 만들 때는 이슈에서 프로젝트를 가져오므로 생략할 수 있다. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  projectId?: string;

  /**
   * 이 이슈의 실행 세션을 이어받아 대화를 시작한다(결정 대기 이슈 → 대화).
   * 지정하면 projectId는 무시하고 이슈의 프로젝트를 쓴다.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  fromIssueId?: string;

  /**
   * 전용 worktree(`chat/<세션id>` 브랜치)에서 실행할지.
   * 켜면 clone base를 건드리지 않고 격리된 작업 디렉터리를 쓴다.
   */
  @IsOptional()
  @IsBoolean()
  useWorktree?: boolean;
}

class SendMessageDto {
  @IsString()
  @MinLength(1)
  prompt!: string;

  /** 업로드 응답(`POST :id/attachments`)을 그대로 되돌려준 값. 서버가 재검증한다. */
  @IsOptional()
  @IsArray()
  attachments?: ChatAttachmentDto[];
}

@Controller("chat")
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get("sessions")
  listSessions(@CurrentUser() user: AuthUser) {
    return this.chat.listSessions(user.userId);
  }

  @Post("sessions")
  createSession(@Body() dto: CreateSessionDto, @CurrentUser() user: AuthUser) {
    if (!dto.projectId && !dto.fromIssueId)
      throw new BadRequestException("projectId 또는 fromIssueId가 필요합니다.");
    return this.chat.createSession(
      user.userId,
      dto.projectId ?? "",
      dto.fromIssueId,
      dto.useWorktree ?? false,
    );
  }

  @Get("sessions/:id")
  getSession(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.chat.getSession(user.userId, id);
  }

  @Delete("sessions/:id")
  async deleteSession(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    await this.chat.deleteSession(user.userId, id);
    return { ok: true };
  }

  /**
   * 세션에 첨부 업로드(이미지·파일 혼합, 다중). multipart field name: files
   * 응답의 첨부 목록을 그대로 다음 메시지 전송에 실어 보내면 된다.
   */
  @Post("sessions/:id/attachments")
  @UseInterceptors(
    FilesInterceptor("files", 10, { limits: { fileSize: MAX_FILE_BYTES } }),
  )
  uploadAttachments(
    @Param("id") id: string,
    @UploadedFiles()
    files: Array<{ buffer: Buffer; mimetype: string; originalname: string }>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.chat.uploadAttachments(user.userId, id, files ?? []);
  }

  /**
   * 메시지 전송 + SSE 스트리밍 응답.
   * 각 이벤트는 `data: <json>\n\n` 형식으로 흘려보낸다.
   */
  @Post("sessions/:id/messages")
  async sendMessage(
    @Param("id") id: string,
    @Body() dto: SendMessageDto,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // nginx 등 프록시 버퍼링 비활성
    res.flushHeaders?.();

    // 초기 주석 1회 — 헤더/연결 즉시 확립
    res.write(": connected\n\n");

    // 하트비트: 에이전트가 도구 실행 등으로 오래 침묵할 때 연결 유휴로 끊기는 것 방지
    // (ERR_CONNECTION_RESET 원인). SSE 주석 라인은 클라이언트가 무시한다.
    const heartbeat = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);

    // 클라이언트가 연결을 끊었는가. 끊긴 뒤 write는 무의미하므로 억제한다
    // (에이전트 실행은 계속되어 부분 응답 저장까지 마친다).
    let closed = false;
    const send = (data: unknown) => {
      if (closed) return;
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    // 실행 제어 핸들. 스트림이 열린 뒤 채워진다(resume 폴백 시 새 핸들로 교체).
    let control: AgentControl | undefined;

    // 프론트가 esc로 fetch를 중단하면 이 이벤트가 뜬다. abort(서브프로세스 kill)와
    // 달리 interrupt()는 턴만 끊어 지금까지의 부분 응답을 살린다.
    res.on("close", () => {
      closed = true;
      clearInterval(heartbeat);
      control?.interrupt().catch(() => {
        /* 이미 끝난 실행이면 무시 — 표시할 대상이 없다 */
      });
    });

    try {
      await this.chat.streamMessage(
        user.userId,
        id,
        dto.prompt,
        (e) => send(e),
        (c) => (control = c),
        dto.attachments,
      );
    } catch (err) {
      send({ type: "error", error: (err as Error).message });
    } finally {
      clearInterval(heartbeat);
      if (!closed) res.end();
    }
  }
}
