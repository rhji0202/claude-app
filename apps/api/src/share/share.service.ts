import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Role, ShareLinkScope as PrismaScope } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { IssuesService } from "../issues/issues.service";
import type { ShareLinkScope, UserRole } from "@claude-app/shared";
import { AddShareDto, CreateShareLinkDto, ReportIssueDto } from "./share.dto";

const ROLE_TO_PRISMA: Record<Exclude<UserRole, "owner">, Role> = {
  viewer: Role.VIEWER,
  editor: Role.EDITOR,
};
const SCOPE_TO_PRISMA: Record<ShareLinkScope, PrismaScope> = {
  read: PrismaScope.READ,
  issue_report: PrismaScope.ISSUE_REPORT,
};
const SCOPE_TO_DTO: Record<PrismaScope, ShareLinkScope> = {
  READ: "read",
  ISSUE_REPORT: "issue_report",
};

@Injectable()
export class ShareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly issues: IssuesService,
  ) {}

  // ---- 팀 공유 ----

  async addShare(projectId: string, ownerId: string, dto: AddShareDto) {
    await this.projects.assertOwner(projectId, ownerId);
    const target = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!target) throw new NotFoundException("해당 이메일의 사용자가 없습니다.");
    await this.prisma.projectShare.upsert({
      where: { projectId_userId: { projectId, userId: target.id } },
      create: { projectId, userId: target.id, role: ROLE_TO_PRISMA[dto.role] },
      update: { role: ROLE_TO_PRISMA[dto.role] },
    });
    return { ok: true };
  }

  async listShares(projectId: string, userId: string) {
    await this.projects.assertAccess(projectId, userId);
    const shares = await this.prisma.projectShare.findMany({
      where: { projectId },
      include: { user: true },
    });
    return shares.map((s) => ({
      userId: s.userId,
      email: s.user.email,
      name: s.user.name,
      role: s.role.toLowerCase() as UserRole,
    }));
  }

  async removeShare(projectId: string, ownerId: string, targetUserId: string) {
    await this.projects.assertOwner(projectId, ownerId);
    await this.prisma.projectShare.deleteMany({
      where: { projectId, userId: targetUserId },
    });
    return { ok: true };
  }

  // ---- 공유 링크 ----

  async createLink(projectId: string, userId: string, dto: CreateShareLinkDto) {
    await this.projects.assertCanEdit(projectId, userId);
    const token = randomBytes(32).toString("base64url");
    const link = await this.prisma.shareLink.create({
      data: {
        projectId,
        token,
        scope: SCOPE_TO_PRISMA[dto.scope],
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      },
    });
    return {
      id: link.id,
      token: link.token,
      scope: SCOPE_TO_DTO[link.scope],
      expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
      // 프론트에서 사용할 경로 (WEB_ORIGIN + 이 경로)
      path: `/share/${link.token}`,
    };
  }

  async listLinks(projectId: string, userId: string) {
    await this.projects.assertAccess(projectId, userId);
    const links = await this.prisma.shareLink.findMany({ where: { projectId } });
    return links.map((l) => ({
      id: l.id,
      token: l.token,
      scope: SCOPE_TO_DTO[l.scope],
      expiresAt: l.expiresAt ? l.expiresAt.toISOString() : null,
      createdAt: l.createdAt.toISOString(),
    }));
  }

  async revokeLink(linkId: string, userId: string) {
    const link = await this.prisma.shareLink.findUnique({ where: { id: linkId } });
    if (!link) throw new NotFoundException("공유 링크를 찾을 수 없습니다.");
    await this.projects.assertCanEdit(link.projectId, userId);
    await this.prisma.shareLink.delete({ where: { id: linkId } });
    return { ok: true };
  }

  // ---- 공개(비로그인) 접근 ----

  private async resolveToken(token: string) {
    const link = await this.prisma.shareLink.findUnique({ where: { token } });
    if (!link) throw new NotFoundException("유효하지 않은 공유 링크입니다.");
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException("만료된 공유 링크입니다.");
    }
    return link;
  }

  /** 공유 링크로 프로젝트를 읽기 전용으로 조회 (시크릿·cwd 등 민감정보 제외) */
  async publicView(token: string) {
    const link = await this.resolveToken(token);
    const project = await this.prisma.project.findUnique({
      where: { id: link.projectId },
    });
    if (!project) throw new NotFoundException("프로젝트를 찾을 수 없습니다.");
    const issues = await this.prisma.issueTask.findMany({
      where: { projectId: link.projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        source: true,
        issueNumber: true,
        createdAt: true,
      },
    });
    return {
      scope: SCOPE_TO_DTO[link.scope],
      canReport: link.scope === PrismaScope.ISSUE_REPORT,
      project: {
        id: project.id,
        name: project.name,
        description: project.description,
        gitRepo: project.gitRepo,
      },
      issues: issues.map((i) => ({
        id: i.id,
        title: i.title,
        status: i.status.toLowerCase(),
        source: i.source.toLowerCase(),
        issueNumber: i.issueNumber,
        createdAt: i.createdAt.toISOString(),
      })),
    };
  }

  /** 테스터가 공유 링크로 이슈를 수동 등록 (scope=issue_report 필요) */
  async reportIssue(token: string, dto: ReportIssueDto) {
    const link = await this.resolveToken(token);
    if (link.scope !== PrismaScope.ISSUE_REPORT) {
      throw new BadRequestException("이슈 등록 권한이 없는 링크입니다.");
    }
    const issue = await this.issues.createFromReport(link.projectId, {
      title: dto.title,
      body: dto.body,
      labels: dto.labels,
      reporter: dto.reporter,
    });
    // 테스터에게는 최소 정보만 반환
    return { ok: true, id: issue.id, title: issue.title };
  }
}
