import { create } from "zustand";
import { getScopedRoot } from "@/lib/appMode";

interface UIState {
  sidebarCollapsed: boolean;
  activeRoot: string;
  toggleSidebar: () => void;
  setActiveRoot: (id: string) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: localStorage.getItem("aeqi_sidebar_collapsed") === "true",
  toggleSidebar: () =>
    set((state) => {
      const next = !state.sidebarCollapsed;
      localStorage.setItem("aeqi_sidebar_collapsed", String(next));
      return { sidebarCollapsed: next };
    }),
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
