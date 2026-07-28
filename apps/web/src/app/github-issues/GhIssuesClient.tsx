"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Tags,
  X,
} from "lucide-react";
import type {
  GhIssueListResult,
  GhIssueSort,
  GhIssueStateFilter,
  GhLabel,
} from "@claude-app/shared";
import { api, ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GhIssueList } from "./GhIssueList";
import { GhIssueDetail } from "./GhIssueDetail";
import { GhLabelChip } from "./GhLabelChip";
import { GhNewIssueDialog } from "./GhNewIssueDialog";
import { buildListQuery } from "./gh-utils";

/**
 * GitHub Issue 뷰어 메인 화면 — 프로젝트 탭 + 이슈 목록/상세.
 *
 * ⚠️ 절대 규칙 — /issues(에이전트 이슈 큐)와 완전히 별개 기능이다.
 * 이 화면은 GitHub 저장소를 직접 읽고 쓰며, 에이전트를 실행하거나
 * 이슈를 큐에 넣지 않는다. docs/rules/github-issue-separation.md 참고.
 */

type RepoProject = { id: string; name: string; repo: string };

const SORT_LABEL: Record<GhIssueSort, string> = {
  created: "최근 등록순",
  updated: "최근 수정순",
  comments: "코멘트 많은순",
};

export function GhIssuesClient() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const projectId = params.get("project") ?? "";
  const issueNumber = Number(params.get("issue")) || null;
  const state = (params.get("state") as GhIssueStateFilter | null) ?? "open";
  const q = params.get("q") ?? "";
  const sort = (params.get("sort") as GhIssueSort | null) ?? "created";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const activeLabels = useMemo(
    () => (params.get("labels") ?? "").split(",").filter(Boolean),
    [params],
  );

  const [projects, setProjects] = useState<RepoProject[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [result, setResult] = useState<GhIssueListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoLabels, setRepoLabels] = useState<GhLabel[]>([]);
  const [searchDraft, setSearchDraft] = useState(q);

  /** URL 쿼리 일부만 갱신한다(빈 값은 제거). 목록 상태를 링크로 공유할 수 있게 한다. */
  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  // 프로젝트 탭 목록(저장소가 연결된 프로젝트만)
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const list = await api.get<RepoProject[]>("/gh-issues/projects");
        if (!alive) return;
        setProjects(list);
        // 선택된 프로젝트가 없거나 목록에 없으면 첫 탭을 연다.
        if (list.length > 0 && !list.some((p) => p.id === projectId)) {
          setParams({ project: list[0].id, issue: null, page: null });
        }
      } catch (e) {
        if (alive) {
          setError(
            e instanceof ApiError ? e.message : "프로젝트 목록을 불러오지 못했습니다.",
          );
        }
      } finally {
        if (alive) setProjectsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // 최초 1회만 조회한다(탭 전환은 URL만 바뀐다).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadList = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const query = buildListQuery({
        state,
        labels: activeLabels,
        q,
        sort,
        page,
        perPage: 25,
      });
      const data = await api.get<GhIssueListResult>(`/gh-issues/${projectId}${query}`);
      setResult(data);
    } catch (e) {
      setResult(null);
      setError(e instanceof ApiError ? e.message : "이슈를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [projectId, state, activeLabels, q, sort, page]);

  useEffect(() => {
    if (issueNumber) return; // 상세 화면에서는 목록을 다시 부르지 않는다.
    void loadList();
  }, [loadList, issueNumber]);

  // 라벨 필터 후보(선택된 프로젝트의 저장소 라벨)
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    void (async () => {
      try {
        const list = await api.get<GhLabel[]>(`/gh-issues/${projectId}/labels`);
        if (alive) setRepoLabels(list);
      } catch {
        if (alive) setRepoLabels([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  useEffect(() => setSearchDraft(q), [q]);

  function toggleLabelFilter(name: string) {
    const next = activeLabels.includes(name)
      ? activeLabels.filter((l) => l !== name)
      : [...activeLabels, name];
    setParams({ labels: next.join(","), page: null });
  }

  // ---- 렌더 ----

  if (projectsLoading) {
    return (
      <div className="space-y-4">
        <PageHeader title="GitHub Issue">저장소 이슈를 GitHub처럼 조회·관리합니다.</PageHeader>
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div>
        <PageHeader title="GitHub Issue">
          저장소 이슈를 GitHub처럼 조회·관리합니다.
        </PageHeader>
        <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
          연결된 GitHub 저장소가 있는 프로젝트가 없습니다. 프로젝트 설정에서
          <span className="font-mono"> gitRepo</span>를 지정하면 여기에 탭으로 표시됩니다.
        </div>
      </div>
    );
  }

  const current = projects.find((p) => p.id === projectId) ?? projects[0];

  return (
    <div className="space-y-5">
      <PageHeader title="GitHub Issue">
        프로젝트별 GitHub 저장소의 이슈를 열림/닫힘, 라벨, 담당자, 코멘트까지 그대로
        다룹니다. (에이전트 실행 큐인 &ldquo;이슈&rdquo; 메뉴와는 별개 기능입니다.)
      </PageHeader>

      {/* 프로젝트 탭 */}
      {/* 탭 아래 콘텐츠와 붙지 않도록 여백을 둔다(부모 space-y-5에 추가). */}
      <div className="mb-3 flex gap-1 overflow-x-auto border-b border-border">
        {projects.map((p) => {
          const active = p.id === current.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() =>
                setParams({ project: p.id, issue: null, page: null, labels: null })
              }
              className={cn(
                "whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-accent text-accent"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
              title={p.repo}
            >
              {p.name}
            </button>
          );
        })}
      </div>

      {issueNumber ? (
        <GhIssueDetail
          key={`${current.id}-${issueNumber}`}
          projectId={current.id}
          issueNumber={issueNumber}
          onBack={() => setParams({ issue: null })}
        />
      ) : (
        <>
          {/* 저장소 정보 + 새 이슈 */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a
              href={result?.repo.htmlUrl ?? `https://github.com/${current.repo}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-sm text-muted-foreground hover:text-foreground"
            >
              {result ? `${result.repo.owner}/${result.repo.name}` : current.repo}
              <ExternalLink className="size-3.5" />
            </a>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void loadList()}
                disabled={loading}
              >
                <RefreshCw className={cn("size-4", loading && "animate-spin")} />
                새로고침
              </Button>
              <GhNewIssueDialog
                projectId={current.id}
                onCreated={(issue) => setParams({ issue: String(issue.number) })}
              />
            </div>
          </div>

          {/* 필터 바 */}
          <div className="space-y-3 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center gap-2">
              {/* 열림/닫힘 */}
              <div className="flex items-center gap-4 pr-2 text-sm">
                <button
                  type="button"
                  onClick={() => setParams({ state: "open", page: null })}
                  className={cn(
                    "inline-flex items-center gap-1.5 font-medium",
                    state === "open"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <CircleDot className="size-4" />
                  열린 이슈
                  {result?.counts && ` ${result.counts.open}`}
                </button>
                <button
                  type="button"
                  onClick={() => setParams({ state: "closed", page: null })}
                  className={cn(
                    "inline-flex items-center gap-1.5 font-medium",
                    state === "closed"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <CheckCircle2 className="size-4" />
                  닫힌 이슈
                  {result?.counts && ` ${result.counts.closed}`}
                </button>
                <button
                  type="button"
                  onClick={() => setParams({ state: "all", page: null })}
                  className={cn(
                    "font-medium",
                    state === "all"
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  전체
                </button>
              </div>

              <div className="ml-auto flex flex-wrap items-center gap-2">
                {/* 라벨 필터 */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary" size="sm">
                      <Tags className="size-4" />
                      라벨
                      {activeLabels.length > 0 && ` (${activeLabels.length})`}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
                    <DropdownMenuLabel>라벨로 필터</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {repoLabels.length === 0 && (
                      <div className="px-2 py-1.5 text-xs text-muted-foreground">
                        저장소 라벨이 없습니다.
                      </div>
                    )}
                    {repoLabels.map((label) => (
                      <DropdownMenuItem
                        key={label.id || label.name}
                        onSelect={(e) => {
                          e.preventDefault();
                          toggleLabelFilter(label.name);
                        }}
                        className="gap-2"
                      >
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            activeLabels.includes(label.name)
                              ? "bg-accent"
                              : "bg-transparent",
                          )}
                        />
                        <GhLabelChip label={label} />
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* 정렬 */}
                <Select
                  value={sort}
                  onValueChange={(v) => setParams({ sort: v, page: null })}
                >
                  <SelectTrigger className="h-9 w-40">
                    <SelectValue placeholder="정렬" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SORT_LABEL) as GhIssueSort[]).map((key) => (
                      <SelectItem key={key} value={key}>
                        {SORT_LABEL[key]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 검색 */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setParams({ q: searchDraft.trim(), page: null });
              }}
              className="flex items-center gap-2"
            >
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchDraft}
                  onChange={(e) => setSearchDraft(e.target.value)}
                  placeholder="제목·본문 검색 (엔터)"
                  className="pl-8"
                />
              </div>
              {q && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setParams({ q: null, page: null })}
                >
                  <X className="size-4" />
                  검색 해제
                </Button>
              )}
            </form>

            {/* 선택된 라벨 */}
            {activeLabels.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">필터:</span>
                {activeLabels.map((name) => {
                  const label = repoLabels.find((l) => l.name === name) ?? {
                    id: 0,
                    name,
                    color: "ededed",
                    description: null,
                  };
                  return (
                    <GhLabelChip
                      key={name}
                      label={label}
                      active
                      onClick={toggleLabelFilter}
                    />
                  );
                })}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setParams({ labels: null, page: null })}
                >
                  모두 해제
                </Button>
              </div>
            )}
          </div>

          {/* 목록 */}
          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="overflow-hidden rounded-md border border-border">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                불러오는 중…
              </div>
            ) : !result || result.issues.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                조건에 맞는 이슈가 없습니다.
              </div>
            ) : (
              <GhIssueList
                issues={result.issues}
                activeLabels={activeLabels}
                onLabelClick={toggleLabelFilter}
                onOpen={(number) => setParams({ issue: String(number) })}
              />
            )}
          </div>

          {/* 페이지네이션 */}
          {result && (result.hasNextPage || page > 1) && (
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1 || loading}
                onClick={() => setParams({ page: String(page - 1) })}
              >
                <ChevronLeft className="size-4" />
                이전
              </Button>
              <span className="text-sm text-muted-foreground">{page} 페이지</span>
              <Button
                variant="secondary"
                size="sm"
                disabled={!result.hasNextPage || loading}
                onClick={() => setParams({ page: String(page + 1) })}
              >
                다음
                <ChevronRight className="size-4" />
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
