import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { Project } from "@prisma/client";
import {
  IssueSource as PrismaSource,
  IssueStatus,
  IssueTask as PrismaIssue,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";
import { AgentService } from "../agent/agent.service";
import { GithubService } from "../github/github.service";
import { ProjectsService } from "../projects/projects.service";
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
  private readonly logger = new Logger(IssuesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly agent: AgentService,
    private readonly github: GithubService,
    private readonly projects: ProjectsService,
  ) {}

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

  async list(userId: string, projectId?: string): Promise<IssueDto[]> {
    if (projectId) {
      await this.projects.assertAccess(projectId, userId);
    }
    const ids = projectId
      ? [projectId]
      : await this.projects.accessibleProjectIds(userId);
    const rows = await this.prisma.issueTask.findMany({
      where: { projectId: { in: ids } },
      orderBy: { createdAt: "desc" },
    });
    return rows.map((r) => this.toDto(r));
  }

  async get(id: string, userId: string): Promise<IssueDto> {
    const task = await this.getRaw(id);
    await this.projects.assertAccess(task.projectId, userId);
    return this.toDto(task);
  }

  async getRaw(id: string): Promise<PrismaIssue> {
    const row = await this.prisma.issueTask.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("이슈 작업을 찾을 수 없습니다.");
    return row;
  }

  async create(dto: CreateIssueTaskDto, userId: string): Promise<IssueDto> {
    await this.projects.assertCanEdit(dto.projectId, userId);
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

  async update(id: string, dto: UpdateIssueTaskDto, userId: string): Promise<IssueDto> {
    const task = await this.getRaw(id);
    await this.projects.assertCanEdit(task.projectId, userId);
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

  async remove(id: string, userId: string): Promise<void> {
    const task = await this.getRaw(id);
    await this.projects.assertCanEdit(task.projectId, userId);
    await this.prisma.issueTask.delete({ where: { id } });
  }

  // ---- GitHub 연동 / 에이전트 실행 ----

  /** 프로젝트의 GitHub 토큰(복호화) 반환 */
  private tokenOf(project: Project): string | null {
    return this.crypto.decryptOptional(project.gitTokenEnc);
  }

  /** 저장소의 이슈를 실시간 조회 (프로젝트 토큰 사용) */
  async listGithubIssues(
    projectId: string,
    userId: string,
    state: "open" | "closed" | "all" = "open",
  ) {
    await this.projects.assertAccess(projectId, userId);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new BadRequestException("프로젝트를 찾을 수 없습니다.");
    if (!project.gitRepo)
      throw new BadRequestException("프로젝트에 gitRepo가 설정되어 있지 않습니다.");
    return this.github.listIssues(project.gitRepo, this.tokenOf(project), state);
  }

  /** 선택한 GitHub 이슈들을 큐로 가져온다 (중복 제외) */
  async importIssues(
    projectId: string,
    numbers: number[],
    userId: string,
  ): Promise<IssueDto[]> {
    await this.projects.assertCanEdit(projectId, userId);
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new BadRequestException("프로젝트를 찾을 수 없습니다.");
    if (!project.gitRepo)
      throw new BadRequestException("프로젝트에 gitRepo가 설정되어 있지 않습니다.");
    const token = this.tokenOf(project);
    const repo = project.gitRepo;

    const existing = await this.prisma.issueTask.findMany({
      where: { projectId, repo },
      select: { issueNumber: true },
    });
    const seen = new Set(existing.map((e) => e.issueNumber));

    const created: IssueDto[] = [];
    for (const number of numbers) {
      if (seen.has(number)) continue;
      const issue = await this.github.getIssue(repo, number, token);
      const row = await this.prisma.issueTask.create({
        data: {
          projectId,
          repo,
          issueNumber: number,
          title: issue.title,
          body: issue.body,
          url: issue.html_url,
          labels: issue.labels,
          author: issue.author,
          source: PrismaSource.GITHUB,
          status: IssueStatus.QUEUED,
        },
      });
      created.push(this.toDto(row));
    }
    return created;
  }

  /** GitHub 이슈 본문·코멘트를 가져와 에이전트 프롬프트를 구성 */
  private async buildPrompt(
    task: PrismaIssue,
    token: string | null,
  ): Promise<string> {
    const lines: string[] = [
      `GitHub 저장소 ${task.repo}의 이슈 ${task.issueNumber ? `#${task.issueNumber}` : ""} "${task.title}"를 해결해 주세요.`,
      "",
    ];
    let body = task.body ?? "";
    if (task.issueNumber && task.repo) {
      try {
        const issue = await this.github.getIssue(task.repo, task.issueNumber, token);
        body = issue.body ?? body;
        const comments = await this.github.listComments(
          task.repo,
          task.issueNumber,
          token,
        );
        if (comments.length > 0) {
          lines.push(`## 코멘트 (${comments.length}개)`);
          for (const c of comments.slice(0, 10)) {
            lines.push(`- @${c.author ?? "unknown"}: ${c.body}`);
          }
          lines.push("");
        }
      } catch (err) {
        this.logger.warn(`GitHub 조회 실패, 저장된 내용으로 진행: ${String(err)}`);
      }
    }
    if (task.labels.length > 0) lines.push(`라벨: ${task.labels.join(", ")}`, "");
    lines.push("## 이슈 본문", body || "(본문 없음)", "");
    lines.push(
      "## 작업 지시",
      "1. 이슈 내용을 파악하고 관련 코드를 조사합니다.",
      "2. 최소한의 변경으로 문제를 해결합니다.",
      "3. 변경한 파일과 이유를 요약합니다.",
    );
    if (task.prompt) lines.push("", "## 추가 지시", task.prompt);
    return lines.join("\n");
  }

  /** 이슈 작업을 에이전트로 실행한다. (백그라운드 처리, 즉시 running 상태 반환) */
  async startRun(id: string, userId: string): Promise<IssueDto> {
    const task = await this.getRaw(id);
    await this.projects.assertCanEdit(task.projectId, userId);
    const project = await this.prisma.project.findUnique({
      where: { id: task.projectId },
    });
    if (!project) {
      return this.toDto(
        await this.prisma.issueTask.update({
          where: { id },
          data: { status: IssueStatus.ERROR, error: "프로젝트를 찾을 수 없습니다." },
        }),
      );
    }
    await this.prisma.issueTask.update({
      where: { id },
      data: { status: IssueStatus.RUNNING, error: null },
    });
    // 백그라운드 실행 (HTTP 응답을 막지 않음). 큐 동시성은 AgentService가 제한.
    void this.executeRun(task, project).catch(async (err) => {
      this.logger.error(`이슈 실행 실패 ${id}: ${String(err)}`);
      await this.prisma.issueTask.update({
        where: { id },
        data: { status: IssueStatus.ERROR, error: String(err) },
      });
    });
    return this.get(id, userId);
  }

  private async executeRun(task: PrismaIssue, project: Project): Promise<void> {
    const token = this.tokenOf(project);
    const prompt = await this.buildPrompt(task, token);
    const res = await this.agent.run(project.id, {
      prompt,
      resume: task.sessionId ?? undefined,
      userId: project.ownerId ?? undefined,
      systemPrompt:
        "당신은 GitHub 이슈를 해결하는 소프트웨어 엔지니어입니다. 신중하게 분석하고 최소한의 변경으로 해결하세요.",
    });
    await this.prisma.issueTask.update({
      where: { id: task.id },
      data: {
        status: res.status === "ok" ? IssueStatus.DONE : IssueStatus.ERROR,
        sessionId: res.sessionId ?? task.sessionId,
        result: res.text,
        error: res.error ?? null,
      },
    });
  }

  /** 실행 결과를 GitHub 이슈에 코멘트로 게시 (외부 쓰기) */
  async commentResult(id: string, userId: string): Promise<IssueDto> {
    const task = await this.getRaw(id);
    await this.projects.assertCanEdit(task.projectId, userId);
    const project = await this.prisma.project.findUnique({
      where: { id: task.projectId },
    });
    if (!project) throw new BadRequestException("프로젝트를 찾을 수 없습니다.");
    const token = this.tokenOf(project);
    if (!token)
      throw new BadRequestException("프로젝트에 GitHub 토큰이 설정되어 있지 않습니다.");
    if (!task.issueNumber)
      throw new BadRequestException("수동 이슈에는 코멘트를 게시할 수 없습니다.");
    if (!task.result)
      throw new BadRequestException("먼저 이슈를 실행해 결과를 만드세요.");

    const body = `🤖 **Claude 에이전트 실행 결과**\n\n${task.result}`;
    const comment = await this.github.createComment(
      task.repo,
      task.issueNumber,
      body,
      token,
    );
    return this.toDto(
      await this.prisma.issueTask.update({
        where: { id },
        data: { resultCommentUrl: comment.html_url },
      }),
    );
  }
}
