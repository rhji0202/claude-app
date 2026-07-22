import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { IssuesService } from "./issues.service";
import { CreateIssueTaskDto, UpdateIssueTaskDto } from "./issues.dto";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";

@Controller("issues")
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Get() list(
    @CurrentUser() user: AuthUser,
    @Query("projectId") projectId?: string,
  ) {
    return this.issues.list(user.userId, projectId);
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

  @Post(":id/run")
  run(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.issues.startRun(id, user.userId);
  }

  @Post(":id/comment")
  comment(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.issues.commentResult(id, user.userId);
  }
}
