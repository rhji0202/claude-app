"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, MessageSquare, Play, Plus } from "lucide-react";
import type { IssueNote, IssueProgressEvent } from "@claude-app/shared";
import {
  ISSUE_STATUS_ORDER as STATUS_ORDER,
  issueCategoryLabel,
  issueStatusLabel,
} from "@claude-app/shared";
import CrudPanel from "@/components/CrudPanel";
import { WorkerDashboard } from "./WorkerDashboard";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, Mono } from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { Markdown } from "@/components/Markdown";
import { NoteList } from "@/components/NoteList";
import {
  ToolPart,
  editedFilesFromLog,
  fileBasename,
} from "@/components/ToolPart";
import { FilePen } from "lucide-react";
import { api, upload, uploadUrl } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * 상태 배지를 클릭하면 오류 메시지·실행 결과 전문을 다이얼로그로 보여준다.
 * error/result가 있는 상태(오류·완료)에서만 클릭 가능하게 한다.
 */
function IssueStatusCell({
  row,
  onChanged,
}: {
  row: Record<string, unknown>;
  onChanged?: () => void;
}) {
  const status = String(row.status);
  const error = (row.error as string | null | undefined) ?? null;
  const result = (row.result as string | null | undefined) ?? null;
  const progress = (row.progress as string | null | undefined) ?? null;
  const badge = (
    <StatusBadge status={status} label={issueStatusLabel(status)} />
  );

  // 실행 중이면 배지 + 진행 상황(현재 도구). 진행 이력이 있으면 클릭 시 타임라인.
  if (status === "running") {
    return <RunningCell row={row} badge={badge} progress={progress} />;
  }

  // 결정 대기: 배지 클릭 → 에이전트 질문 + 이력 + 추가 지시 + 재개
  if (status === "needs_decision") {
    return <RerunDialog row={row} trigger={badge} onChanged={onChanged} />;
  }

  // 볼 내용이 없으면 배지만 (대기 등)
  if (!error && !result) return badge;

  return (
    <Dialog>
      <DialogTrigger className="cursor-pointer" title="상세 보기">
        {badge}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {status === "error"
              ? "실행 오류"
              : status === "interrupted"
                ? "실행 중단됨"
                : "실행 결과"}
          </DialogTitle>
          <DialogDescription>
            {status === "interrupted"
              ? "실행이 중간에 중단되었습니다. 다시 실행해 주세요."
              : String(row.title ?? "")}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {error && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {status === "interrupted" ? "중단 사유" : "오류 메시지"}
              </div>
              <pre
                className={`whitespace-pre-wrap rounded-md bg-muted p-3 text-sm ${
                  status === "error" ? "text-destructive" : ""
                }`}
              >
                {error}
              </pre>
            </div>
          )}
          {result && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                실행 결과
              </div>
              <div className="rounded-md bg-muted p-3">
                <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-pre:my-2">
                  {result}
                </Markdown>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 진행 로그에서 편집·작성된 파일을 모아 상단에 요약(claude-desktop식).
 * 편집된 파일이 없으면 렌더링하지 않는다.
 */
function EditedFilesSummary({ log }: { log: IssueProgressEvent[] }) {
  const files = editedFilesFromLog(log);
  if (files.length === 0) return null;
  return (
    <div
      className="mb-1 flex min-w-0 items-center gap-1.5 rounded-md border border-border bg-secondary/30 px-2.5 py-2 text-xs"
      title={files.join("\n")}
    >
      <FilePen className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="shrink-0 font-medium">편집된 파일 {files.length}개</span>
      <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
        {files.map((f) => fileBasename(f)).join(", ")}
      </span>
    </div>
  );
}

/**
 * 실행 중 셀: 배지 + 현재 진행(도구) 한 줄. 진행 이력(progressLog)이 있으면
 * 배지를 클릭해 도구 호출 타임라인을 볼 수 있다. 목록은 SSE로 실시간 갱신됨.
 */
function RunningCell({
  row,
  badge,
  progress,
}: {
  row: Record<string, unknown>;
  badge: React.ReactNode;
  progress: string | null;
}) {
  const log = (row.progressLog as IssueProgressEvent[] | null | undefined) ?? [];
  const line = (
    <div className="flex flex-col gap-1">
      {badge}
      {progress && (
        <span className="block max-w-[16rem] truncate text-xs text-muted-foreground">
          {progress}
        </span>
      )}
    </div>
  );
  if (log.length === 0) return line;

  return (
    <Dialog>
      <DialogTrigger className="cursor-pointer text-left" title="진행 내역 보기">
        {line}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader className="min-w-0">
          <DialogTitle>진행 내역</DialogTitle>
          <DialogDescription className="truncate">
            {String(row.title ?? "")}
          </DialogDescription>
        </DialogHeader>
        <EditedFilesSummary log={log} />
        <div className="max-h-[60vh] min-w-0 space-y-2 overflow-y-auto">
          {log.map((ev, i) =>
            ev.t === "tool" ? (
              <ToolPart key={i} name={ev.name ?? "tool"} input={ev.input ?? ev.detail} />
            ) : ev.detail ? (
              // 텍스트 발화는 채팅의 중간 발화처럼 흐린 말풍선으로
              <div
                key={i}
                className="rounded-lg bg-secondary/50 px-3 py-2 text-sm text-muted-foreground"
              >
                <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-pre:my-2">
                  {ev.detail}
                </Markdown>
              </div>
            ) : null,
          )}
          <p className="pt-2 text-xs text-muted-foreground">
            실행 중 · 실시간 갱신됩니다.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 이미지 셀: 목록에선 작은 썸네일 1개 + 개수 칩(폭 고정)으로만 표시하고,
 * 클릭하면 다이얼로그에서 전체 이미지를 본다. 이미지가 많아도 열이 밀리지 않는다.
 */
function ImageCell({ imgs, title }: { imgs: string[]; title: string }) {
  return (
    <Dialog>
      <DialogTrigger
        className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md border border-border px-1.5 py-1 hover:bg-muted/50"
        title={`이미지 ${imgs.length}개 보기`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={uploadUrl(imgs[0])}
          alt=""
          className="size-6 rounded object-cover"
        />
        <Badge variant="muted">{imgs.length}</Badge>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>첨부 이미지 ({imgs.length})</DialogTitle>
          <DialogDescription>{title}</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
          {imgs.map((rel) => (
            <a key={rel} href={uploadUrl(rel)} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={uploadUrl(rel)}
                alt=""
                className="aspect-square w-full rounded border border-border object-cover"
              />
            </a>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 재실행 다이얼로그: 이력 타임라인 + 추가 지시 입력 + 재실행.
 * 어떤 상태의 이슈에도 쓸 수 있다. 열 때 GET /issues/:id/notes로 이력 지연 로드.
 *
 * 재실행 동작:
 *  - 입력한 추가 지시가 있으면 먼저 POST /notes(HUMAN)로 남긴다(실행 시 프롬프트에 주입됨).
 *  - 상태가 needs_decision이면 POST /resume, 그 외에는 POST /run으로 재큐한다.
 */
function RerunDialog({
  row,
  trigger,
  onChanged,
}: {
  row: Record<string, unknown>;
  trigger: React.ReactNode;
  onChanged?: () => void;
}) {
  const id = String(row.id);
  const status = String(row.status);
  const isDecision = status === "needs_decision";
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<IssueNote[] | null>(null);
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadNotes(next: boolean) {
    setOpen(next);
    if (!next) return;
    try {
      setNotes(await api.get<IssueNote[]>(`/issues/${id}/notes`));
    } catch (e) {
      toast.error((e as Error).message);
      setNotes([]);
    }
  }

  async function addMemo() {
    if (!memo.trim()) return;
    setBusy(true);
    try {
      await api.post(`/issues/${id}/notes`, { content: memo.trim() });
      setMemo("");
      await loadNotes(true);
      toast.success("지시를 추가했습니다.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function rerun() {
    setBusy(true);
    try {
      // 입력한 추가 지시가 있으면 먼저 메모로 남긴다(다음 실행 프롬프트에 주입).
      if (memo.trim()) {
        await api.post(`/issues/${id}/notes`, { content: memo.trim() });
        setMemo("");
      }
      // 결정 대기는 resume, 그 외 상태는 run으로 재큐.
      await api.post(`/issues/${id}/${isDecision ? "resume" : "run"}`);
      toast.success("재실행 대기열에 넣었습니다. 워커가 처리합니다.");
      setOpen(false);
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // 에이전트의 마지막 질문(가장 최근 AGENT 메모) — 결정 대기일 때 강조
  const question = notes
    ? [...notes].reverse().find((n) => n.author === "agent")?.content
    : null;

  return (
    <Dialog open={open} onOpenChange={loadNotes}>
      <DialogTrigger className="cursor-pointer" title="지시 후 재실행">
        {trigger}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {isDecision ? "사람 결정이 필요합니다" : "추가 지시 후 재실행"}
          </DialogTitle>
          <DialogDescription>{String(row.title ?? "")}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto">
          {isDecision && question && (
            <div className="rounded-md border border-[var(--accent)]/40 bg-[var(--accent)]/5 p-3 text-sm">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                에이전트 질문
              </div>
              {question}
            </div>
          )}
          {/* 이력 타임라인 */}
          <div className="space-y-2">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              이력
            </div>
            <NoteList notes={notes} />
          </div>
          {/* 추가 지시 입력 */}
          <div className="space-y-2">
            <Textarea
              placeholder="이번 실행에 반영할 추가 지시를 입력하세요. (선택 — 비워두면 그대로 재실행)"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
            />
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={addMemo}
                disabled={busy || !memo.trim()}
              >
                지시만 저장
              </Button>
              <Button onClick={rerun} disabled={busy}>
                {memo.trim() ? "지시 반영해 재실행" : "재실행"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 이슈 상세 다이얼로그: 목록에서 제목을 클릭하면 열린다.
 * 목록 행(row)에 이미 전체 IssueTask DTO가 들어있으므로 본문·이미지·결과는
 * 추가 요청 없이 렌더하고, 이력(notes)만 열 때 지연 로드한다.
 */
function IssueDetailDialog({
  row,
  trigger,
}: {
  row: Record<string, unknown>;
  trigger: React.ReactNode;
}) {
  const id = String(row.id);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<IssueNote[] | null>(null);

  const status = String(row.status);
  const body = (row.body as string | null | undefined) ?? null;
  const result = (row.result as string | null | undefined) ?? null;
  const error = (row.error as string | null | undefined) ?? null;
  const url = (row.url as string | null | undefined) ?? null;
  const prUrl = (row.prUrl as string | null | undefined) ?? null;
  const prompt = (row.prompt as string | null | undefined) ?? null;
  const labels = (row.labels as string[] | undefined) ?? [];
  const imgs = (row.images as string[] | undefined) ?? [];
  const num = row.issueNumber ? `#${row.issueNumber}` : null;

  // 본문 이미지 치환용 맵: 서버는 서명된 상대경로를 주므로 절대 URL로 바꾼다.
  const rawMap = (row.imageMap as Record<string, string> | null | undefined) ?? null;
  const bodyImageMap = rawMap
    ? Object.fromEntries(
        Object.entries(rawMap).map(([orig, rel]) => [orig, uploadUrl(rel)]),
      )
    : null;

  async function onOpenChange(next: boolean) {
    setOpen(next);
    // 이력은 열 때 한 번만 불러온다(닫았다 다시 열면 갱신).
    if (!next) return;
    try {
      setNotes(await api.get<IssueNote[]>(`/issues/${id}/notes`));
    } catch (e) {
      toast.error((e as Error).message);
      setNotes([]);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger className="cursor-pointer text-left" title="이슈 상세 보기">
        {trigger}
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader className="min-w-0">
          <DialogTitle className="flex min-w-0 items-center gap-2">
            {num && <Mono>{num}</Mono>}
            <span className="min-w-0 truncate">{String(row.title ?? "")}</span>
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} label={issueStatusLabel(status)} />
            <Mono>{String(row.source)}</Mono>
            {row.author ? <span>· {String(row.author)}</span> : null}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] min-w-0 space-y-4 overflow-y-auto">
          {/* 링크·라벨 */}
          {(url || prUrl || labels.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {url && (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] underline underline-offset-2"
                >
                  GitHub 이슈
                </a>
              )}
              {prUrl && (
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] underline underline-offset-2"
                >
                  PR
                </a>
              )}
              {labels.map((l) => (
                <Badge key={l} variant="muted">
                  {l}
                </Badge>
              ))}
            </div>
          )}

          {/* 본문 — 목록에서는 볼 수 없던 정보 */}
          <Section title="본문">
            {body ? (
              <div className="rounded-md bg-muted p-3">
                <Markdown
                  className="prose prose-sm max-w-none dark:prose-invert prose-pre:my-2"
                  imageMap={bodyImageMap}
                >
                  {body}
                </Markdown>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">본문이 없습니다.</p>
            )}
          </Section>

          {prompt && (
            <Section title="추가 지시">
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-sm">
                {prompt}
              </pre>
            </Section>
          )}

          {imgs.length > 0 && (
            <Section title={`첨부 이미지 (${imgs.length})`}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {imgs.map((rel) => (
                  <a key={rel} href={uploadUrl(rel)} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={uploadUrl(rel)}
                      alt=""
                      className="aspect-square w-full rounded border border-border object-cover"
                    />
                  </a>
                ))}
              </div>
            </Section>
          )}

          {error && (
            <Section title={status === "interrupted" ? "중단 사유" : "오류 메시지"}>
              <pre
                className={`whitespace-pre-wrap rounded-md bg-muted p-3 text-sm ${
                  status === "error" ? "text-destructive" : ""
                }`}
              >
                {error}
              </pre>
            </Section>
          )}

          {result && (
            <Section title="실행 결과">
              <div className="rounded-md bg-muted p-3">
                <Markdown className="prose prose-sm max-w-none dark:prose-invert prose-pre:my-2">
                  {result}
                </Markdown>
              </div>
            </Section>
          )}

          <Section title="이력">
            <NoteList notes={notes} />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 상세 다이얼로그 내부 섹션(제목 + 내용) 공통 래퍼. */
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

interface Project {
  id: string;
  name: string;
  gitRepo?: string | null;
}
interface GhIssue {
  number: number;
  title: string;
  labels: string[];
  author: string | null;
  html_url: string;
}

function GithubImport({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [issues, setIssues] = useState<GhIssue[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<Project[]>("/projects")
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  async function fetchIssues() {
    if (!projectId) return toast.error("프로젝트를 선택하세요.");
    setBusy(true);
    setSelected(new Set());
    try {
      const data = await api.get<GhIssue[]>(
        `/issues/github/${projectId}?state=${state}`,
      );
      setIssues(data);
      if (data.length === 0) toast.info("이슈가 없습니다.");
    } catch (e) {
      toast.error((e as Error).message);
      setIssues([]);
    } finally {
      setBusy(false);
    }
  }

  async function importSel() {
    setBusy(true);
    try {
      const res = await api.post<{ imported: number } | unknown[]>(
        "/issues/import",
        { projectId, numbers: Array.from(selected) },
      );
      const n = Array.isArray(res) ? res.length : 0;
      toast.success(`${n}개 이슈를 큐에 추가했습니다.`);
      setSelected(new Set());
      setIssues([]);
      onOpenChange(false);
      onImported();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>GitHub에서 이슈 가져오기</DialogTitle>
        </DialogHeader>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="min-w-0 flex-1">
              <SelectValue placeholder="프로젝트 선택 (gitRepo 필요)" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} {p.gitRepo ? `(${p.gitRepo})` : "(repo 없음)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={state}
            onValueChange={(v) => setState(v as "open" | "closed" | "all")}
          >
            <SelectTrigger className="sm:w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="open">열림</SelectItem>
              <SelectItem value="closed">닫힘</SelectItem>
              <SelectItem value="all">전체</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="secondary" onClick={fetchIssues} disabled={busy}>
            <Download className="size-4" />
            {busy ? "..." : "불러오기"}
          </Button>
        </div>

        {issues.length > 0 && (
          <div className="min-w-0">
            <label className="flex cursor-pointer items-center gap-3 border-b border-border px-3 py-2 text-sm font-medium">
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-[var(--accent)]"
                checked={selected.size === issues.length && issues.length > 0}
                // 일부만 선택된 상태를 시각적으로 표시(부분 선택)
                ref={(el) => {
                  if (el)
                    el.indeterminate =
                      selected.size > 0 && selected.size < issues.length;
                }}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? new Set(issues.map((i) => i.number))
                      : new Set(),
                  )
                }
              />
              전체 선택 ({selected.size}/{issues.length})
            </label>
            <div className="mt-1 max-h-[45vh] min-w-0 space-y-1 overflow-y-auto">
              {issues.map((i) => {
                const checked = selected.has(i.number);
                return (
                  <label
                    key={i.number}
                    className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-[var(--accent)]"
                      checked={checked}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(i.number)) n.delete(i.number);
                          else n.add(i.number);
                          return n;
                        })
                      }
                    />
                    <span className="shrink-0">
                      <Mono>#{i.number}</Mono>
                    </span>
                    <span className="min-w-0 flex-1 truncate" title={i.title}>
                      {i.title}
                    </span>
                    {i.labels.length > 0 && (
                      <span
                        className="max-w-[30%] shrink-0 truncate"
                        title={i.labels.join(", ")}
                      >
                        <Mono>{i.labels.join(", ")}</Mono>
                      </span>
                    )}
                  </label>
                );
              })}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            닫기
          </Button>
          <Button
            disabled={busy || selected.size === 0}
            onClick={importSel}
          >
            선택한 {selected.size}개 큐에 추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface ProjectRef {
  id: string;
  name: string;
  gitRepo?: string | null;
}

/** 이미지 첨부가 가능한 수동 이슈 등록 (마크다운 에디터 + 붙여넣기 업로드) */
function ManualIssueWithImages({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [prompt, setPrompt] = useState("");
  // 이미 생성된 이슈 id (이미지 업로드 대상). 첫 저장 시 생성.
  const [issueId, setIssueId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .get<ProjectRef[]>("/projects")
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  /** 이슈가 아직 없으면 만들고 id 반환 (이미지 업로드 전제) */
  async function ensureIssue(): Promise<string> {
    if (issueId) return issueId;
    if (!projectId) throw new Error("프로젝트를 선택하세요.");
    if (!title.trim()) throw new Error("제목을 입력하세요.");
    const proj = projects.find((p) => p.id === projectId);
    const created = await api.post<{ id: string }>("/issues", {
      projectId,
      repo: proj?.gitRepo || "manual",
      title: title.trim(),
      body,
      prompt: prompt.trim() || undefined,
      source: "manual",
    });
    setIssueId(created.id);
    return created.id;
  }

  async function uploadImage(file: File): Promise<string> {
    const id = await ensureIssue();
    const form = new FormData();
    form.append("files", file);
    const res = await upload<{ images: string[] }>(`/issues/${id}/images`, form);
    const rel = res.images[res.images.length - 1];
    return uploadUrl(rel);
  }

  async function submit() {
    setBusy(true);
    try {
      const id = await ensureIssue();
      // body 변경분 반영(이미지 삽입 등) + 추가 지시
      await api.patch(`/issues/${id}`, {
        title: title.trim(),
        body,
        prompt: prompt.trim() || undefined,
      });
      toast.success("이슈를 등록했습니다.");
      setTitle("");
      setBody("");
      setPrompt("");
      setIssueId(null);
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>이슈 수동 등록 (이미지 첨부 가능)</DialogTitle>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>프로젝트 *</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="프로젝트 선택" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="mi-title">제목 *</Label>
              <Input
                id="mi-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>본문 (마크다운 · 이미지 붙여넣기/드래그 가능)</Label>
            <MarkdownEditor
              value={body}
              onChange={setBody}
              onUploadImage={uploadImage}
              placeholder="이슈 내용. 이미지를 붙여넣거나 드래그하면 자동 업로드됩니다."
            />
          </div>
          <div className="space-y-1.5">
            <Label>추가 지시 (선택)</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="에이전트에게 전달할 추가 지시 (선택)"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button onClick={submit} disabled={busy || !projectId || !title.trim()}>
            <Plus className="size-4" />
            {busy ? "등록 중..." : "이슈 등록"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function IssuesPage() {
  const [reload, setReload] = useState(0);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  // "" = 전체 프로젝트. 값이 있으면 해당 프로젝트로 필터.
  const [filterProjectId, setFilterProjectId] = useState("");
  // "" = 전체 상태. 값이 있으면 해당 상태로 서버 필터(GET /issues?status=).
  const [filterStatus, setFilterStatus] = useState("");
  // 등록 폼 두 개는 레이어 팝업(다이얼로그)으로 띄운다.
  const [importOpen, setImportOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    api
      .get<ProjectRef[]>("/projects")
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  // 필터를 쿼리스트링으로 조립 — endpoint가 바뀌면 CrudPanel이 자동 재조회한다.
  const params = new URLSearchParams();
  if (filterProjectId) params.set("projectId", filterProjectId);
  if (filterStatus) params.set("status", filterStatus);
  const endpoint = params.toString() ? `/issues?${params}` : "/issues";

  // projectId → 이름 매핑(저장소 대신 프로젝트 이름 표시용)
  const projectName = (id: unknown) =>
    projects.find((p) => p.id === String(id))?.name ?? "—";

  return (
    <div>
      <PageHeader title="이슈">
        GitHub에서 이슈를 가져오거나 수동 등록해 에이전트로 실행하고, 결과를 이슈 코멘트로 되돌립니다.
      </PageHeader>

      <WorkerDashboard />

      <GithubImport
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => setReload((r) => r + 1)}
      />

      <ManualIssueWithImages
        open={manualOpen}
        onOpenChange={setManualOpen}
        onCreated={() => setReload((r) => r + 1)}
      />

      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-3">
        <Label className="shrink-0 text-xs text-muted-foreground">
          프로젝트 필터
        </Label>
        <Select
          value={filterProjectId || "all"}
          onValueChange={(v) => setFilterProjectId(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-64">
            <SelectValue placeholder="전체 프로젝트" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 프로젝트</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Label className="ml-1 shrink-0 text-xs text-muted-foreground">
          상태 필터
        </Label>
        <Select
          value={filterStatus || "all"}
          onValueChange={(v) => setFilterStatus(v === "all" ? "" : v)}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="전체 상태" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">전체 상태</SelectItem>
            {STATUS_ORDER.map((s) => (
              <SelectItem key={s} value={s}>
                {issueStatusLabel(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* 등록 진입점 */}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" onClick={() => setImportOpen(true)}>
            <Download className="size-4" />
            GitHub에서 가져오기
          </Button>
          <Button onClick={() => setManualOpen(true)}>
            <Plus className="size-4" />
            이슈 등록
          </Button>
        </div>
      </div>

      <CrudPanel
        endpoint={endpoint}
        title="이슈 작업"
        hideCreate
        reloadSignal={reload}
        batchActions={[
          {
            label: "선택 실행",
            confirm: (ids) =>
              `선택한 ${ids.length}개 이슈를 큐에 넣어 실행합니다. 진행할까요?`,
            run: async (ids) => {
              await api.post("/issues/batch-run", { ids });
            },
          },
        ]}
        sseUrl="/issues/stream"
        columns={[
          {
            key: "projectId",
            label: "프로젝트",
            render: (r) => (
              <span
                className="block max-w-[10rem] truncate"
                title={projectName(r.projectId)}
              >
                {projectName(r.projectId)}
              </span>
            ),
          },
          {
            key: "issueNumber",
            label: "#",
            render: (r) => (r.issueNumber ? `#${r.issueNumber}` : "—"),
          },
          {
            key: "title",
            label: "제목",
            render: (r) => (
              <IssueDetailDialog
                row={r}
                trigger={
                  <span
                    className="block max-w-[55vw] truncate underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 hover:decoration-solid hover:decoration-[var(--accent)] sm:max-w-[26rem]"
                    title={String(r.title ?? "")}
                  >
                    {String(r.title ?? "")}
                  </span>
                }
              />
            ),
          },
          {
            key: "source",
            label: "출처",
            render: (r) => <Mono>{String(r.source)}</Mono>,
          },
          {
            key: "status",
            label: "상태",
            render: (r) => (
              <IssueStatusCell row={r} onChanged={() => setReload((n) => n + 1)} />
            ),
          },
          {
            key: "category",
            label: "분류",
            render: (r) => {
              const cat = (r.category as string | null | undefined) ?? null;
              if (!cat) return <Mono>—</Mono>;
              return <StatusBadge status={cat} label={issueCategoryLabel(cat)} />;
            },
          },
          {
            key: "prUrl",
            label: "PR",
            render: (r) => {
              const pr = (r.prUrl as string | null | undefined) ?? null;
              if (!pr) return <Mono>—</Mono>;
              const num = pr.match(/\/pull\/(\d+)/)?.[1];
              return (
                <a
                  href={pr}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[var(--accent)] underline underline-offset-2"
                >
                  <Mono>{num ? `#${num}` : "PR"}</Mono>
                </a>
              );
            },
          },
          {
            key: "images",
            label: "이미지",
            render: (r) => {
              const imgs = (r.images as string[] | undefined) ?? [];
              if (imgs.length === 0) return <Mono>—</Mono>;
              return <ImageCell imgs={imgs} title={String(r.title ?? "")} />;
            },
          },
          {
            key: "rerun",
            label: "재실행",
            render: (r) => {
              // 실행 중에는 재실행 대신 회전 아이콘으로 표시(재실행 막음).
              if (String(r.status) === "running")
                return (
                  <span
                    className="inline-flex size-8 items-center justify-center text-muted-foreground"
                    title="실행 중"
                    aria-label="실행 중"
                  >
                    <Loader2 className="size-4 animate-spin" />
                  </span>
                );
              return (
                <RerunDialog
                  row={r}
                  onChanged={() => setReload((n) => n + 1)}
                  trigger={
                    <span
                      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border hover:bg-muted/50"
                      title="지시·재실행"
                      aria-label="지시·재실행"
                    >
                      <Play className="size-4" />
                    </span>
                  }
                />
              );
            },
          },
        ]}
        fields={[]}
        rowActions={[
          {
            label: "결과 코멘트",
            href: (r) => `/issues/${r.id}/comment`,
            confirm: "실행 결과를 GitHub 이슈에 코멘트로 게시합니다. 진행할까요?",
            icon: <MessageSquare className="size-4" />,
          },
        ]}
      />
    </div>
  );
}
