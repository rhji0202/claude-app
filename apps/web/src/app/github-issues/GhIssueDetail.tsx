"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  CircleDot,
  ExternalLink,
  Loader2,
  Pencil,
  RefreshCw,
  Tags,
  Users,
  X,
} from "lucide-react";
import type { GhComment, GhIssue, GhLabel, GhUser } from "@claude-app/shared";
import { api, ApiError, API_BASE } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/Markdown";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GhAvatar, GhStateBadge } from "./GhBits";
import { GhLabelChip } from "./GhLabelChip";
import { absoluteTime, relativeTime } from "./gh-utils";

/**
 * GitHub 이슈 상세 — 본문 + 코멘트 타임라인 + 라벨/담당자/상태 편집.
 * ⚠️ GitHub Issue 뷰어 전용. 에이전트 실행과 무관하다
 * (docs/rules/github-issue-separation.md).
 */

/**
 * 서버가 내려준 이미지 매핑(원본 URL → 서명된 프록시 경로)을 절대 URL로 바꾼다.
 *
 * GitHub 첨부(`user-attachments`)는 인증을 요구해 브라우저가 직접 열면 깨진다.
 * API가 프로젝트 토큰으로 대신 받아 내려주므로 src를 프록시 주소로 갈아끼운다.
 */
function toProxyImageMap(map: Record<string, string> | undefined) {
  if (!map) return {};
  const out: Record<string, string> = {};
  for (const [original, path] of Object.entries(map)) {
    out[original] = `${API_BASE}${path}`;
  }
  return out;
}

function ErrorText({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
      {message}
    </div>
  );
}

/** 본문/코멘트 공통 말풍선. */
function GhCommentBox({
  author,
  createdAt,
  body,
  images,
  isOriginalPost,
}: {
  author: GhUser | null;
  createdAt: string;
  body: string;
  /** 서버가 준 원본 URL → 프록시 경로 매핑 */
  images: Record<string, string> | undefined;
  isOriginalPost?: boolean;
}) {
  const imageMap = useMemo(() => toProxyImageMap(images), [images]);
  return (
    <div className="flex gap-3">
      <div className="pt-1">
        <GhAvatar user={author} size={32} />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden rounded-md border border-border">
        <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {author?.login ?? "알 수 없음"}
          </span>
          <span title={absoluteTime(createdAt)}>
            {relativeTime(createdAt)} {isOriginalPost ? "등록" : "코멘트"}
          </span>
        </div>
        <div className="px-3 py-3">
          {body.trim() ? (
            <Markdown className="text-sm" imageMap={imageMap}>
              {body}
            </Markdown>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              내용이 없습니다.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function GhIssueDetail({
  projectId,
  issueNumber,
  onBack,
}: {
  projectId: string;
  issueNumber: number;
  onBack: () => void;
}) {
  const [issue, setIssue] = useState<GhIssue | null>(null);
  const [comments, setComments] = useState<GhComment[]>([]);
  const [repoLabels, setRepoLabels] = useState<GhLabel[]>([]);
  const [assignable, setAssignable] = useState<GhUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [commentDraft, setCommentDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [bodyDraft, setBodyDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [detail, list] = await Promise.all([
        api.get<GhIssue>(`/gh-issues/${projectId}/${issueNumber}`),
        api.get<GhComment[]>(`/gh-issues/${projectId}/${issueNumber}/comments`),
      ]);
      setIssue(detail);
      setComments(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "이슈를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }, [projectId, issueNumber]);

  useEffect(() => {
    void load();
  }, [load]);

  // 라벨·담당자 후보는 편집 UI용 보조 데이터라 실패해도 화면을 막지 않는다.
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const [labels, users] = await Promise.all([
          api.get<GhLabel[]>(`/gh-issues/${projectId}/labels`),
          api.get<GhUser[]>(`/gh-issues/${projectId}/assignees`),
        ]);
        if (!alive) return;
        setRepoLabels(labels);
        setAssignable(users);
      } catch {
        /* 편집 후보 조회 실패는 무시 */
      }
    })();
    return () => {
      alive = false;
    };
  }, [projectId]);

  async function run<T>(fn: () => Promise<T>, successMessage?: string) {
    setBusy(true);
    try {
      const result = await fn();
      if (successMessage) toast.success(successMessage);
      return result;
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : "요청에 실패했습니다.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function toggleLabel(name: string) {
    if (!issue) return;
    const has = issue.labels.some((l) => l.name === name);
    const next = has
      ? issue.labels.filter((l) => l.name !== name).map((l) => l.name)
      : [...issue.labels.map((l) => l.name), name];
    const labels = await run(
      () =>
        api.put<GhLabel[]>(`/gh-issues/${projectId}/${issueNumber}/labels`, {
          labels: next,
        }),
      "라벨을 변경했습니다.",
    );
    if (labels) setIssue({ ...issue, labels });
  }

  async function toggleAssignee(login: string) {
    if (!issue) return;
    const has = issue.assignees.some((u) => u.login === login);
    const next = has
      ? issue.assignees.filter((u) => u.login !== login).map((u) => u.login)
      : [...issue.assignees.map((u) => u.login), login];
    const updated = await run(
      () =>
        api.put<GhIssue>(`/gh-issues/${projectId}/${issueNumber}/assignees`, {
          assignees: next,
        }),
      "담당자를 변경했습니다.",
    );
    if (updated) setIssue(updated);
  }

  async function changeState(state: "open" | "closed", reason?: "not_planned") {
    const updated = await run(
      () =>
        api.post<GhIssue>(`/gh-issues/${projectId}/${issueNumber}/state`, {
          state,
          ...(state === "closed" && reason ? { stateReason: reason } : {}),
        }),
      state === "closed" ? "이슈를 닫았습니다." : "이슈를 다시 열었습니다.",
    );
    if (updated) setIssue(updated);
  }

  async function submitComment() {
    const body = commentDraft.trim();
    if (!body) return;
    const created = await run(
      () =>
        api.post<GhComment>(`/gh-issues/${projectId}/${issueNumber}/comments`, {
          body,
        }),
      "코멘트를 등록했습니다.",
    );
    if (created) {
      setComments((prev) => [...prev, created]);
      setCommentDraft("");
      if (issue) setIssue({ ...issue, comments: issue.comments + 1 });
    }
  }

  async function saveEdit() {
    if (!issue) return;
    const title = titleDraft.trim();
    if (!title) {
      toast.error("제목은 비울 수 없습니다.");
      return;
    }
    const updated = await run(
      () =>
        api.patch<GhIssue>(`/gh-issues/${projectId}/${issueNumber}`, {
          title,
          body: bodyDraft,
        }),
      "이슈를 수정했습니다.",
    );
    if (updated) {
      setIssue(updated);
      setEditing(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-5 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error || !issue) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          목록으로
        </Button>
        <ErrorText message={error ?? "이슈를 찾을 수 없습니다."} />
      </div>
    );
  }

  const assignedLogins = issue.assignees.map((u) => u.login);
  const labelNames = issue.labels.map((l) => l.name);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          목록으로
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={busy}>
            <RefreshCw className="size-4" />
            새로고침
          </Button>
          <a
            href={issue.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-4" />
            GitHub에서 보기
          </a>
        </div>
      </div>

      {/* 제목 */}
      {editing ? (
        <div className="space-y-3">
          <Input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            placeholder="제목"
          />
          <MarkdownEditor
            value={bodyDraft}
            onChange={setBodyDraft}
            placeholder="본문 (마크다운)"
            minRows={8}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => void saveEdit()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              저장
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              <X className="size-4" />
              취소
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex items-start gap-2">
            <h1 className="min-w-0 flex-1 text-xl font-bold leading-snug md:text-2xl">
              {issue.title}{" "}
              <span className="font-normal text-muted-foreground">#{issue.number}</span>
            </h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setTitleDraft(issue.title);
                setBodyDraft(issue.body ?? "");
                setEditing(true);
              }}
            >
              <Pencil className="size-4" />
              편집
            </Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <GhStateBadge issue={issue} />
            <span title={absoluteTime(issue.createdAt)}>
              <span className="font-medium text-foreground">
                {issue.author?.login ?? "알 수 없음"}
              </span>
              님이 {relativeTime(issue.createdAt)} 등록 · 코멘트 {issue.comments}개
            </span>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
        {/* 본문 + 코멘트 타임라인 */}
        <div className="min-w-0 space-y-4">
          {!editing && (
            <GhCommentBox
              author={issue.author}
              createdAt={issue.createdAt}
              body={issue.body ?? ""}
              images={issue.imageMap}
              isOriginalPost
            />
          )}

          {comments.map((c) => (
            <GhCommentBox
              key={c.id}
              author={c.author}
              createdAt={c.createdAt}
              body={c.body}
              images={c.imageMap}
            />
          ))}

          {/* 코멘트 작성 */}
          <div className="space-y-2 rounded-md border border-border p-3">
            <div className="text-sm font-medium">코멘트 작성</div>
            <MarkdownEditor
              value={commentDraft}
              onChange={setCommentDraft}
              placeholder="코멘트를 입력하세요 (마크다운)"
              minRows={4}
            />
            <div className="flex flex-wrap justify-end gap-2">
              {issue.state === "open" ? (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void changeState("closed", "not_planned")}
                    disabled={busy}
                  >
                    진행 안 함으로 닫기
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void changeState("closed")}
                    disabled={busy}
                  >
                    <Check className="size-4" />
                    이슈 닫기
                  </Button>
                </>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void changeState("open")}
                  disabled={busy}
                >
                  <CircleDot className="size-4" />
                  다시 열기
                </Button>
              )}
              <Button
                size="sm"
                onClick={() => void submitComment()}
                disabled={busy || !commentDraft.trim()}
              >
                {busy && <Loader2 className="size-4 animate-spin" />}
                코멘트 등록
              </Button>
            </div>
          </div>
        </div>

        {/* 사이드바: 라벨 · 담당자 */}
        <aside className="space-y-5 lg:border-l lg:border-border lg:pl-5">
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                라벨
              </h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" disabled={busy}>
                    <Tags className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
                  <DropdownMenuLabel>라벨 지정</DropdownMenuLabel>
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
                        void toggleLabel(label.name);
                      }}
                      className="gap-2"
                    >
                      <Check
                        className={`size-3.5 shrink-0 ${
                          labelNames.includes(label.name) ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <GhLabelChip label={label} />
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {issue.labels.length === 0 ? (
              <p className="text-xs text-muted-foreground">지정된 라벨 없음</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {issue.labels.map((l) => (
                  <GhLabelChip key={l.name} label={l} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                담당자
              </h2>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" disabled={busy}>
                    <Users className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
                  <DropdownMenuLabel>담당자 지정</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {assignable.length === 0 && (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      지정 가능한 사용자가 없습니다.
                    </div>
                  )}
                  {assignable.map((u) => (
                    <DropdownMenuItem
                      key={u.login}
                      onSelect={(e) => {
                        e.preventDefault();
                        void toggleAssignee(u.login);
                      }}
                      className="gap-2"
                    >
                      <Check
                        className={`size-3.5 shrink-0 ${
                          assignedLogins.includes(u.login) ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <GhAvatar user={u} size={18} />
                      <span className="truncate text-sm">{u.login}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {issue.assignees.length === 0 ? (
              <p className="text-xs text-muted-foreground">담당자 없음</p>
            ) : (
              <ul className="space-y-1.5">
                {issue.assignees.map((u) => (
                  <li key={u.login} className="flex items-center gap-2 text-sm">
                    <GhAvatar user={u} size={20} />
                    {u.login}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {issue.milestone && (
            <section className="space-y-1">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                마일스톤
              </h2>
              <p className="text-sm">{issue.milestone.title}</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
