"use client";

import { create } from "zustand";

export type Theme = "dark" | "light";

const STORAGE_KEY = "claude_theme";

function apply(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function readInitial(): Theme {
  if (typeof window === "undefined") return "dark";
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved === "light" || saved === "dark") return saved;
  // 저장값 없으면 다크 기본 (Modern Dark)
  return "dark";
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: readInitial(),
  setTheme: (theme) => {
    apply(theme);
    if (typeof window !== "undefined")
      window.localStorage.setItem(STORAGE_KEY, theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
}));
