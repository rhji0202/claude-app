"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api } from "@/lib/api";

interface PublicView {
  scope: string;
  canReport: boolean;
  project: { id: string; name: string; description: string | null; gitRepo: string | null };
  issues: Array<{
    id: string;
    title: string;
    status: string;
    source: string;
    issueNumber: number | null;
    createdAt: string;
  }>;
}

export default function SharePage() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<PublicView | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 리포트 폼
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [reporter, setReporter] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await api.get<PublicView>(`/public/share/${token}`, false);
      setView(v);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSent(null);
    try {
      await api.post(`/public/share/${token}/issues`, { title, body, reporter }, false);
      setSent("이슈가 등록되었습니다. 감사합니다!");
      setTitle("");
      setBody("");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !view) {
    return (
      <div style={{ maxWidth: 720, margin: "60px auto", padding: 24 }}>
        <div className="card">
          <h2>접근 불가</h2>
          <div className="error-text">{error}</div>
        </div>
      </div>
    );
  }
  if (!view) {
    return <div className="empty" style={{ marginTop: 80 }}>불러오는 중...</div>;
  }

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", padding: 24 }}>
      <div style={{ marginBottom: 8, color: "var(--muted)", fontSize: 13 }}>
        🤖 Claude 관리 · 공유 링크
      </div>
      <h1 className="page-title">{view.project.name}</h1>
      {view.project.description && <p className="page-desc">{view.project.description}</p>}
      {view.project.gitRepo && (
        <p className="mono" style={{ marginTop: -8 }}>{view.project.gitRepo}</p>
      )}

      {view.canReport && (
        <div className="card">
          <h2>이슈 등록</h2>
          <p className="page-desc" style={{ marginBottom: 12 }}>
            로그인 없이 이슈를 등록할 수 있습니다.
          </p>
          <form onSubmit={submit}>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>제목 *</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="field" style={{ marginBottom: 10 }}>
              <label>내용</label>
              <textarea value={body} onChange={(e) => setBody(e.target.value)} />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label>작성자 (선택)</label>
              <input value={reporter} onChange={(e) => setReporter(e.target.value)} placeholder="이름/이메일" />
            </div>
            <button className="btn" type="submit" disabled={busy || !title}>
              {busy ? "등록 중..." : "이슈 등록"}
            </button>
            {sent && <div style={{ color: "var(--green)", fontSize: 13, marginTop: 8 }}>{sent}</div>}
            {error && <div className="error-text">{error}</div>}
          </form>
        </div>
      )}

      <div className="card">
        <h2>이슈 ({view.issues.length})</h2>
        {view.issues.length === 0 ? (
          <div className="empty">등록된 이슈가 없습니다.</div>
        ) : (
          <table>
            <tbody>
              {view.issues.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.issueNumber ? `#${i.issueNumber}` : i.source}</td>
                  <td>{i.title}</td>
                  <td>
                    <span className={`badge ${i.status}`}>{i.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
