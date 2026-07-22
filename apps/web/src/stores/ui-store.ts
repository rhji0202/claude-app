"use client";

import { create } from "zustand";

interface UiState {
  /** 모바일(<lg) 사이드바 드로어 열림 여부 */
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  sidebarOpen: false,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
}));
