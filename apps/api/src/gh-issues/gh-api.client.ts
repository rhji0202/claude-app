import { HttpException, Injectable } from "@nestjs/common";

/**
 * GitHub Issue 뷰어 전용 REST 클라이언트.
 *
 * ⚠️ 절대 규칙 — 에이전트 이슈 큐가 쓰는 `src/github/github.service.ts`와
 * 의도적으로 분리된 클라이언트다. 한쪽 요구사항 때문에 다른 쪽을 수정하지 않기
 * 위해 코드 중복을 감수한다. docs/rules/github-issue-separation.md 참고.
 */

const API_BASE = process.env.GITHUB_API_URL || "https://api.github.com";

export interface GhRequestOptions extends RequestInit {
  /** 응답 헤더까지 필요할 때 사용 (Link 기반 페이지네이션). */
  withHeaders?: boolean;
}

export interface GhResponse<T> {
  data: T;
  headers: Headers;
}

@Injectable()
export class GhApiClient {
  /** owner/repo · GitHub URL · SSH 주소 모두 허용. */
  static parseRepo(repo: string): { owner: string; name: string } {
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
    return { owner: parts[0], name: parts[1] };
  }

  private headers(token: string | null, extra?: HeadersInit): Record<string, string> {
    const h: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "claude-app-gh-issues",
      ...(extra as Record<string, string> | undefined),
    };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  /** JSON 응답 본문만 반환. */
  async request<T>(
    path: string,
    token: string | null,
    init?: RequestInit,
  ): Promise<T> {
    const { data } = await this.requestWithHeaders<T>(path, token, init);
    return data;
  }

  /** 본문 + 응답 헤더(Link 등)를 함께 반환. */
  async requestWithHeaders<T>(
    path: string,
    token: string | null,
    init?: RequestInit,
  ): Promise<GhResponse<T>> {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: this.headers(token, init?.headers),
      cache: "no-store",
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = (await res.json()) as { message?: string };
        if (body.message) detail = body.message;
      } catch {
        /* 본문이 JSON이 아니면 statusText 사용 */
      }
      // 401/403은 프로젝트 토큰 문제인 경우가 대부분이라 안내를 덧붙인다.
      if (res.status === 401 || res.status === 403) {
        detail += " (프로젝트의 GitHub 토큰 권한을 확인하세요)";
      }
      throw new HttpException(`GitHub API ${res.status}: ${detail}`, res.status);
    }
    if (res.status === 204) {
      return { data: undefined as T, headers: res.headers };
    }
    return { data: (await res.json()) as T, headers: res.headers };
  }

  /** Link 헤더에 rel="next"가 있으면 다음 페이지가 존재한다. */
  static hasNextPage(headers: Headers): boolean {
    const link = headers.get("link");
    return Boolean(link && /rel="next"/.test(link));
  }
}
