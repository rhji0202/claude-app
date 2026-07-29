import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { IsString, MinLength } from "class-validator";
import { ChatService } from "./chat.service";
import type { AgentControl } from "../agent/agent.service";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";

class CreateSessionDto {
  @IsString()
  @MinLength(1)
  projectId!: string;
}

class SendMessageDto {
  @IsString()
  @MinLength(1)
  prompt!: string;
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
    return this.chat.createSession(user.userId, dto.projectId);
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
      );
    } catch (err) {
      send({ type: "error", error: (err as Error).message });
    } finally {
      clearInterval(heartbeat);
      if (!closed) res.end();
    }
  }
}
