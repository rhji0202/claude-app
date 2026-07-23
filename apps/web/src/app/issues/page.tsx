"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Play, Plus } from "lucide-react";
import { Streamdown } from "streamdown";
import type { IssueNote } from "@claude-app/shared";
import CrudPanel from "@/components/CrudPanel";
import { WorkerDashboard } from "./WorkerDashboard";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, Mono } from "@/components/StatusBadge";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { api, upload, uploadUrl } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  running: "실행 중",
  done: "완료",
  error: "오류",
  interrupted: "중단됨",
  needs_decision: "결정 대기",
};

const CATEGORY_LABEL: Record<string, string> = {
  "auto-fix": "자동수정",
  "needs-decision": "결정필요",
  "needs-info": "정보부족",
  question: "질문",
};

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
    <StatusBadge status={status} label={STATUS_LABEL[status] ?? status} />
  );

  // 실행 중이면 배지 + 진행 상황(현재 도구 등)을 함께 표시
  if (status === "running") {
    return (
      <div className="flex flex-col gap-1">
        {badge}
        {progress && (
          <span className="text-xs text-muted-foreground">{progress}</span>
        )}
      </div>
    );
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
                <Streamdown className="prose prose-sm max-w-none dark:prose-invert prose-pre:my-2">
                  {result}
                </Streamdown>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const NOTE_LABEL: Record<string, string> = {
  human: "사람",
  agent: "에이전트",
  system: "시스템",
};

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
            {notes === null ? (
              <p className="text-sm text-muted-foreground">불러오는 중…</p>
            ) : notes.length === 0 ? (
              <p className="text-sm text-muted-foreground">이력이 없습니다.</p>
            ) : (
              notes.map((n) => (
                <div key={n.id} className="text-sm">
                  <Mono>[{NOTE_LABEL[n.author] ?? n.author}]</Mono>{" "}
                  <span className="whitespace-pre-wrap">{n.content}</span>
                </div>
              ))
            )}
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

function GithubImport({ onImported }: { onImported: () => void }) {
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
      onImported();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle className="text-sm">GitHub에서 이슈 가져오기</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="flex-1">
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
          <>
            <div className="mt-4 space-y-1">
              {issues.map((i) => {
                const checked = selected.has(i.number);
                return (
                  <label
                    key={i.number}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
                  >
                    <input
                      type="checkbox"
                      className="size-4 accent-[var(--accent)]"
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
                    <Mono>#{i.number}</Mono>
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    {i.labels.length > 0 && (
                      <Mono>{i.labels.join(", ")}</Mono>
                    )}
                  </label>
                );
              })}
            </div>
            <div className="mt-4">
              <Button
                disabled={busy || selected.size === 0}
                onClick={importSel}
              >
                선택한 {selected.size}개 큐에 추가
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

interface ProjectRef {
  id: string;
  name: string;
  gitRepo?: string | null;
}

/** 이미지 첨부가 가능한 수동 이슈 등록 (마크다운 에디터 + 붙여넣기 업로드) */
function ManualIssueWithImages({ onCreated }: { onCreated: () => void }) {
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
      onCreated();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5">
      <CardHeader>
        <CardTitle className="text-sm">이슈 수동 등록 (이미지 첨부 가능)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
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
        <Button onClick={submit} disabled={busy || !projectId || !title.trim()}>
          <Plus className="size-4" />
          {busy ? "등록 중..." : "이슈 등록"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function IssuesPage() {
  const [reload, setReload] = useState(0);
  const [projects, setProjects] = useState<ProjectRef[]>([]);
  // "" = 전체 프로젝트. 값이 있으면 해당 프로젝트로 필터.
  const [filterProjectId, setFilterProjectId] = useState("");

  useEffect(() => {
    api
      .get<ProjectRef[]>("/projects")
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  const endpoint = filterProjectId
    ? `/issues?projectId=${filterProjectId}`
    : "/issues";

  return (
    <div>
      <PageHeader title="GitHub 이슈">
        GitHub에서 이슈를 가져오거나 수동 등록해 에이전트로 실행하고, 결과를 이슈 코멘트로 되돌립니다.
      </PageHeader>

      <WorkerDashboard />

      <GithubImport onImported={() => setReload((r) => r + 1)} />

      <ManualIssueWithImages onCreated={() => setReload((r) => r + 1)} />

      <div className="mb-3 flex items-center gap-2">
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
        pollWhile={(rows) =>
          rows.some(
            (r) => r.status === "queued" || r.status === "running",
          )
        }
        pollMs={4000}
        columns={[
          { key: "repo", label: "저장소" },
          {
            key: "issueNumber",
            label: "#",
            render: (r) => (r.issueNumber ? `#${r.issueNumber}` : "—"),
          },
          { key: "title", label: "제목" },
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
              return <StatusBadge status={cat} label={CATEGORY_LABEL[cat] ?? cat} />;
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
              return (
                <div className="flex flex-wrap gap-1">
                  {imgs.slice(0, 4).map((rel) => (
                    <a
                      key={rel}
                      href={uploadUrl(rel)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={uploadUrl(rel)}
                        alt=""
                        className="size-10 rounded border border-border object-cover"
                      />
                    </a>
                  ))}
                  {imgs.length > 4 && (
                    <span className="text-xs text-muted-foreground">
                      +{imgs.length - 4}
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            key: "rerun",
            label: "재실행",
            render: (r) => {
              // 실행 중에는 재실행 버튼을 막는다.
              if (String(r.status) === "running")
                return <Mono>실행 중</Mono>;
              return (
                <RerunDialog
                  row={r}
                  onChanged={() => setReload((n) => n + 1)}
                  trigger={
                    <span className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted/50">
                      <Play className="size-3" />
                      지시·재실행
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
          },
        ]}
      />
    </div>
  );
}
