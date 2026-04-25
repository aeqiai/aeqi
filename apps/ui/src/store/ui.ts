import { create } from "zustand";
import { getScopedRoot } from "@/lib/appMode";

const SIDEBAR_WIDTH_DEFAULT = 224;
const SIDEBAR_WIDTH_MIN = 180;
const SIDEBAR_WIDTH_MAX = 400;

function clampSidebarWidth(w: number): number {
  if (!Number.isFinite(w)) return SIDEBAR_WIDTH_DEFAULT;
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(w)));
}

function readStoredSidebarWidth(): number {
  const raw = localStorage.getItem("aeqi_sidebar_width");
  if (!raw) return SIDEBAR_WIDTH_DEFAULT;
  return clampSidebarWidth(Number(raw));
}

interface UIState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  activeRoot: string;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setActiveRoot: (id: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: localStorage.getItem("aeqi_sidebar_collapsed") === "true",
  sidebarWidth: readStoredSidebarWidth(),
  toggleSidebar: () =>
    set((state) => {
      const next = !state.sidebarCollapsed;
      localStorage.setItem("aeqi_sidebar_collapsed", String(next));
      return { sidebarCollapsed: next };
    }),
  setSidebarWidth: (w: number) => {
    const next = clampSidebarWidth(w);
    localStorage.setItem("aeqi_sidebar_width", String(next));
    set({ sidebarWidth: next });
  },
  activeRoot: getScopedRoot(),
  setActiveRoot: (id) => {
    if (id) {
      localStorage.setItem("aeqi_root", id);
    } else {
      localStorage.removeItem("aeqi_root");
    }
    set({ activeRoot: id });
  },
}));
