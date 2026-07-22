"use client";

import { useEffect, useState } from "react";

interface Project {
  id: string;
  name: string;
  repo?: string;
}

interface Issue {
  number: number;
  title: string;
  labels: string[];
  author: string | null;
  html_url: string;
  comments: number;
}

export default function GithubImportPanel({
  onImported,
}: {
  onImported: () => void;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [repo, setRepo] = useState("");
  const [state, setState] = useState<"open" | "closed" | "all">("open");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/github/status")
      .then((r) => r.json())
      .then((d) => setConfigured(Boolean(d.configured)))
      .catch(() => setConfigured(false));
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d: Project[]) => setProjects(Array.isArray(d) ? d : []))
      .catch(() => setProjects([]));
  }, []);

  // 프로젝트 선택 시 해당 프로젝트의 repo를 기본값으로
  function pickProject(id: string) {
    setProjectId(id);
    const p = projects.find((x) => x.id === id);
    if (p?.repo && !repo) setRepo(p.repo);
  }

  async function fetchIssues() {
    if (!repo) {
      setError("저장소(owner/repo)를 입력하세요.");
      return;
    }
    setLoading(true);
    setError(null);
    setNotice(null);
    setSelected(new Set());
    try {
      const res = await fetch(
        `/api/github/issues?repo=${encodeURIComponent(repo)}&state=${state}`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `조회 실패 (${res.status})`);
      setIssues(data);
      if (data.length === 0) setNotice("이슈가 없습니다.");
    } catch (e) {
      setError((e as Error).message);
      setIssues([]);
    } finally {
      setLoading(false);
    }
  }

  function toggle(n: number) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  async function importSelected() {
    if (!projectId) {
      setError("프로젝트를 선택하세요.");
      return;
    }
    if (selected.size === 0) {
      setError("가져올 이슈를 선택하세요.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/issues/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          repo,
          numbers: Array.from(selected),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `가져오기 실패 (${res.status})`);
      setNotice(`${data.imported}개 이슈를 큐에 추가했습니다.`);
      setSelected(new Set());
      onImported();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card">
      <h2>GitHub에서 이슈 가져오기</h2>

      {configured === false && (
        <div
          className="error-text"
          style={{ marginTop: 0, marginBottom: 12 }}
        >
          ⚠ GITHUB_TOKEN이 설정되지 않았습니다. 비공개 저장소 조회·코멘트 작성이 제한됩니다.
          (.env에 GITHUB_TOKEN을 설정하세요)
        </div>
      )}

      <div className="form-grid">
        <div className="field">
          <label>프로젝트 *</label>
          <select value={projectId} onChange={(e) => pickProject(e.target.value)}>
            <option value="">선택...</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>저장소 (owner/repo) *</label>
          <input
            value={repo}
            placeholder="owner/repo"
            onChange={(e) => setRepo(e.target.value)}
          />
        </div>
        <div className="field">
          <label>상태</label>
          <select
            value={state}
            onChange={(e) =>
              setState(e.target.value as "open" | "closed" | "all")
            }
          >
            <option value="open">열림</option>
            <option value="closed">닫힘</option>
            <option value="all">전체</option>
          </select>
        </div>
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <button
            className="btn secondary"
            type="button"
            onClick={fetchIssues}
            disabled={loading}
          >
            {loading ? "불러오는 중..." : "이슈 불러오기"}
          </button>
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}
      {notice && (
        <div style={{ color: "var(--green)", fontSize: 13, marginTop: 8 }}>
          {notice}
        </div>
      )}

      {issues.length > 0 && (
        <>
          <table style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th style={{ width: 1 }}></th>
                <th>#</th>
                <th>제목</th>
                <th>라벨</th>
                <th>작성자</th>
              </tr>
            </thead>
            <tbody>
              {issues.map((i) => (
                <tr key={i.number}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(i.number)}
                      onChange={() => toggle(i.number)}
                    />
                  </td>
                  <td>
                    <a href={i.html_url} target="_blank" rel="noreferrer">
                      #{i.number}
                    </a>
                  </td>
                  <td>{i.title}</td>
                  <td className="mono">{i.labels.join(", ")}</td>
                  <td className="mono">{i.author}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 14 }}>
            <button
              className="btn"
              type="button"
              onClick={importSelected}
              disabled={loading || selected.size === 0}
            >
              선택한 {selected.size}개 큐에 추가
            </button>
          </div>
        </>
      )}
    </div>
  );
}
