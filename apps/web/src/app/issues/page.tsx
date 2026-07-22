"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import CrudPanel from "@/components/CrudPanel";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge, Mono } from "@/components/StatusBadge";
import { api } from "@/lib/api";
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

const STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  running: "실행 중",
  done: "완료",
  error: "오류",
};

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

export default function IssuesPage() {
  const [reload, setReload] = useState(0);
  return (
    <div>
      <PageHeader title="GitHub 이슈">
        GitHub에서 이슈를 가져오거나 수동 등록해 에이전트로 실행하고, 결과를 이슈 코멘트로 되돌립니다.
      </PageHeader>

      <GithubImport onImported={() => setReload((r) => r + 1)} />

      <CrudPanel
        endpoint="/issues"
        title="이슈 작업"
        createTitle="이슈 수동 추가"
        reloadSignal={reload}
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
              <StatusBadge
                status={String(r.status)}
                label={STATUS_LABEL[String(r.status)] ?? String(r.status)}
              />
            ),
          },
        ]}
        fields={[
          {
            name: "projectId",
            label: "프로젝트",
            type: "select",
            required: true,
            optionsFrom: { endpoint: "/projects", valueKey: "id", labelKey: "name" },
          },
          { name: "repo", label: "저장소", required: true, placeholder: "owner/repo" },
          { name: "title", label: "제목", required: true, full: true },
          {
            name: "body",
            label: "내용",
            type: "textarea",
            placeholder: "이슈 내용 (선택)",
          },
          {
            name: "prompt",
            label: "추가 지시 (선택)",
            type: "textarea",
          },
        ]}
        rowActions={[
          {
            label: "실행",
            href: (r) => `/issues/${r.id}/run`,
            confirm: "이 이슈를 에이전트로 실행하시겠습니까?",
          },
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
