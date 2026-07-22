"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

const CARDS = [
  { key: "projects", label: "프로젝트", href: "/projects", endpoint: "/api/projects" },
  { key: "issues", label: "이슈 작업", href: "/issues", endpoint: "/api/issues" },
  { key: "cron", label: "크론 작업", href: "/cron", endpoint: "/api/cron" },
  { key: "skills", label: "스킬", href: "/skills", endpoint: "/api/skills" },
  { key: "mcp", label: "MCP 서버", href: "/mcp", endpoint: "/api/mcp" },
];

export default function Dashboard() {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const next: Record<string, number> = {};
      for (const c of CARDS) {
        try {
          const res = await fetch(c.endpoint);
          const data = await res.json();
          next[c.key] = Array.isArray(data) ? data.length : 0;
        } catch {
          next[c.key] = 0;
        }
      }
      setCounts(next);
    })();
  }, []);

  return (
    <div>
      <h1 className="page-title">대시보드</h1>
      <p className="page-desc">
        Claude Agent SDK 기반 관리 시스템 — 이슈 처리, 크론, 프로젝트, 스킬, MCP를 한 곳에서.
      </p>

      <div className="stat-grid">
        {CARDS.map((c) => (
          <Link key={c.key} href={c.href}>
            <div className="stat">
              <div className="num">{counts[c.key] ?? "—"}</div>
              <div className="lbl">{c.label}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <h2>시작하기</h2>
        <ol style={{ lineHeight: 1.9, paddingLeft: 20, color: "var(--muted)" }}>
          <li>
            <strong>프로젝트</strong>를 먼저 만드세요 (작업 디렉터리 cwd, 모델, 허용 도구 지정).
          </li>
          <li>
            <strong>MCP 서버</strong>와 <strong>스킬</strong>을 등록해 프로젝트에 연결하세요.
          </li>
          <li>
            <strong>이슈</strong> 작업을 큐에 넣고 실행하거나, <strong>크론</strong>으로 정기 작업을 예약하세요.
          </li>
          <li>
            크론 상시 실행은 <span className="mono">npm run scheduler</span> 워커를 함께 띄우세요.
          </li>
        </ol>
      </div>
    </div>
  );
}
