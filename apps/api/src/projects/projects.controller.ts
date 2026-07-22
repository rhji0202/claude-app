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
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";

@Controller("projects")
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly agent: AgentService,
  ) {}

  @Get()
  list() {
    return this.projects.list();
  }

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create(dto);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.projects.get(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(id, dto);
  }

  @Delete(":id")
  async remove(@Param("id") id: string) {
    await this.projects.remove(id);
    return { ok: true };
  }

  // ---- 스킬 / MCP 연결 ----

  @Post(":id/skills")
  async attachSkill(@Param("id") id: string, @Body() body: { skillId: string }) {
    await this.projects.attachSkill(id, body.skillId);
    return { ok: true };
  }

  @Delete(":id/skills/:skillId")
  async detachSkill(@Param("id") id: string, @Param("skillId") skillId: string) {
    await this.projects.detachSkill(id, skillId);
    return { ok: true };
  }

  @Post(":id/mcp")
  async attachMcp(@Param("id") id: string, @Body() body: { mcpServerId: string }) {
    await this.projects.attachMcp(id, body.mcpServerId);
    return { ok: true };
  }

  @Delete(":id/mcp/:mcpServerId")
  async detachMcp(
    @Param("id") id: string,
    @Param("mcpServerId") mcpServerId: string,
  ) {
    await this.projects.detachMcp(id, mcpServerId);
    return { ok: true };
  }

  // ---- 임의 프롬프트 실행 ----

  /** POST /api/projects/:id/run { prompt, resume? } */
  @Post(":id/run")
  run(
    @Param("id") id: string,
    @Body() body: { prompt: string; resume?: string },
  ) {
    return this.agent.run(id, { prompt: body.prompt, resume: body.resume });
  }
}
