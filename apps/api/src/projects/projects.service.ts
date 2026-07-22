import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Project as PrismaProject, Visibility } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";
import type { Project as ProjectDto, ProjectVisibility } from "@claude-app/shared";
import { CreateProjectDto } from "./dto/create-project.dto";
import { UpdateProjectDto } from "./dto/update-project.dto";

const V_TO_PRISMA: Record<ProjectVisibility, Visibility> = {
  private: Visibility.PRIVATE,
  shared: Visibility.SHARED,
  public: Visibility.PUBLIC,
};
const V_TO_DTO: Record<Visibility, ProjectVisibility> = {
  PRIVATE: "private",
  SHARED: "shared",
  PUBLIC: "public",
};

function toPrismaVisibility(v?: ProjectVisibility): Visibility | undefined {
  return v ? V_TO_PRISMA[v] : undefined;
}

function toDtoVisibility(v: Visibility): ProjectVisibility {
  return V_TO_DTO[v];
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Prisma 레코드 → 시크릿을 뺀 API DTO */
  private toDto(p: PrismaProject): ProjectDto {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      cwd: p.cwd,
      model: p.model,
      allowedTools: p.allowedTools,
      gitRepo: p.gitRepo,
      gitBranch: p.gitBranch,
      anthropicBaseUrl: p.anthropicBaseUrl,
      ownerId: p.ownerId,
      visibility: toDtoVisibility(p.visibility),
      secrets: {
        hasAnthropicApiKey: Boolean(p.anthropicApiKeyEnc),
        hasGitToken: Boolean(p.gitTokenEnc),
      },
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  async list(ownerId?: string): Promise<ProjectDto[]> {
    const rows = await this.prisma.project.findMany({
      where: ownerId ? { ownerId } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string): Promise<ProjectDto> {
    return this.toDto(await this.getRaw(id));
  }

  /** 내부용: 원시 레코드(암호화 컬럼 포함) 반환 */
  async getRaw(id: string): Promise<PrismaProject> {
    const row = await this.prisma.project.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("프로젝트를 찾을 수 없습니다.");
    return row;
  }

  async create(dto: CreateProjectDto, ownerId?: string): Promise<ProjectDto> {
    const data: Prisma.ProjectCreateInput = {
      name: dto.name,
      description: dto.description,
      cwd: dto.cwd,
      model: dto.model,
      allowedTools: dto.allowedTools ?? [],
      gitRepo: dto.gitRepo,
      gitBranch: dto.gitBranch,
      gitTokenEnc: this.crypto.encryptOptional(dto.gitToken),
      anthropicApiKeyEnc: this.crypto.encryptOptional(dto.anthropicApiKey),
      anthropicBaseUrl: dto.anthropicBaseUrl,
      visibility: toPrismaVisibility(dto.visibility) ?? Visibility.PRIVATE,
      ...(ownerId ? { owner: { connect: { id: ownerId } } } : {}),
    };
    return this.toDto(await this.prisma.project.create({ data }));
  }

  async update(id: string, dto: UpdateProjectDto): Promise<ProjectDto> {
    await this.getRaw(id); // 존재 확인

    const data: Prisma.ProjectUpdateInput = {
      name: dto.name,
      description: dto.description,
      cwd: dto.cwd,
      model: dto.model,
      allowedTools: dto.allowedTools,
      gitRepo: dto.gitRepo,
      gitBranch: dto.gitBranch,
      anthropicBaseUrl: dto.anthropicBaseUrl,
      visibility: toPrismaVisibility(dto.visibility),
    };

    // 시크릿: undefined=유지, ""=삭제, 값=암호화 저장
    if (dto.gitToken !== undefined) {
      data.gitTokenEnc = dto.gitToken === "" ? null : this.crypto.encrypt(dto.gitToken);
    }
    if (dto.anthropicApiKey !== undefined) {
      data.anthropicApiKeyEnc =
        dto.anthropicApiKey === "" ? null : this.crypto.encrypt(dto.anthropicApiKey);
    }

    return this.toDto(await this.prisma.project.update({ where: { id }, data }));
  }

  async remove(id: string): Promise<void> {
    await this.getRaw(id);
    await this.prisma.project.delete({ where: { id } });
  }

  // ---- 스킬 / MCP 서버 연결 (M:N) ----

  async attachSkill(projectId: string, skillId: string): Promise<void> {
    await this.getRaw(projectId);
    await this.prisma.projectSkill.upsert({
      where: { projectId_skillId: { projectId, skillId } },
      create: { projectId, skillId },
      update: {},
    });
  }

  async detachSkill(projectId: string, skillId: string): Promise<void> {
    await this.prisma.projectSkill.deleteMany({ where: { projectId, skillId } });
  }

  async attachMcp(projectId: string, mcpServerId: string): Promise<void> {
    await this.getRaw(projectId);
    await this.prisma.projectMcpServer.upsert({
      where: { projectId_mcpServerId: { projectId, mcpServerId } },
      create: { projectId, mcpServerId },
      update: {},
    });
  }

  async detachMcp(projectId: string, mcpServerId: string): Promise<void> {
    await this.prisma.projectMcpServer.deleteMany({
      where: { projectId, mcpServerId },
    });
  }

  /** 에이전트 실행 계층에서 사용할 복호화된 자격증명 */
  async resolveSecrets(id: string): Promise<{
    anthropicApiKey: string | null;
    gitToken: string | null;
  }> {
    const p = await this.getRaw(id);
    return {
      anthropicApiKey: this.crypto.decryptOptional(p.anthropicApiKeyEnc),
      gitToken: this.crypto.decryptOptional(p.gitTokenEnc),
    };
  }
}
