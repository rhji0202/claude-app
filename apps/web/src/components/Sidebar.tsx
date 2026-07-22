"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { User } from "@claude-app/shared";

const NAV = [
  { href: "/", label: "대시보드", icon: "◆" },
  { href: "/projects", label: "프로젝트", icon: "▤" },
  { href: "/issues", label: "GitHub 이슈", icon: "◈" },
  { href: "/cron", label: "크론", icon: "◷" },
  { href: "/skills", label: "스킬", icon: "✦" },
  { href: "/mcp", label: "MCP 서버", icon: "⚙" },
];

export default function Sidebar({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="brand">🤖 Claude 관리</div>
      <nav>
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className={active ? "active" : ""}>
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: 12,
          right: 12,
          borderTop: "1px solid var(--border)",
          paddingTop: 12,
        }}
      >
        <div style={{ fontSize: 12, color: "var(--muted)", padding: "0 12px 8px" }}>
          {user.name || user.email}
        </div>
        <button
          className="btn secondary small"
          style={{ width: "100%" }}
          onClick={onLogout}
        >
          로그아웃
        </button>
      </div>
    </aside>
  );
}
