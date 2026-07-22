"use client";

import { create } from "zustand";
import type { AuthResult, User } from "@claude-app/shared";
import { api, getToken, setToken } from "@/lib/api";

interface AuthState {
  user: User | null;
  loading: boolean;
  /** 앱 시작 시 1회 토큰 검증 */
  bootstrap: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  /** 프로필/사용자 정보 갱신(프로필 편집 후) */
  refresh: () => Promise<void>;
  logout: () => void;
}

let bootstrapped = false;

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  bootstrap: async () => {
    if (bootstrapped) return;
    bootstrapped = true;
    if (!getToken()) {
      set({ loading: false });
      return;
    }
    try {
      const user = await api.get<User>("/auth/me");
      set({ user, loading: false });
    } catch {
      setToken(null);
      set({ user: null, loading: false });
    }
  },
  login: async (email, password) => {
    const res = await api.post<AuthResult>(
      "/auth/login",
      { email, password },
      false,
    );
    setToken(res.accessToken);
    set({ user: res.user });
  },
  refresh: async () => {
    try {
      const user = await api.get<User>("/auth/me");
      set({ user });
    } catch {
      /* ignore */
    }
  },
  logout: () => {
    setToken(null);
    set({ user: null });
  },
}));
