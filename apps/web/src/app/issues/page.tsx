"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Download,
  Loader2,
  MessageSquare,
  Play,
  Plus,
} from "lucide-react";
import type { IssueAttachment, IssueMode, IssueTask } from "@claude-app/shared";
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
import { api, upload, uploadUrl } from "@/lib/api";
import { FileAttach, ModePicker, RunStatusLine, issueStateLabel } from "./issue-parts";
import { IssueRunDialog } from "./IssueRunView";
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
 * 상태 셀: 배지(실행 중이면 지금 하는 일 한 줄 "명령 실행 중 · pnpm test").
 * 누르면 실행 다이얼로그가 열린다(진행·결정·결과·재실행을 대화형으로).
 */
function IssueStatusCell({
  row,
  onOpen,
}: {
  row: Record<string, unknown>;
  onOpen: () => void;
}) {
  const issue = row as unknown as IssueTask;
  return (
    <button
      type="button"
      className="flex cursor-pointer flex-col gap-1 text-left"
      onClick={onOpen}
      title="실행 보기"
    >
      <StatusBadge status={issue.status} label={issueStateLabel(issue)} />
      {issue.status === "running" && <RunStatusLine log={issue.progressLog ?? []} />}
    </button>
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
  const [mode, setMode] = useState<IssueMode>("direct");
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
        { projectId, numbers: Array.from(selected), mode },
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

        {issues.length > 0 && <ModePicker value={mode} onChange={setMode} />}

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

/**
 * GitHub Issue 뷰어의 "바로 처리"·"분석 후 진행" 링크
 * (`/issues?import=<projectId>&number=<n>&mode=direct|plan`)로 들어왔을 때, 그 이슈 하나를
 * 큐에 넣을지 확인한다. 링크의 모드가 기본값이고 여기서 바꿀 수 있다. 큐 추가는 이 화면만
 * 한다(docs/rules/github-issue-separation.md 규칙 3). 이미 큐에 있으면 건너뛴다.
 */
function ProcessFromGithub({
  target,
  projects,
  onClose,
  onImported,
  onExisting,
}: {
  target: { projectId: string; number: number; mode: IssueMode } | null;
  projects: ProjectRef[];
  onClose: () => void;
  onImported: (projectId: string) => void;
  /** 이미 큐에 있는 이슈면 그 실행 창을 연다(거기서 이어가거나 '분석부터 다시'). */
  onExisting: (issueId: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<IssueMode>("direct");
  const project = target ? projects.find((p) => p.id === target.projectId) : null;

  useEffect(() => {
    if (target) setMode(target.mode);
  }, [target]);

  async function importOne() {
    if (!target) return;
    setBusy(true);
    try {
      const res = await api.post<unknown[]>("/issues/import", {
        projectId: target.projectId,
        numbers: [target.number],
        mode,
      });
      onImported(target.projectId);
      onClose();
      if (Array.isArray(res) && res.length > 0) {
        toast.success(`#${target.number}을 큐에 추가했습니다. 워커가 처리합니다.`);
        return;
      }
      // 이미 등록된 이슈 — 모드를 몰래 바꾸지 않고, 그 실행 창을 열어 사람이 이어가게 한다.
      const rows = await api.get<IssueTask[]>(`/issues?projectId=${target.projectId}`);
      const existing = rows.find((r) => r.issueNumber === target.number);
      toast.info(
        `#${target.number}은 이미 큐에 있습니다.` +
          (mode === "plan" ? " 실행 창에서 '분석부터 다시'로 분석 후 진행할 수 있습니다." : ""),
      );
      if (existing) onExisting(existing.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>에이전트로 처리</DialogTitle>
          <DialogDescription>
            {project?.gitRepo ?? project?.name ?? "프로젝트"} #{target?.number} 이슈를
            에이전트 작업 큐에 추가합니다.
          </DialogDescription>
        </DialogHeader>
        <ModePicker value={mode} onChange={setMode} />
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            취소
          </Button>
          <Button onClick={importOne} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
            큐에 추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
  // 이미 생성된 이슈 id (이미지·파일 업로드 대상). 첫 저장 시 생성.
  const [issueId, setIssueId] = useState<string | null>(null);
  const [files, setFiles] = useState<IssueAttachment[]>([]);
  const [mode, setMode] = useState<IssueMode>("direct");
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
      mode,
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
        mode,
      });
      toast.success("이슈를 등록했습니다.");
      setTitle("");
      setBody("");
      setPrompt("");
      setFiles([]);
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
            <Label>첨부 파일 (선택 · 엑셀·PDF 등)</Label>
            <FileAttach
              ensureIssue={ensureIssue}
              attached={files}
              onAttached={setFiles}
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
          <div className="space-y-1.5">
            <Label>처리 방식</Label>
            <ModePicker value={mode} onChange={setMode} />
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
  // GitHub Issue 뷰어에서 "에이전트로 처리"로 넘어온 대상(확인 다이얼로그용).
  const [ghTarget, setGhTarget] = useState<{
    projectId: string;
    number: number;
    mode: IssueMode;
  } | null>(null);
  // 실행 다이얼로그로 연 이슈(제목·상태·실행 버튼 공용). null이면 닫힘.
  const [openIssueId, setOpenIssueId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ProjectRef[]>("/projects")
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  // ?import=<projectId>&number=<n>&mode=direct|plan 으로 들어오면 확인 다이얼로그를 띄우고
  // 쿼리는 지운다(새로고침 때 다시 뜨지 않게).
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const projectId = q.get("import");
    const number = Number(q.get("number"));
    if (!projectId || !number) return;
    window.history.replaceState(null, "", "/issues");
    setGhTarget({ projectId, number, mode: q.get("mode") === "plan" ? "plan" : "direct" });
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

      <ProcessFromGithub
        target={ghTarget}
        projects={projects}
        onClose={() => setGhTarget(null)}
        onImported={(projectId) => {
          // 방금 넣은 이슈가 바로 보이도록 해당 프로젝트로 거른다.
          setFilterProjectId(projectId);
          setReload((r) => r + 1);
        }}
        onExisting={setOpenIssueId}
      />

      <IssueRunDialog id={openIssueId} onClose={() => setOpenIssueId(null)} />

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
              <button
                type="button"
                onClick={() => setOpenIssueId(String(r.id))}
                className="block max-w-[55vw] cursor-pointer truncate text-left underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 hover:decoration-solid hover:decoration-[var(--accent)] sm:max-w-[26rem]"
                title={String(r.title ?? "")}
              >
                {String(r.title ?? "")}
              </button>
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
              <IssueStatusCell row={r} onOpen={() => setOpenIssueId(String(r.id))} />
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
            label: "실행",
            render: (r) => {
              const running = String(r.status) === "running";
              // 실행 다이얼로그를 연다. 실행 중이면 회전 아이콘으로 진행을 알린다.
              return (
                <button
                  type="button"
                  onClick={() => setOpenIssueId(String(r.id))}
                  className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border hover:bg-muted/50"
                  title={running ? "실행 중 — 진행 보기" : "실행 열기"}
                  aria-label={running ? "실행 중 — 진행 보기" : "실행 열기"}
                >
                  {running ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Play className="size-4" />
                  )}
                </button>
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
