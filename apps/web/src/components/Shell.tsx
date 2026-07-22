"use client";

import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/auth";
import Sidebar from "./Sidebar";
import LoginForm from "./LoginForm";

function AuthedShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();

  if (loading) {
    return <div className="empty" style={{ marginTop: 80 }}>불러오는 중...</div>;
  }
  if (!user) return <LoginForm />;

  return (
    <div className="layout">
      <Sidebar user={user} onLogout={logout} />
      <main className="content">{children}</main>
    </div>
  );
}

export default function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // 공유 링크 페이지는 로그인 없이 접근 (사이드바/게이트 없음)
  const isPublic = pathname?.startsWith("/share");

  return (
    <AuthProvider>
      {isPublic ? children : <AuthedShell>{children}</AuthedShell>}
    </AuthProvider>
  );
}
