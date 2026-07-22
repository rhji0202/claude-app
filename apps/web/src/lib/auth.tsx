"use client";

/**
 * 하위호환 shim. 실제 상태는 zustand(useAuthStore)로 이전됨.
 * 기존 페이지의 `import { useAuth } from "@/lib/auth"` 경로를 유지한다.
 */

import { useEffect } from "react";
import { useAuthStore } from "@/stores/auth-store";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);
  return <>{children}</>;
}

export function useAuth() {
  return useAuthStore();
}
