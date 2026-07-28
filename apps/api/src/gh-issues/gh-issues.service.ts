import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import type { Project } from "@prisma/client";
import type {
  GhComment,
  GhCreateIssueInput,
  GhIssue,
  GhIssueListQuery,
  GhIssueListResult,
  GhIssueState,
  GhLabel,
  GhMilestone,
  GhRepoInfo,
  GhUpdateIssueInput,
  GhUser,
} from "@claude-app/shared";
import { PrismaService } from "../prisma/prisma.service";
import { CryptoService } from "../crypto/crypto.service";
import { ProjectsService } from "../projects/projects.service";
import { GhApiClient } from "./gh-api.client";
import { GhImageProxyService, type ProxiedImage } from "./gh-image-proxy.service";

/**
 * GitHub Issue 뷰어 서비스 — GitHub 저장소의 이슈를 실시간으로 읽고 쓴다.
 *
 * ⚠️ 절대 규칙 — 에이전트 이슈 큐(IssuesService)와 완전히 별개다.
 * 여기서는 IssueTask 테이블을 읽거나 쓰지 않고, 에이전트를 실행하지 않으며,
 * GitHub 데이터를 DB에 저장하지 않는다(항상 실시간 프록시).
 * docs/rules/github-issue-separation.md 참고.
 */

/** GitHub REST 이슈 원본(필요한 필드만). */
interface RawIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  state_reason?: string | null;
  html_url: string;
  labels: Array<RawLabel | string>;
  user: RawUser | null;
  assignees?: RawUser[] | null;
  milestone?: RawMilestone | null;
  comments: number;
  locked?: boolean;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  pull_request?: unknown;
}

interface RawUser {
  login: string;
  avatar_url?: string | null;
  html_url?: string | null;
}

interface RawLabel {
  id: number;
  name: string;
  color: string;
  description?: string | null;
}

interface RawMilestone {
  number: number;
  title: string;
  state: string;
  due_on?: string | null;
}

interface RawComment {
  id: number;
  body: string | null;
  user: RawUser | null;
  html_url: string;
  created_at: string;
  updated_at: string;
}

const MAX_PER_PAGE = 100;
const DEFAULT_PER_PAGE = 25;

@Injectable()
export class GhIssuesService {
  private readonly logger = new Logger(GhIssuesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly projects: ProjectsService,
    private readonly gh: GhApiClient,
    private readonly images: GhImageProxyService,
  ) {}

  // ---- 공통: 프로젝트 → 저장소 · 토큰 해석 ----

  /** 읽기 권한 확인 후 저장소·토큰을 준비한다. */
  private async resolveRead(projectId: string, userId: string) {
    await this.projects.assertAccess(projectId, userId);
    return this.resolve(projectId);
  }

  /** 편집 권한(viewer 제외) 확인 후 저장소·토큰을 준비한다. 쓰기에는 토큰이 필수. */
  private async resolveWrite(projectId: string, userId: string) {
    await this.projects.assertCanEdit(projectId, userId);
    const ctx = await this.resolve(projectId);
    if (!ctx.token) {
      throw new BadRequestException(
        "프로젝트에 GitHub 토큰이 설정되어 있지 않아 쓰기 작업을 할 수 없습니다.",
      );
    }
    return { ...ctx, token: ctx.token };
  }

  private async resolve(projectId: string): Promise<{
    project: Project;
    owner: string;
    name: string;
    token: string | null;
  }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) throw new BadRequestException("프로젝트를 찾을 수 없습니다.");
    if (!project.gitRepo) {
      throw new BadRequestException(
        "프로젝트에 gitRepo가 설정되어 있지 않습니다. 프로젝트 설정에서 저장소를 연결하세요.",
      );
    }
    const { owner, name } = GhApiClient.parseRepo(project.gitRepo);
    return {
      project,
      owner,
      name,
      token: this.crypto.decryptOptional(project.gitTokenEnc),
    };
  }

  /** GitHub Issue 탭에 노출할 프로젝트(저장소가 연결된 것만). */
  async listRepoProjects(
    userId: string,
  ): Promise<Array<{ id: string; name: string; repo: string }>> {
    const ids = await this.projects.accessibleProjectIds(userId);
    const rows = await this.prisma.project.findMany({
      where: { id: { in: ids }, NOT: { gitRepo: null } },
      select: { id: true, name: true, gitRepo: true },
      orderBy: { name: "asc" },
    });
    return rows
      .filter((r) => r.gitRepo && r.gitRepo.trim().length > 0)
      .map((r) => ({ id: r.id, name: r.name, repo: r.gitRepo as string }));
  }

  // ---- 정규화 ----

  private toUser(raw: RawUser | null | undefined): GhUser | null {
    if (!raw) return null;
    return {
      login: raw.login,
      avatarUrl: raw.avatar_url ?? null,
      htmlUrl: raw.html_url ?? null,
    };
  }

  private toLabel(raw: RawLabel | string): GhLabel {
    if (typeof raw === "string") {
      return { id: 0, name: raw, color: "ededed", description: null };
    }
    return {
      id: raw.id,
      name: raw.name,
      color: raw.color || "ededed",
      description: raw.description ?? null,
    };
  }

  private toMilestone(raw: RawMilestone | null | undefined): GhMilestone | null {
    if (!raw) return null;
    return {
      number: raw.number,
      title: raw.title,
      state: raw.state === "closed" ? "closed" : "open",
      dueOn: raw.due_on ?? null,
    };
  }

  /** projectId는 본문 이미지의 서명 프록시 경로를 만드는 데 쓴다. */
  private toIssue(raw: RawIssue, projectId: string): GhIssue {
    const reason = raw.state_reason ?? null;
    return {
      number: raw.number,
      title: raw.title,
      body: raw.body ?? null,
      state: raw.state === "closed" ? "closed" : "open",
      stateReason:
        reason === "completed" || reason === "not_planned" || reason === "reopened"
          ? reason
          : null,
      htmlUrl: raw.html_url,
      labels: (raw.labels ?? []).map((l) => this.toLabel(l)),
      author: this.toUser(raw.user),
      assignees: (raw.assignees ?? []).map((u) => this.toUser(u)).filter(Boolean) as GhUser[],
      milestone: this.toMilestone(raw.milestone),
      comments: raw.comments ?? 0,
      locked: Boolean(raw.locked),
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      closedAt: raw.closed_at ?? null,
      imageMap: this.images.buildImageMap(projectId, raw.body ?? null),
    };
  }

  private toComment(raw: RawComment, projectId: string): GhComment {
    const body = raw.body ?? "";
    return {
      id: raw.id,
      body,
      author: this.toUser(raw.user),
      htmlUrl: raw.html_url,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
      imageMap: this.images.buildImageMap(projectId, body),
    };
  }

  // ---- 목록 ----

  /**
   * 이슈 목록. 검색어가 있으면 Search API(전문 검색), 없으면 저장소 issues API를 쓴다.
   * 두 경로 모두 PR을 제외하고 동일한 GhIssue 형태로 정규화한다.
   */
  async list(
    projectId: string,
    userId: string,
    query: GhIssueListQuery,
  ): Promise<GhIssueListResult> {
    const { owner, name, token } = await this.resolveRead(projectId, userId);
    const repo: GhRepoInfo = {
      owner,
      name,
      htmlUrl: `https://github.com/${owner}/${name}`,
    };

    const state = query.state ?? "open";
    const labels = (query.labels ?? []).filter((l) => l.trim().length > 0);
    const search = (query.q ?? "").trim();
    const sort = query.sort ?? "created";
    const direction = query.direction ?? "desc";
    const page = Math.max(1, query.page ?? 1);
    const perPage = Math.min(MAX_PER_PAGE, Math.max(1, query.perPage ?? DEFAULT_PER_PAGE));

    const [listed, counts] = await Promise.all([
      search
        ? this.searchIssues(owner, name, token, {
            projectId,
            state,
            labels,
            search,
            sort,
            direction,
            page,
            perPage,
          })
        : this.listRepoIssues(owner, name, token, {
            projectId,
            state,
            labels,
            sort,
            direction,
            page,
            perPage,
          }),
      this.stateCounts(owner, name, token, labels, search),
    ]);

    return { repo, ...listed, page, perPage, counts };
  }

  private async listRepoIssues(
    owner: string,
    name: string,
    token: string | null,
    opts: {
      projectId: string;
      state: string;
      labels: string[];
      sort: string;
      direction: string;
      page: number;
      perPage: number;
    },
  ): Promise<{ issues: GhIssue[]; hasNextPage: boolean }> {
    const params = new URLSearchParams({
      state: opts.state,
      sort: opts.sort,
      direction: opts.direction,
      per_page: String(opts.perPage),
      page: String(opts.page),
    });
    if (opts.labels.length > 0) params.set("labels", opts.labels.join(","));

    const { data, headers } = await this.gh.requestWithHeaders<RawIssue[]>(
      `/repos/${owner}/${name}/issues?${params.toString()}`,
      token,
    );
    // GitHub는 PR도 issues에 포함해 반환한다.
    const issues = data
      .filter((r) => !r.pull_request)
      .map((r) => this.toIssue(r, opts.projectId));
    return { issues, hasNextPage: GhApiClient.hasNextPage(headers) };
  }

  private async searchIssues(
    owner: string,
    name: string,
    token: string | null,
    opts: {
      projectId: string;
      state: string;
      labels: string[];
      search: string;
      sort: string;
      direction: string;
      page: number;
      perPage: number;
    },
  ): Promise<{ issues: GhIssue[]; hasNextPage: boolean }> {
    const q = this.buildSearchQuery(owner, name, {
      state: opts.state,
      labels: opts.labels,
      search: opts.search,
    });
    const params = new URLSearchParams({
      q,
      order: opts.direction,
      per_page: String(opts.perPage),
      page: String(opts.page),
    });
    // Search API의 sort는 comments/created/updated만 허용(기본은 best match).
    if (opts.sort) params.set("sort", opts.sort);

    const { data } = await this.gh.requestWithHeaders<{
      total_count: number;
      items: RawIssue[];
    }>(`/search/issues?${params.toString()}`, token);

    const issues = (data.items ?? []).map((r) => this.toIssue(r, opts.projectId));
    return {
      issues,
      hasNextPage: opts.page * opts.perPage < (data.total_count ?? 0),
    };
  }

  /** `repo:o/n type:issue [state:] [label:] [검색어]` 형태의 Search 질의를 만든다. */
  private buildSearchQuery(
    owner: string,
    name: string,
    opts: { state: string; labels: string[]; search?: string },
  ): string {
    const parts = [`repo:${owner}/${name}`, "type:issue"];
    if (opts.state === "open" || opts.state === "closed") {
      parts.push(`state:${opts.state}`);
    }
    for (const label of opts.labels) parts.push(`label:"${label}"`);
    if (opts.search) parts.push(opts.search);
    return parts.join(" ");
  }

  /**
   * 열림/닫힘 개수(GitHub 이슈 목록 상단의 "Open / Closed" 카운트).
   * Search API는 rate limit이 빡빡해 실패하면 null로 흘려보낸다(목록 자체는 살린다).
   */
  private async stateCounts(
    owner: string,
    name: string,
    token: string | null,
    labels: string[],
    search: string,
  ): Promise<{ open: number; closed: number } | null> {
    const count = async (state: GhIssueState): Promise<number> => {
      const q = this.buildSearchQuery(owner, name, { state, labels, search });
      const data = await this.gh.request<{ total_count: number }>(
        `/search/issues?q=${encodeURIComponent(q)}&per_page=1`,
        token,
      );
      return data.total_count ?? 0;
    };
    try {
      const [open, closed] = await Promise.all([count("open"), count("closed")]);
      return { open, closed };
    } catch (e) {
      this.logger.warn(
        `이슈 개수 조회 실패(${owner}/${name}): ${(e as Error).message}`,
      );
      return null;
    }
  }

  // ---- 상세 · 코멘트 ----

  async get(projectId: string, userId: string, number: number): Promise<GhIssue> {
    const { owner, name, token } = await this.resolveRead(projectId, userId);
    const raw = await this.gh.request<RawIssue>(
      `/repos/${owner}/${name}/issues/${number}`,
      token,
    );
    return this.toIssue(raw, projectId);
  }

  async listComments(
    projectId: string,
    userId: string,
    number: number,
  ): Promise<GhComment[]> {
    const { owner, name, token } = await this.resolveRead(projectId, userId);
    const raw = await this.gh.request<RawComment[]>(
      `/repos/${owner}/${name}/issues/${number}/comments?per_page=100`,
      token,
    );
    return raw.map((c) => this.toComment(c, projectId));
  }

  async addComment(
    projectId: string,
    userId: string,
    number: number,
    body: string,
  ): Promise<GhComment> {
    const text = body.trim();
    if (!text) throw new BadRequestException("코멘트 내용이 비어 있습니다.");
    const { owner, name, token } = await this.resolveWrite(projectId, userId);
    const raw = await this.gh.request<RawComment>(
      `/repos/${owner}/${name}/issues/${number}/comments`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      },
    );
    return this.toComment(raw, projectId);
  }

  async deleteComment(
    projectId: string,
    userId: string,
    commentId: number,
  ): Promise<void> {
    const { owner, name, token } = await this.resolveWrite(projectId, userId);
    await this.gh.request<void>(
      `/repos/${owner}/${name}/issues/comments/${commentId}`,
      token,
      { method: "DELETE" },
    );
  }

  // ---- 쓰기: 생성 · 수정 · 상태 · 라벨 ----

  async create(
    projectId: string,
    userId: string,
    input: GhCreateIssueInput,
  ): Promise<GhIssue> {
    const title = input.title.trim();
    if (!title) throw new BadRequestException("제목이 비어 있습니다.");
    const { owner, name, token } = await this.resolveWrite(projectId, userId);
    const raw = await this.gh.request<RawIssue>(
      `/repos/${owner}/${name}/issues`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          body: input.body ?? "",
          labels: input.labels ?? [],
          assignees: input.assignees ?? [],
        }),
      },
    );
    return this.toIssue(raw, projectId);
  }

  async update(
    projectId: string,
    userId: string,
    number: number,
    input: GhUpdateIssueInput,
  ): Promise<GhIssue> {
    const { owner, name, token } = await this.resolveWrite(projectId, userId);
    const payload: Record<string, unknown> = {};
    if (input.title !== undefined) payload.title = input.title;
    if (input.body !== undefined) payload.body = input.body;
    if (input.labels !== undefined) payload.labels = input.labels;
    if (input.state !== undefined) payload.state = input.state;
    if (input.stateReason !== undefined) payload.state_reason = input.stateReason;
    if (Object.keys(payload).length === 0) {
      throw new BadRequestException("변경할 내용이 없습니다.");
    }
    const raw = await this.gh.request<RawIssue>(
      `/repos/${owner}/${name}/issues/${number}`,
      token,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
    );
    return this.toIssue(raw, projectId);
  }

  /** 닫기/다시 열기. 닫을 때 사유(completed | not_planned)를 함께 보낼 수 있다. */
  async setState(
    projectId: string,
    userId: string,
    number: number,
    state: GhIssueState,
    stateReason?: "completed" | "not_planned",
  ): Promise<GhIssue> {
    return this.update(projectId, userId, number, {
      state,
      ...(state === "closed"
        ? { stateReason: stateReason ?? "completed" }
        : { stateReason: "reopened" }),
    });
  }

  /** 이슈 라벨을 지정 목록으로 덮어쓴다(PUT). */
  async setLabels(
    projectId: string,
    userId: string,
    number: number,
    labels: string[],
  ): Promise<GhLabel[]> {
    const { owner, name, token } = await this.resolveWrite(projectId, userId);
    const raw = await this.gh.request<RawLabel[]>(
      `/repos/${owner}/${name}/issues/${number}/labels`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels }),
      },
    );
    return raw.map((l) => this.toLabel(l));
  }

  /** 담당자 지정(기존 담당자를 지정 목록으로 교체). */
  async setAssignees(
    projectId: string,
    userId: string,
    number: number,
    assignees: string[],
  ): Promise<GhIssue> {
    const { owner, name, token } = await this.resolveWrite(projectId, userId);
    const current = await this.gh.request<RawIssue>(
      `/repos/${owner}/${name}/issues/${number}`,
      token,
    );
    const now = (current.assignees ?? []).map((u) => u.login);
    const remove = now.filter((l) => !assignees.includes(l));
    const add = assignees.filter((l) => !now.includes(l));

    if (remove.length > 0) {
      await this.gh.request<RawIssue>(
        `/repos/${owner}/${name}/issues/${number}/assignees`,
        token,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignees: remove }),
        },
      );
    }
    if (add.length > 0) {
      await this.gh.request<RawIssue>(
        `/repos/${owner}/${name}/issues/${number}/assignees`,
        token,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ assignees: add }),
        },
      );
    }
    return this.get(projectId, userId, number);
  }

  // ---- 이미지 프록시 ----

  /**
   * 서명된 프록시 요청을 검증하고 GitHub에서 이미지를 받아온다.
   *
   * <img>는 Authorization 헤더를 못 실으므로 JWT 대신 **서명**이 접근 제어다.
   * 서명은 인증된 이슈/코멘트 응답에서만 발급되고 projectId·URL·만료를 함께
   * 묶으므로, 서명 없이는 임의 URL을 프록시시킬 수 없다.
   */
  async proxyImage(
    projectId: string,
    encodedUrl: string,
    exp: number,
    sig: string,
  ): Promise<ProxiedImage> {
    const imageUrl = this.images.decodeUrlParam(encodedUrl);
    if (!this.images.verify(projectId, imageUrl, exp, sig)) {
      throw new ForbiddenException("유효하지 않거나 만료된 이미지 링크입니다.");
    }
    // 권한은 서명으로 이미 확인됐으므로 사용자 조회 없이 토큰만 꺼낸다.
    const { token } = await this.resolve(projectId);
    return this.images.fetchImage(imageUrl, token);
  }

  // ---- 저장소 메타(라벨·담당자 후보·마일스톤) ----

  async listRepoLabels(projectId: string, userId: string): Promise<GhLabel[]> {
    const { owner, name, token } = await this.resolveRead(projectId, userId);
    const raw = await this.gh.request<RawLabel[]>(
      `/repos/${owner}/${name}/labels?per_page=100`,
      token,
    );
    return raw.map((l) => this.toLabel(l));
  }

  /** 담당자로 지정 가능한 사용자. 권한이 없으면 빈 배열(화면은 계속 동작). */
  async listAssignableUsers(projectId: string, userId: string): Promise<GhUser[]> {
    const { owner, name, token } = await this.resolveRead(projectId, userId);
    try {
      const raw = await this.gh.request<RawUser[]>(
        `/repos/${owner}/${name}/assignees?per_page=100`,
        token,
      );
      return raw.map((u) => this.toUser(u)).filter(Boolean) as GhUser[];
    } catch (e) {
      this.logger.warn(`담당자 후보 조회 실패: ${(e as Error).message}`);
      return [];
    }
  }

  async listMilestones(projectId: string, userId: string): Promise<GhMilestone[]> {
    const { owner, name, token } = await this.resolveRead(projectId, userId);
    const raw = await this.gh.request<RawMilestone[]>(
      `/repos/${owner}/${name}/milestones?state=all&per_page=100`,
      token,
    );
    return raw.map((m) => this.toMilestone(m)).filter(Boolean) as GhMilestone[];
  }
}
