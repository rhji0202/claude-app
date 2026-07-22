"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Project, ShareLinkScope, UserRole } from "@claude-app/shared";
import { api } from "@/lib/api";

interface Share {
  userId: string;
  email: string;
  name: string | null;
  role: UserRole;
}
interface ShareLink {
  id: string;
  token: string;
  scope: ShareLinkScope;
  expiresAt: string | null;
  createdAt: string;
}
interface NamedRef {
  id: string;
  name: string;
}

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<Project | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [allSkills, setAllSkills] = useState<NamedRef[]>([]);
  const [attachedSkills, setAttachedSkills] = useState<NamedRef[]>([]);
  const [allMcp, setAllMcp] = useState<NamedRef[]>([]);
  const [attachedMcp, setAttachedMcp] = useState<NamedRef[]>([]);
  const [error, setError] = useState<string | null>(null);

  // 폼 상태
  const [shareEmail, setShareEmail] = useState("");
  const [shareRole, setShareRole] = useState<"viewer" | "editor">("viewer");
  const [linkScope, setLinkScope] = useState<ShareLinkScope>("issue_report");
  const [skillSel, setSkillSel] = useState("");
  const [mcpSel, setMcpSel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [runResult, setRunResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, sh, lk, sk, ask, mc, amc] = await Promise.all([
        api.get<Project>(`/projects/${id}`),
        api.get<Share[]>(`/projects/${id}/shares`),
        api.get<ShareLink[]>(`/projects/${id}/share-links`),
        api.get<NamedRef[]>(`/skills`),
        api.get<NamedRef[]>(`/projects/${id}/skills`),
        api.get<NamedRef[]>(`/mcp`),
        api.get<NamedRef[]>(`/projects/${id}/mcp`),
      ]);
      setProject(p);
      setShares(sh);
      setLinks(lk);
      setAllSkills(sk);
      setAttachedSkills(ask);
      setAllMcp(mc);
      setAttachedMcp(amc);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const wrap = (fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  async function runAgent() {
    setRunning(true);
    setRunResult(null);
    try {
      const res = await api.post<{ status: string; text: string; error?: string }>(
        `/projects/${id}/run`,
        { prompt },
      );
      setRunResult(res.status === "ok" ? res.text : `오류: ${res.error}`);
    } catch (e) {
      setRunResult(`오류: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  if (!project) {
    return (
      <div>
        {error ? <div className="error-text">{error}</div> : <div className="empty">불러오는 중...</div>}
      </div>
    );
  }

  return (
    <div>
      <Link href="/projects" style={{ color: "var(--muted)" }}>
        ← 프로젝트
      </Link>
      <h1 className="page-title" style={{ marginTop: 8 }}>
        {project.name}
      </h1>
      <p className="page-desc mono">{project.cwd}</p>
      {error && <div className="error-text">{error}</div>}

      {/* 팀 공유 */}
      <div className="card">
        <h2>팀 공유</h2>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <input
            placeholder="user@email.com"
            value={shareEmail}
            onChange={(e) => setShareEmail(e.target.value)}
            style={{ flex: 1 }}
          />
          <select value={shareRole} onChange={(e) => setShareRole(e.target.value as "viewer" | "editor")}>
            <option value="viewer">viewer</option>
            <option value="editor">editor</option>
          </select>
          <button
            className="btn"
            onClick={wrap(async () => {
              await api.post(`/projects/${id}/shares`, { email: shareEmail, role: shareRole });
              setShareEmail("");
            })}
          >
            공유
          </button>
        </div>
        {shares.length === 0 ? (
          <div className="empty">공유된 팀원이 없습니다.</div>
        ) : (
          <table>
            <tbody>
              {shares.map((s) => (
                <tr key={s.userId}>
                  <td>{s.email}</td>
                  <td>
                    <span className="badge queued">{s.role}</span>
                  </td>
                  <td style={{ width: 1 }}>
                    <button
                      className="btn small danger"
                      onClick={wrap(() => api.del(`/projects/${id}/shares/${s.userId}`))}
                    >
                      해제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 공유 링크 */}
      <div className="card">
        <h2>공유 링크</h2>
        <p className="page-desc" style={{ marginBottom: 12 }}>
          <span className="mono">read</span>: 읽기 전용 대시보드 · <span className="mono">issue_report</span>:
          테스터가 로그인 없이 이슈 등록
        </p>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <select value={linkScope} onChange={(e) => setLinkScope(e.target.value as ShareLinkScope)}>
            <option value="issue_report">issue_report (이슈 등록)</option>
            <option value="read">read (읽기 전용)</option>
          </select>
          <button
            className="btn"
            onClick={wrap(() => api.post(`/projects/${id}/share-links`, { scope: linkScope }))}
          >
            링크 발급
          </button>
        </div>
        {links.length === 0 ? (
          <div className="empty">발급된 링크가 없습니다.</div>
        ) : (
          <table>
            <tbody>
              {links.map((l) => {
                const url = `${origin}/share/${l.token}`;
                return (
                  <tr key={l.id}>
                    <td>
                      <span className="badge queued">{l.scope}</span>
                    </td>
                    <td>
                      <a href={url} target="_blank" rel="noreferrer" className="mono">
                        {url.length > 48 ? url.slice(0, 48) + "…" : url}
                      </a>
                    </td>
                    <td style={{ width: 1 }}>
                      <button
                        className="btn small secondary"
                        onClick={() => navigator.clipboard?.writeText(url)}
                      >
                        복사
                      </button>
                    </td>
                    <td style={{ width: 1 }}>
                      <button
                        className="btn small danger"
                        onClick={wrap(() => api.del(`/share-links/${l.id}`))}
                      >
                        폐기
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 스킬 / MCP 연결 */}
      <div className="card">
        <h2>스킬 · MCP 연결</h2>
        <AttachRow
          label="스킬"
          all={allSkills}
          attached={attachedSkills}
          selected={skillSel}
          onSelect={setSkillSel}
          onAttach={wrap(async () => {
            if (skillSel) await api.post(`/projects/${id}/skills`, { skillId: skillSel });
          })}
          onDetach={(sid) => wrap(() => api.del(`/projects/${id}/skills/${sid}`))()}
        />
        <div style={{ height: 12 }} />
        <AttachRow
          label="MCP"
          all={allMcp}
          attached={attachedMcp}
          selected={mcpSel}
          onSelect={setMcpSel}
          onAttach={wrap(async () => {
            if (mcpSel) await api.post(`/projects/${id}/mcp`, { mcpServerId: mcpSel });
          })}
          onDetach={(mid) => wrap(() => api.del(`/projects/${id}/mcp/${mid}`))()}
        />
      </div>

      {/* 임의 실행 */}
      <div className="card">
        <h2>에이전트 실행</h2>
        <textarea
          placeholder="이 프로젝트 컨텍스트에서 실행할 프롬프트"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div style={{ marginTop: 10 }}>
          <button className="btn" disabled={running || !prompt} onClick={runAgent}>
            {running ? "실행 중..." : "실행"}
          </button>
        </div>
        {runResult && (
          <pre
            style={{
              marginTop: 12,
              whiteSpace: "pre-wrap",
              background: "var(--bg)",
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--border)",
            }}
          >
            {runResult}
          </pre>
        )}
      </div>
    </div>
  );
}

function AttachRow({
  label,
  all,
  attached,
  selected,
  onSelect,
  onAttach,
  onDetach,
}: {
  label: string;
  all: NamedRef[];
  attached: NamedRef[];
  selected: string;
  onSelect: (v: string) => void;
  onAttach: () => void;
  onDetach: (id: string) => void;
}) {
  const attachedIds = new Set(attached.map((a) => a.id));
  const available = all.filter((a) => !attachedIds.has(a.id));
  return (
    <div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <strong style={{ width: 48 }}>{label}</strong>
        <select value={selected} onChange={(e) => onSelect(e.target.value)} style={{ flex: 1 }}>
          <option value="">선택...</option>
          {available.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <button className="btn secondary small" onClick={onAttach}>
          연결
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", paddingLeft: 56 }}>
        {attached.length === 0 ? (
          <span className="mono" style={{ color: "var(--muted)" }}>
            연결된 {label} 없음
          </span>
        ) : (
          attached.map((a) => (
            <span key={a.id} className="badge ok" style={{ display: "inline-flex", gap: 6 }}>
              {a.name}
              <a style={{ cursor: "pointer" }} onClick={() => onDetach(a.id)}>
                ✕
              </a>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
