import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { IssuesService } from "./issues.service";
import { IssueWorkerService } from "./issue-worker.service";
import { CreateIssueTaskDto, UpdateIssueTaskDto } from "./issues.dto";
import { MAX_IMAGE_BYTES } from "../uploads/uploads.service";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";

@Controller("issues")
export class IssuesController {
  constructor(
    private readonly issues: IssuesService,
    private readonly worker: IssueWorkerService,
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

  @Post("worker/pause")
  pauseWorker() {
    this.worker.pause();
    return this.worker.runtime();
  }

  @Post("worker/resume")
  resumeWorker() {
    this.worker.resume();
    return this.worker.runtime();
  }

  @Post("worker/reclaim")
  async reclaimStale() {
    const reclaimed = await this.worker.forceReclaimStale();
    return { reclaimed };
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
