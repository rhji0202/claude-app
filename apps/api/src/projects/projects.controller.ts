import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from "@nestjs/common";
import { ProjectsService } from "./projects.service";
import { AgentService } from "../agent/agent.service";
import { RepoManagerService } from "../repo/repo-manager.service";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";
import { CurrentUser, type AuthUser } from "../auth/current-user.decorator";

@Controller("projects")
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly agent: AgentService,
    private readonly repos: RepoManagerService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.projects.list(user.userId);
  }

  @Post()
  create(@Body() dto: CreateProjectDto, @CurrentUser() user: AuthUser) {
    return this.projects.create(dto, user.userId);
  }

  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.projects.get(id, user.userId);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateProjectDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.projects.update(id, dto, user.userId);
  }

  @Delete(":id")
  async remove(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    await this.projects.remove(id, user.userId);
    return { ok: true };
  }

  // ---- 스킬 / MCP 연결 ----

  @Get(":id/skills")
  listSkills(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.projects.listSkills(id, user.userId);
  }

  @Get(":id/mcp")
  listMcp(@Param("id") id: string, @CurrentUser() user: AuthUser) {
    return this.projects.listMcp(id, user.userId);
  }

  @Post(":id/skills")
  async attachSkill(
    @Param("id") id: string,
    @Body() body: { skillId: string },
    @CurrentUser() user: AuthUser,
  ) {
    await this.projects.attachSkill(id, body.skillId, user.userId);
    return { ok: true };
  }

  @Delete(":id/skills/:skillId")
  async detachSkill(
    @Param("id") id: string,
    @Param("skillId") skillId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.projects.detachSkill(id, skillId, user.userId);
    return { ok: true };
  }

  @Post(":id/mcp")
  async attachMcp(
    @Param("id") id: string,
    @Body() body: { mcpServerId: string },
    @CurrentUser() user: AuthUser,
  ) {
    await this.projects.attachMcp(id, body.mcpServerId, user.userId);
    return { ok: true };
  }

  @Delete(":id/mcp/:mcpServerId")
  async detachMcp(
    @Param("id") id: string,
    @Param("mcpServerId") mcpServerId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.projects.detachMcp(id, mcpServerId, user.userId);
    return { ok: true };
  }

  // ---- 임의 프롬프트 실행 ----

  /** POST /api/projects/:id/run { prompt, resume? } */
  @Post(":id/run")
  async run(
    @Param("id") id: string,
    @Body() body: { prompt: string; resume?: string },
    @CurrentUser() user: AuthUser,
  ) {
    await this.projects.assertCanEdit(id, user.userId);
    // 실행 디렉터리: 관리 clone base(설계 12.5). gitRepo 없으면 BadRequest.
    const cwd = await this.repos.prepareForProject(id);
    return this.agent.run(id, {
      prompt: body.prompt,
      resume: body.resume,
      userId: user.userId,
      cwd,
    });
  }
}
