import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  IssueSource as PrismaSource,
  IssueStatus,
  IssueTask as PrismaIssue,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
  IssueTask as IssueDto,
  IssueSource,
  IssueTaskStatus,
  ManualIssueReport,
} from "@claude-app/shared";
import { CreateIssueTaskDto, UpdateIssueTaskDto } from "./issues.dto";

const fromSource = (s: PrismaSource): IssueSource =>
  s === PrismaSource.MANUAL ? "manual" : "github";
const toSource = (s: IssueSource): PrismaSource =>
  s === "manual" ? PrismaSource.MANUAL : PrismaSource.GITHUB;
const STATUS_TO_DTO: Record<IssueStatus, IssueTaskStatus> = {
  QUEUED: "queued",
  RUNNING: "running",
  DONE: "done",
  ERROR: "error",
};
const fromStatus = (s: IssueStatus): IssueTaskStatus => STATUS_TO_DTO[s];

@Injectable()
export class IssuesService {
  constructor(private readonly prisma: PrismaService) {}

  private toDto(i: PrismaIssue): IssueDto {
    return {
      id: i.id,
      projectId: i.projectId,
      repo: i.repo,
      issueNumber: i.issueNumber,
      title: i.title,
      body: i.body,
      url: i.url,
      labels: i.labels,
      author: i.author,
      source: fromSource(i.source),
      prompt: i.prompt,
      status: fromStatus(i.status),
      sessionId: i.sessionId,
      result: i.result,
      error: i.error,
      resultCommentUrl: i.resultCommentUrl,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    };
  }

  async list(projectId?: string): Promise<IssueDto[]> {
    const rows = await this.prisma.issueTask.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string): Promise<IssueDto> {
    return this.toDto(await this.getRaw(id));
  }

  async getRaw(id: string): Promise<PrismaIssue> {
    const row = await this.prisma.issueTask.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("이슈 작업을 찾을 수 없습니다.");
    return row;
  }

  async create(dto: CreateIssueTaskDto): Promise<IssueDto> {
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId } });
    if (!project) throw new BadRequestException("프로젝트를 찾을 수 없습니다.");
    const row = await this.prisma.issueTask.create({
      data: {
        projectId: dto.projectId,
        repo: dto.repo,
        title: dto.title,
        body: dto.body,
        issueNumber: dto.issueNumber ?? null,
        labels: dto.labels ?? [],
        author: dto.author,
        prompt: dto.prompt,
        url: dto.url,
        source: toSource(dto.source ?? "manual"),
        status: IssueStatus.QUEUED,
      },
    });
    return this.toDto(row);
  }

  /**
   * 공유 링크(테스터)를 통한 수동 이슈 등록. 프로젝트 id로 repo를 자동 채운다.
   */
  async createFromReport(
    projectId: string,
    report: ManualIssueReport,
  ): Promise<IssueDto> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new BadRequestException("프로젝트를 찾을 수 없습니다.");
    const row = await this.prisma.issueTask.create({
      data: {
        projectId,
        repo: project.gitRepo ?? "",
        title: report.title,
        body: report.body,
        labels: report.labels ?? [],
        author: report.reporter,
        source: PrismaSource.MANUAL,
        status: IssueStatus.QUEUED,
      },
    });
    return this.toDto(row);
  }

  async update(id: string, dto: UpdateIssueTaskDto): Promise<IssueDto> {
    await this.getRaw(id);
    const row = await this.prisma.issueTask.update({
      where: { id },
      data: {
        title: dto.title,
        body: dto.body,
        labels: dto.labels,
        prompt: dto.prompt,
      },
    });
    return this.toDto(row);
  }

  async remove(id: string): Promise<void> {
    await this.getRaw(id);
    await this.prisma.issueTask.delete({ where: { id } });
  }
}
