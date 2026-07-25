import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import type { Response } from "express";
import { FilesInterceptor } from "@nestjs/platform-express";
import { IssuesService } from "./issues.service";
import { IssueWorkerService } from "./issue-worker.service";
import { IssueEventsService } from "./issue-events.service";
import { CreateIssueTaskDto, UpdateIssueTaskDto } from "./issues.dto";
import { MAX_IMAGE_BYTES } from "../uploads/uploads.service";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { AdminOnly } from "../auth/admin.decorator";

@Controller("issues")
export class IssuesController {
  constructor(
    private readonly issues: IssuesService,
    private readonly worker: IssueWorkerService,
    private readonly events: IssueEventsService,
  ) {}

  @Get() list(
    @CurrentUser() user: AuthUser,
    @Query("projectId") projectId?: string,
  ) {
    return this.issues.list(user.userId, projectId);
  }

  // ---- 워커 현황 대시보드 (라우트 순서: :id보다 위에 둬야 정적 경로가 우선) ----

  @Get("stats")
  stats(@CurrentUser() user: AuthUser) {
    const { workerId, paused } = this.worker.runtime();
    return this.issues.stats(user.userId, { workerId, paused });
  }

  // 워커 제어는 프로세스 전역(모든 프로젝트/테넌트 영향) → admin만.
  @AdminOnly() @Post("worker/pause")
  pauseWorker() {
    this.worker.pause();
    return this.worker.runtime();
  }

  @AdminOnly() @Post("worker/resume")
  resumeWorker() {
    this.worker.resume();
    return this.worker.runtime();
  }

  @AdminOnly() @Post("worker/reclaim")
  async reclaimStale() {
    const reclaimed = await this.worker.forceReclaimStale();
    return { reclaimed };
  }

  /**
   * 이슈 실행 진행/상태 변화 SSE 스트림(폴링 대체).
   * 접근 가능한 프로젝트의 이벤트만 흘려보낸다. 각 이벤트는 `data: <json>\n\n`.
   * (라우트 순서상 :id보다 위에 둔다.)
   */
  @Get("stream")
  async stream(
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    // 연결 시점의 접근 가능 프로젝트로 이벤트를 필터(권한 스코프).
    const allowed = new Set(await this.issues.accessibleProjectIds(user.userId));

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    res.write(": connected\n\n");

    // 하트비트(연결 유휴로 끊김 방지). 채팅 SSE와 동일.
    const heartbeat = setInterval(() => res.write(": ping\n\n"), 15000);

    const unsubscribe = this.events.subscribe((e) => {
      if (!allowed.has(e.projectId)) return;
      res.write(`data: ${JSON.stringify(e)}\n\n`);
    });

    // 클라이언트 연결 종료 시 정리.
    res.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }

  @Post() create(@Body() dto: CreateIssueTaskDto, @CurrentUser() user: AuthUser) {
    return this.issues.create(dto, user.userId);
  }

  @Get(":id") get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.issues.get(id, user.userId);
  }

  @Patch(":id") update(
    @Param("id") id: string,
    @Body() dto: UpdateIssueTaskDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.issues.update(id, dto, user.userId);
  }

  @Delete(":id") async remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    await this.issues.remove(id, user.userId);
    return { ok: true };
  }

  // ---- GitHub 연동 / 실행 ----

  @Get("github/:projectId")
  githubIssues(
    @Param("projectId") projectId: string,
    @CurrentUser() user: AuthUser,
    @Query("state") state?: "open" | "closed" | "all",
  ) {
    return this.issues.listGithubIssues(projectId, user.userId, state ?? "open");
  }

  @Post("import")
  import(
    @Body() body: { projectId: string; numbers: number[] },
    @CurrentUser() user: AuthUser,
  ) {
    return this.issues.importIssues(body.projectId, body.numbers ?? [], user.userId);
  }

  /** 이슈에 이미지 첨부(다중). multipart field name: files */
  @Post(":id/images")
  @UseInterceptors(
    FilesInterceptor("files", 10, { limits: { fileSize: MAX_IMAGE_BYTES } }),
  )
  addImages(
    @Param("id") id: string,
    @UploadedFiles() files: Array<{ buffer: Buffer; mimetype: string }>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.issues.addImages(id, files ?? [], user.userId);
  }

  @Post("batch-run")
  batchRun(
    @Body() body: { ids: string[] },
    @CurrentUser() user: AuthUser,
  ) {
    return this.issues.batchRun(body.ids ?? [], user.userId);
  }

  @Post(":id/run")
  run(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.issues.startRun(id, user.userId);
  }

  @Post(":id/requeue")
  requeue(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.issues.requeue(id, user.userId);
  }

  @Get(":id/notes")
  notes(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.issues.listNotes(id, user.userId);
  }

  @Post(":id/notes")
  addNote(
    @Param("id") id: string,
    @Body() body: { content: string },
    @CurrentUser() user: AuthUser,
  ) {
    return this.issues.addHumanNote(id, body.content ?? "", user.userId);
  }

  @Post(":id/resume")
  resume(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.issues.resume(id, user.userId);
  }

  @Post(":id/comment")
  comment(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.issues.commentResult(id, user.userId);
  }
}
