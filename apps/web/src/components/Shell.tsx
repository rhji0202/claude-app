"use client";

import { usePathname } from "next/navigation";
import { Bot, Menu } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useUiStore } from "@/stores/ui-store";
import Sidebar from "./Sidebar";
import LoginForm from "./LoginForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";

function LoadingShell() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 p-8">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-4 w-full max-w-md" />
      <div className="grid grid-cols-2 gap-4 pt-4 md:grid-cols-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    </div>
  );
}

function AuthedShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUiStore((s) => s.setSidebarOpen);
  const pathname = usePathname();
  // 이슈 목록은 컬럼이 많아 넓은 폭이 필요 → 이 페이지만 더 넓게.
  const wide = pathname?.startsWith("/issues");

  if (loading) return <LoadingShell />;
  if (!user) return <LoginForm />;

  return (
    <div className="flex min-h-dvh">
      {/* 데스크톱 고정 사이드바 (>=lg) */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 border-r border-sidebar-border lg:block">
        <Sidebar user={user} onLogout={logout} />
      </aside>

      {/* 모바일 드로어 (<lg) */}
      <Dialog open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <DialogContent className="left-0 top-0 h-dvh w-64 max-w-[80vw] translate-x-0 translate-y-0 gap-0 rounded-none border-y-0 border-l-0 p-0 data-[state=open]:animate-none">
          <DialogTitle className="sr-only">내비게이션</DialogTitle>
          <Sidebar user={user} onLogout={logout} />
        </DialogContent>
      </Dialog>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* 모바일 상단 앱바 */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(true)}
            aria-label="메뉴 열기"
          >
            <Menu className="size-5" />
          </Button>
          <div className="flex items-center gap-2 font-bold">
            <Bot className="size-5 text-accent" />
            더원 에이전트
          </div>
        </header>

        <main
          className={`mx-auto w-full flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8 ${
            wide ? "max-w-screen-2xl" : "max-w-6xl"
          }`}
        >
          {children}
        </main>
      </div>
    </div>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // 공유 링크 페이지는 로그인 없이 접근 (사이드바/게이트 없음)
  const isPublic = pathname?.startsWith("/share");

  if (isPublic) return <>{children}</>;
  return <AuthedShell>{children}</AuthedShell>;
}
