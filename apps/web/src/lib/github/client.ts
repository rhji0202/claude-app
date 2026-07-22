/**
 * 최소 GitHub REST 클라이언트.
 *
 * 앱 자체가 GitHub와 통신하는 통로(이슈 브라우징/가져오기/코멘트 작성).
 * 인증은 GITHUB_TOKEN 환경변수를 사용한다. (에이전트가 이슈를 "해결"하는 것과는 별개)
 */

const API_BASE = process.env.GITHUB_API_URL || "https://api.github.com";

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
  }
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  labels: string[];
  author: string | null;
  isPullRequest: boolean;
  comments: number;
  updatedAt: string;
}

export interface GitHubComment {
  author: string | null;
  body: string;
  createdAt: string;
}

/** GITHUB_TOKEN이 설정되어 있는지 여부 */
export function isConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

function headers(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "claude-management-app",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function gh<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { ...headers(), ...(init?.headers ?? {}) },
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
    throw new GitHubError(res.status, `GitHub API ${res.status}: ${detail}`);
  }
  return (await res.json()) as T;
}

/** "owner/repo" 문자열을 검증/분해 */
export function parseRepo(repo: string): { owner: string; name: string } {
  const parts = repo.trim().split("/");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new GitHubError(400, `잘못된 저장소 형식: "${repo}" (owner/repo 형식이어야 합니다)`);
  }
  return { owner: parts[0], name: parts[1] };
}

type RawIssue = {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  labels: Array<{ name: string } | string>;
  user: { login: string } | null;
  pull_request?: unknown;
  comments: number;
  updated_at: string;
};

function normalizeIssue(raw: RawIssue): GitHubIssue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    html_url: raw.html_url,
    state: raw.state,
    labels: (raw.labels ?? []).map((l) => (typeof l === "string" ? l : l.name)),
    author: raw.user?.login ?? null,
    isPullRequest: Boolean(raw.pull_request),
    comments: raw.comments,
    updatedAt: raw.updated_at,
  };
}

/** 저장소의 이슈 목록 (PR 제외) */
export async function listIssues(
  repo: string,
  opts: { state?: "open" | "closed" | "all"; perPage?: number } = {},
): Promise<GitHubIssue[]> {
  const { owner, name } = parseRepo(repo);
  const state = opts.state ?? "open";
  const perPage = opts.perPage ?? 30;
  const raw = await gh<RawIssue[]>(
    `/repos/${owner}/${name}/issues?state=${state}&per_page=${perPage}`,
  );
  return raw.map(normalizeIssue).filter((i) => !i.isPullRequest);
}

/** 이슈 상세 */
export async function getIssue(repo: string, number: number): Promise<GitHubIssue> {
  const { owner, name } = parseRepo(repo);
  const raw = await gh<RawIssue>(`/repos/${owner}/${name}/issues/${number}`);
  return normalizeIssue(raw);
}

/** 이슈 코멘트 목록 */
export async function listComments(
  repo: string,
  number: number,
): Promise<GitHubComment[]> {
  const { owner, name } = parseRepo(repo);
  const raw = await gh<
    Array<{ user: { login: string } | null; body: string; created_at: string }>
  >(`/repos/${owner}/${name}/issues/${number}/comments?per_page=50`);
  return raw.map((c) => ({
    author: c.user?.login ?? null,
    body: c.body,
    createdAt: c.created_at,
  }));
}

/** 이슈에 코멘트 작성 (외부 쓰기 작업) */
export async function createComment(
  repo: string,
  number: number,
  body: string,
): Promise<{ html_url: string }> {
  const { owner, name } = parseRepo(repo);
  return gh<{ html_url: string }>(
    `/repos/${owner}/${name}/issues/${number}/comments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    },
  );
}
