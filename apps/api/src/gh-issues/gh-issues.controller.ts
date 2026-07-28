import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { GhIssuesService } from "./gh-issues.service";
import {
  CreateGhCommentDto,
  CreateGhIssueDto,
  GhImageQueryDto,
  ListGhIssuesQueryDto,
  SetGhAssigneesDto,
  SetGhIssueStateDto,
  SetGhLabelsDto,
  UpdateGhIssueDto,
} from "./gh-issues.dto";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";

/**
 * GitHub Issue 뷰어 API (`/api/gh-issues/...`).
 *
 * ⚠️ 절대 규칙 — 에이전트 이슈 큐 API(`/api/issues/...`)와 완전히 분리된
 * 네임스페이스다. 두 컨트롤러는 서로의 라우트·서비스를 호출하지 않는다.
 * docs/rules/github-issue-separation.md 참고.
 *
 * 라우트 순서: 정적 세그먼트(`projects`, `:projectId/labels` 등)를
 * `:projectId/:number`보다 먼저 선언해야 숫자가 아닌 경로가 가로채이지 않는다.
 */
@Controller("gh-issues")
export class GhIssuesController {
  constructor(private readonly service: GhIssuesService) {}

  /** 저장소가 연결된 접근 가능 프로젝트(= 프로젝트 탭 목록). */
  @Get("projects")
  projects(@CurrentUser() user: AuthUser) {
    return this.service.listRepoProjects(user.userId);
  }

  /**
   * 이슈 본문·코멘트의 GitHub 첨부 이미지 프록시.
   *
   * GitHub 첨부는 인증을 요구해 브라우저가 직접 열면 404/403이 난다.
   * <img>에 Authorization 헤더를 실을 수 없으므로 JWT 가드를 우회(@Public)하고,
   * 대신 인증된 응답에서 발급한 **서명(u·exp·sig)** 으로 접근을 통제한다.
   */
  @Public()
  @Get(":projectId/image")
  async image(
    @Param("projectId") projectId: string,
    @Query() query: GhImageQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { body, contentType } = await this.service.proxyImage(
      projectId,
      query.u,
      query.exp,
      query.sig,
    );
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", String(body.byteLength));
    // 서명 만료(1h)와 맞춘 사설 캐시. 공용 캐시에는 올리지 않는다.
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.end(body);
  }

  // ---- 저장소 메타 ----

  @Get(":projectId/labels")
  labels(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    return this.service.listRepoLabels(projectId, user.userId);
  }

  @Get(":projectId/assignees")
  assignees(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    return this.service.listAssignableUsers(projectId, user.userId);
  }

  @Get(":projectId/milestones")
  milestones(@Param("projectId") projectId: string, @CurrentUser() user: AuthUser) {
    return this.service.listMilestones(projectId, user.userId);
  }

  @Delete(":projectId/comments/:commentId")
  async removeComment(
    @Param("projectId") projectId: string,
    @Param("commentId", ParseIntPipe) commentId: number,
    @CurrentUser() user: AuthUser,
  ) {
    await this.service.deleteComment(projectId, user.userId, commentId);
    return { ok: true };
  }

  // ---- 이슈 목록 · 생성 ----

  @Get(":projectId")
  list(
    @Param("projectId") projectId: string,
    @Query() query: ListGhIssuesQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.list(projectId, user.userId, query);
  }

  @Post(":projectId")
  create(
    @Param("projectId") projectId: string,
    @Body() dto: CreateGhIssueDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.create(projectId, user.userId, dto);
  }

  // ---- 이슈 상세 ----

  @Get(":projectId/:number")
  get(
    @Param("projectId") projectId: string,
    @Param("number", ParseIntPipe) number: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.get(projectId, user.userId, number);
  }

  @Patch(":projectId/:number")
  update(
    @Param("projectId") projectId: string,
    @Param("number", ParseIntPipe) number: number,
    @Body() dto: UpdateGhIssueDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.update(projectId, user.userId, number, dto);
  }

  @Post(":projectId/:number/state")
  setState(
    @Param("projectId") projectId: string,
    @Param("number", ParseIntPipe) number: number,
    @Body() dto: SetGhIssueStateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setState(
      projectId,
      user.userId,
      number,
      dto.state,
      dto.stateReason,
    );
  }

  @Put(":projectId/:number/labels")
  setLabels(
    @Param("projectId") projectId: string,
    @Param("number", ParseIntPipe) number: number,
    @Body() dto: SetGhLabelsDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setLabels(projectId, user.userId, number, dto.labels);
  }

  @Put(":projectId/:number/assignees")
  setAssignees(
    @Param("projectId") projectId: string,
    @Param("number", ParseIntPipe) number: number,
    @Body() dto: SetGhAssigneesDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.setAssignees(projectId, user.userId, number, dto.assignees);
  }

  // ---- 코멘트 ----

  @Get(":projectId/:number/comments")
  comments(
    @Param("projectId") projectId: string,
    @Param("number", ParseIntPipe) number: number,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.listComments(projectId, user.userId, number);
  }

  @Post(":projectId/:number/comments")
  addComment(
    @Param("projectId") projectId: string,
    @Param("number", ParseIntPipe) number: number,
    @Body() dto: CreateGhCommentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.addComment(projectId, user.userId, number, dto.body);
  }
}
