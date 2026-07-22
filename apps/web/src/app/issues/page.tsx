"use client";

import { useEffect, useState } from "react";
import CrudPanel from "@/components/CrudPanel";
import { api } from "@/lib/api";

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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Project[]>("/projects").then(setProjects).catch(() => setProjects([]));
  }, []);

  async function fetchIssues() {
    if (!projectId) return setError("프로젝트를 선택하세요.");
    setBusy(true);
    setError(null);
    setNotice(null);
    setSelected(new Set());
    try {
      const data = await api.get<GhIssue[]>(`/issues/github/${projectId}?state=${state}`);
      setIssues(data);
      if (data.length === 0) setNotice("이슈가 없습니다.");
    } catch (e) {
      setError((e as Error).message);
      setIssues([]);
    } finally {
      setBusy(false);
    }
  }

  async function importSel() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ imported: number } | unknown[]>("/issues/import", {
        projectId,
        numbers: Array.from(selected),
      });
      const n = Array.isArray(res) ? res.length : 0;
      setNotice(`${n}개 이슈를 큐에 추가했습니다.`);
      setSelected(new Set());
      setIssues([]);
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2>GitHub에서 이슈 가져오기</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={{ flex: 1 }}>
          <option value="">프로젝트 선택 (gitRepo 필요)</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} {p.gitRepo ? `(${p.gitRepo})` : "(repo 없음)"}
            </option>
          ))}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value as "open" | "closed" | "all")}>
          <option value="open">열림</option>
          <option value="closed">닫힘</option>
          <option value="all">전체</option>
        </select>
        <button className="btn secondary" onClick={fetchIssues} disabled={busy}>
          {busy ? "..." : "불러오기"}
        </button>
      </div>
      {error && <div className="error-text">{error}</div>}
      {notice && <div style={{ color: "var(--green)", fontSize: 13 }}>{notice}</div>}
      {issues.length > 0 && (
        <>
          <table style={{ marginTop: 12 }}>
            <tbody>
              {issues.map((i) => (
                <tr key={i.number}>
                  <td style={{ width: 1 }}>
                    <input
                      type="checkbox"
                      checked={selected.has(i.number)}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          n.has(i.number) ? n.delete(i.number) : n.add(i.number);
                          return n;
                        })
                      }
                    />
                  </td>
                  <td className="mono">#{i.number}</td>
                  <td>{i.title}</td>
                  <td className="mono">{i.labels.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 12 }}>
            <button className="btn" disabled={busy || selected.size === 0} onClick={importSel}>
              선택한 {selected.size}개 큐에 추가
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function IssuesPage() {
  const [reload, setReload] = useState(0);
  return (
    <div>
      <h1 className="page-title">GitHub 이슈</h1>
      <p className="page-desc">
        GitHub에서 이슈를 가져오거나 수동 등록해 에이전트로 실행하고, 결과를 이슈 코멘트로 되돌립니다.
      </p>

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
            render: (r) => <span className="mono">{String(r.source)}</span>,
          },
          {
            key: "status",
            label: "상태",
            render: (r) => (
              <span className={`badge ${String(r.status)}`}>
                {STATUS_LABEL[String(r.status)] ?? String(r.status)}
              </span>
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
