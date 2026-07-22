"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  LayoutDashboard,
  FolderGit2,
  CircleDot,
  Clock,
  Sparkles,
  Server,
  MessageSquare,
  UserCircle,
  Users,
  LogOut,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import type { User } from "@claude-app/shared";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/theme-store";
import { useUiStore } from "@/stores/ui-store";
import { Button } from "@/components/ui/button";

type NavItem = { href: string; label: string; icon: LucideIcon; adminOnly?: boolean };
const NAV: NavItem[] = [
  { href: "/", label: "대시보드", icon: LayoutDashboard },
  { href: "/chat", label: "채팅", icon: MessageSquare },
  { href: "/projects", label: "프로젝트", icon: FolderGit2 },
  { href: "/issues", label: "GitHub 이슈", icon: CircleDot },
  { href: "/cron", label: "크론", icon: Clock },
  { href: "/skills", label: "스킬", icon: Sparkles },
  { href: "/mcp", label: "MCP 서버", icon: Server },
  { href: "/admin/users", label: "사용자", icon: Users, adminOnly: true },
  { href: "/account", label: "계정", icon: UserCircle },
];

export default function Sidebar({
  user,
  onLogout,
}: {
  user: User;
  onLogout: () => void;
}) {
  const pathname = usePathname();
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const closeSidebar = useUiStore((s) => s.setSidebarOpen);

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex items-center gap-2 px-5 py-5 text-base font-bold">
        <Bot className="size-5 text-accent" />
        Claude 관리
      </div>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.filter((item) => !item.adminOnly || user.role === "admin").map((item) => {
          const active =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => closeSidebar(false)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors md:py-2",
                active
                  ? "bg-accent/15 text-accent"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
              aria-current={active ? "page" : undefined}
            >
              <Icon className="size-4 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border p-3">
        <div className="flex items-center justify-between gap-2 px-1 pb-2">
          <span className="truncate text-xs text-muted-foreground">
            {user.name || user.email}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
          >
            {theme === "dark" ? (
              <Sun className="size-4" />
            ) : (
              <Moon className="size-4" />
            )}
          </Button>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          onClick={onLogout}
        >
          <LogOut className="size-4" />
          로그아웃
        </Button>
      </div>
    </div>
  );
}
