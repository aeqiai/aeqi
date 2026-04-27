import { create } from "zustand";
import { getScopedEntity } from "@/lib/appMode";

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

function readStoredCollapsedGroups(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem("aeqi_sidebar_groups");
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

interface UIState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  activeEntity: string;
  collapsedGroups: Record<string, boolean>;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setActiveEntity: (id: string) => void;
  toggleGroup: (key: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: localStorage.getItem("aeqi_sidebar_collapsed") === "true",
  sidebarWidth: readStoredSidebarWidth(),
  collapsedGroups: readStoredCollapsedGroups(),
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
  activeEntity: getScopedEntity(),
  setActiveEntity: (id) => {
    if (id) {
      localStorage.setItem("aeqi_entity", id);
    } else {
      localStorage.removeItem("aeqi_entity");
    }
    set({ activeEntity: id });
  },
  toggleGroup: (key) =>
    set((state) => {
      const next = { ...state.collapsedGroups, [key]: !state.collapsedGroups[key] };
      localStorage.setItem("aeqi_sidebar_groups", JSON.stringify(next));
      return { collapsedGroups: next };
    }),
}));
