import { BadRequestException, ForbiddenException, HttpException } from "@nestjs/common";
import { GhApiClient } from "./gh-api.client";
import { GhImageProxyService } from "./gh-image-proxy.service";
import { GhIssuesService } from "./gh-issues.service";

/**
 * GitHub Issue 뷰어 서비스 테스트.
 * ⚠️ 에이전트 이슈 큐(issues.service.spec.ts)와 별개 기능
 * (docs/rules/github-issue-separation.md).
 */

describe("GhApiClient.parseRepo", () => {
  it("owner/repo · URL · SSH 형식을 모두 파싱한다", () => {
    expect(GhApiClient.parseRepo("acme/widget")).toEqual({
      owner: "acme",
      name: "widget",
    });
    expect(GhApiClient.parseRepo("https://github.com/acme/widget.git")).toEqual({
      owner: "acme",
      name: "widget",
    });
    expect(GhApiClient.parseRepo("git@github.com:acme/widget.git")).toEqual({
      owner: "acme",
      name: "widget",
    });
  });

  it("형식이 잘못되면 400", () => {
    expect(() => GhApiClient.parseRepo("onlyone")).toThrow(HttpException);
  });
});

describe("GhIssuesService", () => {
  /** gh 클라이언트 호출을 기록하는 스텁. */
  function makeService(opts?: {
    gitRepo?: string | null;
    token?: string | null;
    responses?: Record<string, unknown>;
  }) {
    const calls: Array<{ path: string; init?: RequestInit }> = [];
    const responses = opts?.responses ?? {};

    const pick = (path: string): unknown => {
      const key = Object.keys(responses).find((k) => path.startsWith(k));
      return key ? responses[key] : undefined;
    };

    const gh = {
      request: jest.fn(async (path: string, _t: unknown, init?: RequestInit) => {
        calls.push({ path, init });
        return pick(path);
      }),
      requestWithHeaders: jest.fn(
        async (path: string, _t: unknown, init?: RequestInit) => {
          calls.push({ path, init });
          return { data: pick(path), headers: new Headers() };
        },
      ),
    };

    const prisma = {
      project: {
        findUnique: jest.fn(async () => ({
          id: "p1",
          name: "프로젝트",
          gitRepo: opts?.gitRepo === undefined ? "acme/widget" : opts.gitRepo,
          gitTokenEnc: "enc",
        })),
        findMany: jest.fn(async () => [
          { id: "p1", name: "프로젝트", gitRepo: "acme/widget" },
          { id: "p2", name: "저장소 없음", gitRepo: "   " },
        ]),
      },
    };

    const crypto = {
      decryptOptional: jest.fn(() =>
        opts?.token === undefined ? "ghp_token" : opts.token,
      ),
    };

    const projects = {
      assertAccess: jest.fn(async () => "owner"),
      assertCanEdit: jest.fn(async () => undefined),
      accessibleProjectIds: jest.fn(async () => ["p1", "p2"]),
    };

    // 이미지 프록시는 실제 구현을 쓴다(서명 생성·검증까지 함께 검증하기 위해).
    const images = new GhImageProxyService({
      get: () => "test-encryption-key",
    } as never);

    const service = new GhIssuesService(
      prisma as never,
      crypto as never,
      projects as never,
      gh as never,
      images,
    );
    return { service, calls, gh, projects, images };
  }

  const rawIssue = (over: Record<string, unknown> = {}) => ({
    number: 1,
    title: "버그",
    body: "본문",
    state: "open",
    html_url: "https://github.com/acme/widget/issues/1",
    labels: [{ id: 10, name: "bug", color: "d73a4a", description: null }],
    user: { login: "alice", avatar_url: "a.png", html_url: "u" },
    assignees: [{ login: "bob" }],
    comments: 2,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    closed_at: null,
    ...over,
  });

  it("목록은 PR을 제외하고 정규화한다", async () => {
    const { service } = makeService({
      responses: {
        "/repos/acme/widget/issues": [
          rawIssue(),
          rawIssue({ number: 2, pull_request: {} }),
        ],
        "/search/issues": { total_count: 3, items: [] },
      },
    });

    const result = await service.list("p1", "u1", {});
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({
      number: 1,
      state: "open",
      comments: 2,
    });
    expect(result.issues[0].labels[0].name).toBe("bug");
    expect(result.issues[0].assignees[0].login).toBe("bob");
    expect(result.repo).toEqual({
      owner: "acme",
      name: "widget",
      htmlUrl: "https://github.com/acme/widget",
    });
  });

  it("기본 상태는 open이며 라벨 필터를 쿼리에 싣는다", async () => {
    const { service, calls } = makeService({
      responses: {
        "/repos/acme/widget/issues": [],
        "/search/issues": { total_count: 0, items: [] },
      },
    });

    await service.list("p1", "u1", { labels: ["bug", "p1"] });
    const listCall = calls.find((c) => c.path.startsWith("/repos/"));
    expect(listCall?.path).toContain("state=open");
    expect(listCall?.path).toContain("labels=bug%2Cp1");
  });

  it("closed 상태도 조회할 수 있다", async () => {
    const { service, calls } = makeService({
      responses: {
        "/repos/acme/widget/issues": [],
        "/search/issues": { total_count: 0, items: [] },
      },
    });

    await service.list("p1", "u1", { state: "closed" });
    const listCall = calls.find((c) => c.path.startsWith("/repos/"));
    expect(listCall?.path).toContain("state=closed");
  });

  it("검색어가 있으면 Search API를 쓰고 repo·type 한정자를 붙인다", async () => {
    const { service, calls } = makeService({
      responses: { "/search/issues": { total_count: 1, items: [rawIssue()] } },
    });

    const result = await service.list("p1", "u1", { q: "로그인 오류", page: 1, perPage: 25 });
    expect(calls.some((c) => c.path.startsWith("/repos/"))).toBe(false);
    const searchCall = calls.find((c) => c.path.startsWith("/search/issues"));
    expect(decodeURIComponent(searchCall?.path ?? "")).toContain("repo:acme/widget");
    expect(decodeURIComponent(searchCall?.path ?? "")).toContain("type:issue");
    expect(result.issues).toHaveLength(1);
    expect(result.hasNextPage).toBe(false);
  });

  it("개수 조회가 실패해도 목록은 살리고 counts만 null", async () => {
    const { service, gh } = makeService({
      responses: { "/repos/acme/widget/issues": [rawIssue()] },
    });
    gh.request.mockImplementation(async (path: string) => {
      if (path.startsWith("/search/issues")) throw new HttpException("rate limit", 403);
      return undefined;
    });

    const result = await service.list("p1", "u1", {});
    expect(result.issues).toHaveLength(1);
    expect(result.counts).toBeNull();
  });

  it("gitRepo가 없으면 400", async () => {
    const { service } = makeService({ gitRepo: null });
    await expect(service.list("p1", "u1", {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("토큰이 없으면 쓰기 작업을 막는다", async () => {
    const { service } = makeService({ token: null });
    await expect(
      service.addComment("p1", "u1", 1, "안녕하세요"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("읽기는 토큰이 없어도 허용한다(공개 저장소)", async () => {
    const { service } = makeService({
      token: null,
      responses: { "/repos/acme/widget/issues/1": rawIssue() },
    });
    await expect(service.get("p1", "u1", 1)).resolves.toMatchObject({ number: 1 });
  });

  it("쓰기 전에 편집 권한을 확인한다", async () => {
    const { service, projects } = makeService({
      responses: { "/repos/acme/widget/issues/1": rawIssue({ state: "closed" }) },
    });
    await service.setState("p1", "u1", 1, "closed");
    expect(projects.assertCanEdit).toHaveBeenCalledWith("p1", "u1");
  });

  it("닫기는 state_reason을 completed로 기본 지정한다", async () => {
    const { service, calls } = makeService({
      responses: { "/repos/acme/widget/issues/1": rawIssue({ state: "closed" }) },
    });
    await service.setState("p1", "u1", 1, "closed");
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      state: "closed",
      state_reason: "completed",
    });
  });

  it("다시 열기는 state_reason=reopened", async () => {
    const { service, calls } = makeService({
      responses: { "/repos/acme/widget/issues/1": rawIssue() },
    });
    await service.setState("p1", "u1", 1, "open");
    const patch = calls.find((c) => c.init?.method === "PATCH");
    expect(JSON.parse(String(patch?.init?.body))).toEqual({
      state: "open",
      state_reason: "reopened",
    });
  });

  it("빈 코멘트는 400", async () => {
    const { service } = makeService();
    await expect(service.addComment("p1", "u1", 1, "   ")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  // ---- 이미지 프록시 ----

  it("본문의 GitHub 첨부 이미지를 서명된 프록시 경로로 매핑한다", async () => {
    const attachment = "https://github.com/acme/widget/assets/1/abc.png";
    const { service } = makeService({
      responses: {
        "/repos/acme/widget/issues/1": rawIssue({
          body: `설명\n\n![shot](${attachment})`,
        }),
      },
    });

    const issue = await service.get("p1", "u1", 1);
    const proxied = issue.imageMap[attachment];
    expect(proxied).toMatch(/^\/gh-issues\/p1\/image\?u=.+&exp=\d+&sig=[0-9a-f]+$/);
  });

  it("GitHub 외 호스트 이미지는 프록시 매핑에서 제외한다", async () => {
    const { service } = makeService({
      responses: {
        "/repos/acme/widget/issues/1": rawIssue({
          body: "![x](https://evil.example.com/a.png) ![y](http://github.com/a/b.png)",
        }),
      },
    });

    const issue = await service.get("p1", "u1", 1);
    expect(issue.imageMap).toEqual({}); // https가 아니거나 허용 호스트가 아님
  });

  it("코멘트 본문 이미지도 매핑한다", async () => {
    const url = "https://user-images.githubusercontent.com/1/a.png";
    const { service } = makeService({
      responses: {
        "/repos/acme/widget/issues/1/comments": [
          {
            id: 5,
            body: `<img src="${url}">`,
            user: { login: "bob" },
            html_url: "c",
            created_at: "2026-01-01T00:00:00Z",
            updated_at: "2026-01-01T00:00:00Z",
          },
        ],
      },
    });

    const [comment] = await service.listComments("p1", "u1", 1);
    expect(Object.keys(comment.imageMap)).toEqual([url]);
  });

  it("서명이 위조되면 프록시를 거부한다", async () => {
    const { service, images } = makeService();
    const url = "https://github.com/acme/widget/assets/1/abc.png";
    const signed = images.signUrl("p1", url);
    const exp = Number(new URL(`http://x${signed}`).searchParams.get("exp"));
    const u = new URL(`http://x${signed}`).searchParams.get("u") as string;

    await expect(
      service.proxyImage("p1", u, exp, "deadbeef"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("만료된 서명은 거부한다", async () => {
    const { service, images } = makeService();
    const url = "https://github.com/acme/widget/assets/1/abc.png";
    const signed = images.signUrl("p1", url, -1000); // 이미 만료
    const params = new URL(`http://x${signed}`).searchParams;

    await expect(
      service.proxyImage(
        "p1",
        params.get("u") as string,
        Number(params.get("exp")),
        params.get("sig") as string,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("다른 프로젝트의 서명은 통하지 않는다", async () => {
    const { service, images } = makeService();
    const url = "https://github.com/acme/widget/assets/1/abc.png";
    const params = new URL(`http://x${images.signUrl("p2", url)}`).searchParams;

    await expect(
      service.proxyImage(
        "p1",
        params.get("u") as string,
        Number(params.get("exp")),
        params.get("sig") as string,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("탭 목록은 gitRepo가 빈 프로젝트를 제외한다", async () => {
    const { service } = makeService();
    const list = await service.listRepoProjects("u1");
    expect(list).toEqual([{ id: "p1", name: "프로젝트", repo: "acme/widget" }]);
  });
});
