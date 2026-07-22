"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";

const CARDS = [
  { key: "projects", label: "프로젝트", href: "/projects", endpoint: "/projects" },
  { key: "issues", label: "이슈 작업", href: "/issues", endpoint: "/issues" },
  { key: "cron", label: "크론 작업", href: "/cron", endpoint: "/cron" },
  { key: "skills", label: "스킬", href: "/skills", endpoint: "/skills" },
  { key: "mcp", label: "MCP 서버", href: "/mcp", endpoint: "/mcp" },
];

export default function Dashboard() {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const next: Record<string, number> = {};
      for (const c of CARDS) {
        try {
          const data = await api.get<unknown[]>(c.endpoint);
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
            <strong>프로젝트</strong>를 만드세요 (작업 디렉터리, 모델, git 저장소·토큰, Anthropic API 키).
          </li>
          <li>
            프로젝트 <strong>관리</strong>에서 팀원 공유·공유 링크 발급, 스킬·MCP 연결을 설정하세요.
          </li>
          <li>
            <strong>이슈</strong>를 GitHub에서 가져오거나 수동 등록해 실행하고, <strong>크론</strong>으로 정기 작업을 예약하세요.
          </li>
          <li>
            <strong>공유 링크</strong>(issue_report)를 발급하면 테스터가 로그인 없이 이슈를 등록할 수 있습니다.
          </li>
        </ol>
      </div>
    </div>
  );
}
