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

@Controller("issues")
export class IssuesController {
  constructor(private readonly issues: IssuesService) {}

  @Get() list(@Query("projectId") projectId?: string) {
    return this.issues.list(projectId);
  }
  @Post() create(@Body() dto: CreateIssueTaskDto) {
    return this.issues.create(dto);
  }
  @Get(":id") get(@Param("id") id: string) {
    return this.issues.get(id);
  }
  @Patch(":id") update(@Param("id") id: string, @Body() dto: UpdateIssueTaskDto) {
    return this.issues.update(id, dto);
  }
  @Delete(":id") async remove(@Param("id") id: string) {
    await this.issues.remove(id);
    return { ok: true };
  }

  // ---- GitHub 연동 / 실행 ----

  /** 저장소 이슈 실시간 조회: GET /api/issues/github/:projectId?state=open */
  @Get("github/:projectId")
  githubIssues(
    @Param("projectId") projectId: string,
    @Query("state") state?: "open" | "closed" | "all",
  ) {
    return this.issues.listGithubIssues(projectId, state ?? "open");
  }

  /** 선택 이슈 가져오기: POST /api/issues/import { projectId, numbers } */
  @Post("import")
  import(@Body() body: { projectId: string; numbers: number[] }) {
    return this.issues.importIssues(body.projectId, body.numbers ?? []);
  }

  /** 에이전트 실행: POST /api/issues/:id/run */
  @Post(":id/run")
  run(@Param("id") id: string) {
    return this.issues.startRun(id);
  }

  /** 결과 코멘트 게시: POST /api/issues/:id/comment */
  @Post(":id/comment")
  comment(@Param("id") id: string) {
    return this.issues.commentResult(id);
  }
}
