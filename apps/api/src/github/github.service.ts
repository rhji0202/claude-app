import { HttpException, Injectable } from "@nestjs/common";

const API_BASE = process.env.GITHUB_API_URL || "https://api.github.com";

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  labels: string[];
  author: string | null;
  isPullRequest: boolean;
  comments: number;
}

export interface GitHubComment {
  author: string | null;
  body: string;
}

/**
 * 프로젝트별 GitHub REST 클라이언트.
 * 토큰은 프로젝트 자격증명에서 복호화해 호출마다 주입한다(프로세스 전역 토큰 미사용).
 */
@Injectable()
export class GithubService {
  private headers(token: string | null): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "claude-management",
    };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  private async gh<T>(
    path: string,
    token: string | null,
    init?: RequestInit,
  ): Promise<T> {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { ...this.headers(token), ...(init?.headers ?? {}) },
      cache: "no-store",
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const data = (await res.json()) as { message?: string };
        if (data.message) detail = data.message;
      } catch {
        /* ignore */
      }
      throw new HttpException(`GitHub API ${res.status}: ${detail}`, res.status);
    }
    return (await res.json()) as T;
  }

  static parseRepo(repo: string): { owner: string; name: string } {
    // owner/repo, https://github.com/owner/repo(.git), git@github.com:owner/repo(.git) 모두 허용
    let s = repo.trim();
    s = s.replace(/^git@github\.com:/i, "");
    s = s.replace(/^https?:\/\/github\.com\//i, "");
    s = s.replace(/\.git$/i, "");
    s = s.replace(/\/$/, "");
    const parts = s.split("/").filter(Boolean);
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      throw new HttpException(
        `잘못된 저장소 형식: "${repo}" (owner/repo 또는 GitHub URL)`,
        400,
      );
    }
    // owner/repo만 취함 (URL에 추가 경로가 붙어도 앞 2개 사용)
    return { owner: parts[0], name: parts[1] };
  }

  /**
   * 이슈 body(마크다운/HTML)에서 이미지 URL을 추출한다.
   * `![alt](url)` 와 `<img src="url">` 모두 대상. GitHub 첨부/콘텐츠 도메인만.
   */
  static extractImageUrls(body: string | null | undefined): string[] {
    if (!body) return [];
    const urls = new Set<string>();
    const md = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
    const html = /<img[^>]+src=["'](https?:\/\/[^"']+)["']/gi;
    for (const re of [md, html]) {
      let m: RegExpExecArray | null;
      while ((m = re.exec(body))) urls.add(m[1]);
    }
    return [...urls].filter((u) =>
      /(user-attachments|githubusercontent\.com|github\.com\/.+\/assets\/)/.test(
        u,
      ),
    );
  }

  private normalize(raw: {
    number: number;
    title: string;
    body: string | null;
    html_url: string;
    labels: Array<{ name: string } | string>;
    user: { login: string } | null;
    pull_request?: unknown;
    comments: number;
  }): GitHubIssue {
    return {
      number: raw.number,
      title: raw.title,
      body: raw.body,
      html_url: raw.html_url,
      labels: (raw.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)),
      author: raw.user?.login ?? null,
      isPullRequest: Boolean(raw.pull_request),
      comments: raw.comments,
    };
  }

  async listIssues(
    repo: string,
    token: string | null,
    state: "open" | "closed" | "all" = "open",
  ): Promise<GitHubIssue[]> {
    const { owner, name } = GithubService.parseRepo(repo);
    const raw = await this.gh<Parameters<GithubService["normalize"]>[0][]>(
      `/repos/${owner}/${name}/issues?state=${state}&per_page=30`,
      token,
    );
    return raw.map((r) => this.normalize(r)).filter((i) => !i.isPullRequest);
  }

  async getIssue(
    repo: string,
    number: number,
    token: string | null,
  ): Promise<GitHubIssue> {
    const { owner, name } = GithubService.parseRepo(repo);
    const raw = await this.gh<Parameters<GithubService["normalize"]>[0]>(
      `/repos/${owner}/${name}/issues/${number}`,
      token,
    );
    return this.normalize(raw);
  }

  async listComments(
    repo: string,
    number: number,
    token: string | null,
  ): Promise<GitHubComment[]> {
    const { owner, name } = GithubService.parseRepo(repo);
    const raw = await this.gh<
      Array<{ user: { login: string } | null; body: string }>
    >(`/repos/${owner}/${name}/issues/${number}/comments?per_page=50`, token);
    return raw.map((c) => ({ author: c.user?.login ?? null, body: c.body }));
  }

  async createComment(
    repo: string,
    number: number,
    body: string,
    token: string,
  ): Promise<{ html_url: string }> {
    const { owner, name } = GithubService.parseRepo(repo);
    return this.gh<{ html_url: string }>(
      `/repos/${owner}/${name}/issues/${number}/comments`,
      token,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      },
    );
  }

  /**
   * 이슈 라벨을 지정한 목록으로 설정한다(PUT — 기존 라벨을 덮어쓴다).
   * triage 분류 결과 반영에 사용. 토큰에 이슈 쓰기 권한이 필요하다.
   */
  async setLabels(
    repo: string,
    number: number,
    labels: string[],
    token: string,
  ): Promise<string[]> {
    const { owner, name } = GithubService.parseRepo(repo);
    const raw = await this.gh<Array<{ name: string }>>(
      `/repos/${owner}/${name}/issues/${number}/labels`,
      token,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labels }),
      },
    );
    return raw.map((l) => l.name);
  }
}
