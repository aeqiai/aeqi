import { create } from "zustand";
import { getScopedEntity } from "@/lib/appMode";

// Default = the draggable floor, so the rail opens at its leanest by
// default. Users who want more room drag the resizer; the value
// persists in localStorage.
const SIDEBAR_WIDTH_DEFAULT = 180;
const SIDEBAR_WIDTH_MIN = 180;
const SIDEBAR_WIDTH_MAX = 400;
export const PINNED_VIEWS_STORAGE_KEY = "aeqi_pinned_views";

export interface PinnedView {
  id: string;
  label: string;
  path: string;
  search: string;
  createdAt: string;
  trustId?: string;
}

export interface SavePinnedViewInput {
  label: string;
  path: string;
  search?: string;
  trustId?: string | null;
}

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

function normalizePinnedPath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function normalizePinnedSearch(search?: string): string {
  if (!search) return "";
  return search.startsWith("?") ? search : `?${search}`;
}

function normalizePinnedLabel(label: string, fallback = "Saved view"): string {
  const trimmed = label.trim();
  return trimmed || fallback;
}

function readStoredPinnedViews(): PinnedView[] {
  try {
    const raw = localStorage.getItem(PINNED_VIEWS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item): PinnedView[] => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<PinnedView>;
      if (
        typeof candidate.id !== "string" ||
        typeof candidate.label !== "string" ||
        typeof candidate.path !== "string"
      ) {
        return [];
      }

      return [
        {
          id: candidate.id,
          label: normalizePinnedLabel(candidate.label),
          path: normalizePinnedPath(candidate.path),
          search: normalizePinnedSearch(candidate.search),
          createdAt:
            typeof candidate.createdAt === "string"
              ? candidate.createdAt
              : new Date().toISOString(),
          trustId: typeof candidate.trustId === "string" ? candidate.trustId : undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}

function persistPinnedViews(views: PinnedView[]) {
  localStorage.setItem(PINNED_VIEWS_STORAGE_KEY, JSON.stringify(views));
}

function createPinnedViewId(): string {
  return `view-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface UIState {
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  activeEntity: string;
  collapsedGroups: Record<string, boolean>;
  pinnedViews: PinnedView[];
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  setActiveEntity: (id: string) => void;
  toggleGroup: (key: string) => void;
  savePinnedView: (input: SavePinnedViewInput) => PinnedView;
  removePinnedView: (id: string) => void;
}

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: localStorage.getItem("aeqi_sidebar_collapsed") === "true",
  sidebarWidth: readStoredSidebarWidth(),
  collapsedGroups: readStoredCollapsedGroups(),
  pinnedViews: readStoredPinnedViews(),
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
  savePinnedView: (input) => {
    const path = normalizePinnedPath(input.path);
    const search = normalizePinnedSearch(input.search);
    const trustId = input.trustId || undefined;
    const label = normalizePinnedLabel(input.label);
    const existing = get().pinnedViews.find(
      (view) => view.path === path && view.search === search && view.trustId === trustId,
    );
    const savedView: PinnedView = {
      id: existing?.id ?? createPinnedViewId(),
      label,
      path,
      search,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      trustId,
    };
    const next = [savedView, ...get().pinnedViews.filter((view) => view.id !== savedView.id)];

    persistPinnedViews(next);
    set({ pinnedViews: next });

    return savedView;
  },
  removePinnedView: (id) =>
    set((state) => {
      const next = state.pinnedViews.filter((view) => view.id !== id);
      persistPinnedViews(next);
      return { pinnedViews: next };
    }),
}));
