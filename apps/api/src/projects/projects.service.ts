import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  Project as PrismaProject,
  Role,
  Visibility,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";
import type {
  Project as ProjectDto,
  ProjectVisibility,
  UserRole,
} from "@claude-app/shared";
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
const ROLE_TO_DTO: Record<Role, UserRole> = {
  OWNER: "owner",
  EDITOR: "editor",
  VIEWER: "viewer",
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

  private toDto(p: PrismaProject): ProjectDto {
    return {
      id: p.id,
      name: p.name,
      description: p.description,
      cwd: p.cwd,
      gitRepo: p.gitRepo,
      gitBranch: p.gitBranch,
      claudeAccountId: p.claudeAccountId,
      ownerId: p.ownerId,
      visibility: toDtoVisibility(p.visibility),
      secrets: {
        hasGitToken: Boolean(p.gitTokenEnc),
      },
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  // ---- 접근 제어 ----

  /** 사용자의 프로젝트 접근 권한(없으면 null). owner > editor > viewer. 전역 admin은 owner. */
  async getAccessRole(projectId: string, userId: string): Promise<UserRole | null> {
    const p = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { shares: { where: { userId } } },
    });
    if (!p) throw new NotFoundException("프로젝트를 찾을 수 없습니다.");
    if (p.ownerId === userId) return "owner";
    if (p.shares.length > 0) return ROLE_TO_DTO[p.shares[0].role];
    // 전역 admin은 모든 프로젝트에 owner 권한(전체 관리 — 사용자 결정)
    const actor = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (actor?.role === "ADMIN") return "owner";
    if (p.visibility === Visibility.PUBLIC) return "viewer";
    return null;
  }

  async assertAccess(projectId: string, userId: string): Promise<UserRole> {
    const role = await this.getAccessRole(projectId, userId);
    if (!role) throw new ForbiddenException("프로젝트에 접근 권한이 없습니다.");
    return role;
  }

  async assertCanEdit(projectId: string, userId: string): Promise<void> {
    const role = await this.assertAccess(projectId, userId);
    if (role === "viewer")
      throw new ForbiddenException("편집 권한이 없습니다. (viewer)");
  }

  async assertOwner(projectId: string, userId: string): Promise<void> {
    const role = await this.assertAccess(projectId, userId);
    if (role !== "owner") throw new ForbiddenException("소유자만 가능합니다.");
  }

  // ---- CRUD ----

  /** 전역 admin 여부 */
  private async isAdmin(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return u?.role === "ADMIN";
  }

  /** 소유·공유받은 프로젝트 목록 (admin은 전체) */
  async list(userId: string): Promise<ProjectDto[]> {
    const admin = await this.isAdmin(userId);
    const rows = await this.prisma.project.findMany({
      where: admin
        ? undefined
        : { OR: [{ ownerId: userId }, { shares: { some: { userId } } }] },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string, userId: string): Promise<ProjectDto> {
    await this.assertAccess(id, userId);
    return this.toDto(await this.getRaw(id));
  }

  /** 사용자가 접근 가능한 프로젝트 id 목록 (이슈/크론 스코프에 사용). admin은 전체. */
  async accessibleProjectIds(userId: string): Promise<string[]> {
    const admin = await this.isAdmin(userId);
    const rows = await this.prisma.project.findMany({
      where: admin
        ? undefined
        : { OR: [{ ownerId: userId }, { shares: { some: { userId } } }] },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** 내부용: 원시 레코드(암호화 컬럼 포함) */
  async getRaw(id: string): Promise<PrismaProject> {
    const row = await this.prisma.project.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("프로젝트를 찾을 수 없습니다.");
    return row;
  }

  /** 계정 id가 해당 사용자 소유인지 확인 (남의 계정 지정 방지) */
  private async assertOwnsAccount(
    accountId: string,
    userId: string,
  ): Promise<void> {
    const acc = await this.prisma.claudeAccount.findFirst({
      where: { id: accountId, userId },
    });
    if (!acc)
      throw new ForbiddenException("본인 소유의 Claude 계정만 지정할 수 있습니다.");
  }

  async create(dto: CreateProjectDto, ownerId: string): Promise<ProjectDto> {
    if (dto.claudeAccountId)
      await this.assertOwnsAccount(dto.claudeAccountId, ownerId);
    const data: Prisma.ProjectCreateInput = {
      name: dto.name,
      description: dto.description,
      cwd: dto.cwd,
      gitRepo: dto.gitRepo,
      gitBranch: dto.gitBranch,
      gitTokenEnc: this.crypto.encryptOptional(dto.gitToken),
      claudeAccount: dto.claudeAccountId
        ? { connect: { id: dto.claudeAccountId } }
        : undefined,
      visibility: toPrismaVisibility(dto.visibility) ?? Visibility.PRIVATE,
      owner: { connect: { id: ownerId } },
    };
    return this.toDto(await this.prisma.project.create({ data }));
  }

  async update(id: string, dto: UpdateProjectDto, userId: string): Promise<ProjectDto> {
    await this.assertCanEdit(id, userId);

    const data: Prisma.ProjectUpdateInput = {
      name: dto.name,
      description: dto.description,
      cwd: dto.cwd,
      gitRepo: dto.gitRepo,
      gitBranch: dto.gitBranch,
      visibility: toPrismaVisibility(dto.visibility),
    };
    if (dto.gitToken !== undefined) {
      data.gitTokenEnc = dto.gitToken === "" ? null : this.crypto.encrypt(dto.gitToken);
    }
    // "" → 해제(null), 값 → 소유 확인 후 지정
    if (dto.claudeAccountId !== undefined) {
      if (dto.claudeAccountId === "") {
        data.claudeAccount = { disconnect: true };
      } else {
        await this.assertOwnsAccount(dto.claudeAccountId, userId);
        data.claudeAccount = { connect: { id: dto.claudeAccountId } };
      }
    }
    return this.toDto(await this.prisma.project.update({ where: { id }, data }));
  }

  async remove(id: string, userId: string): Promise<void> {
    await this.assertOwner(id, userId);
    await this.prisma.project.delete({ where: { id } });
  }

  // ---- 스킬 / MCP 연결 (M:N) ----

  async listSkills(projectId: string, userId: string) {
    await this.assertAccess(projectId, userId);
    const links = await this.prisma.projectSkill.findMany({
      where: { projectId },
      include: { skill: true },
    });
    return links.map((l) => ({ id: l.skill.id, name: l.skill.name }));
  }

  async listMcp(projectId: string, userId: string) {
    await this.assertAccess(projectId, userId);
    const links = await this.prisma.projectMcpServer.findMany({
      where: { projectId },
      include: { server: true },
    });
    return links.map((l) => ({ id: l.server.id, name: l.server.name }));
  }

  async attachSkill(projectId: string, skillId: string, userId: string): Promise<void> {
    await this.assertCanEdit(projectId, userId);
    await this.prisma.projectSkill.upsert({
      where: { projectId_skillId: { projectId, skillId } },
      create: { projectId, skillId },
      update: {},
    });
  }

  async detachSkill(projectId: string, skillId: string, userId: string): Promise<void> {
    await this.assertCanEdit(projectId, userId);
    await this.prisma.projectSkill.deleteMany({ where: { projectId, skillId } });
  }

  async attachMcp(projectId: string, mcpServerId: string, userId: string): Promise<void> {
    await this.assertCanEdit(projectId, userId);
    await this.prisma.projectMcpServer.upsert({
      where: { projectId_mcpServerId: { projectId, mcpServerId } },
      create: { projectId, mcpServerId },
      update: {},
    });
  }

  async detachMcp(projectId: string, mcpServerId: string, userId: string): Promise<void> {
    await this.assertCanEdit(projectId, userId);
    await this.prisma.projectMcpServer.deleteMany({
      where: { projectId, mcpServerId },
    });
  }

  /** 에이전트 실행 계층에서 사용할 복호화된 자격증명 */
  async resolveSecrets(id: string): Promise<{ gitToken: string | null }> {
    const p = await this.getRaw(id);
    return {
      gitToken: this.crypto.decryptOptional(p.gitTokenEnc),
    };
  }
}
