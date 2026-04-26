import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useUIStore } from "@/store/ui";

interface Options {
  agentId: string;
  searching: boolean;
  shortcutsOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  setShortcutsOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
}

/**
 * Owns every keyboard shortcut + custom-event listener AppLayout
 * used to grow inline. Single useEffect, single keydown handler,
 * single set of rules — easier to read than the three useEffects it
 * replaces, and no risk of an event listener slipping out of sync
 * with its captured deps because everything lives behind one closure.
 *
 * Bindings:
 *   ⌘K / Ctrl+K — toggle command palette
 *   ⌘B / Ctrl+B — toggle sidebar (VS Code convention)
 *   ?           — toggle shortcuts cheatsheet
 *   /           — open palette (vim-style)
 *   Esc         — close palette / cheatsheet
 *   N           — spawn a sub-agent under the current agent
 *   C           — focus the composer
 *   g then a/e/q/i/s — vim-style two-key go-to prefix
 *
 * Custom events bridged from elsewhere in the app:
 *   aeqi:open-palette    — open the command palette
 *   aeqi:open-shortcuts  — open the cheatsheet overlay
 */
export function useGlobalShortcuts({
  agentId,
  searching,
  shortcutsOpen,
  openSearch,
  closeSearch,
  setShortcutsOpen,
}: Options) {
  const navigate = useNavigate();

  // Vim go-to prefix deadline. Ref (not state) so changing it doesn't
  // re-bind the keydown handler — and so the deadline stays stable
  // across the brief window between `g` and the follow-up key.
  const gDeadlineRef = useRef<number>(0);

  // Custom-event bridges fired by topbar buttons / palette wrappers.
  useEffect(() => {
    window.addEventListener("aeqi:open-palette", openSearch);
    return () => window.removeEventListener("aeqi:open-palette", openSearch);
  }, [openSearch]);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), [setShortcutsOpen]);
  useEffect(() => {
    window.addEventListener("aeqi:open-shortcuts", openShortcuts);
    return () => window.removeEventListener("aeqi:open-shortcuts", openShortcuts);
  }, [openShortcuts]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (searching) closeSearch();
        else openSearch();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        useUIStore.getState().toggleSidebar();
        return;
      }
      if (e.key === "Escape") {
        if (searching) closeSearch();
        if (shortcutsOpen) setShortcutsOpen(false);
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      // Palette + cheatsheet both own the keyboard while open — don't
      // let `n` / `c` / g-prefix navigate the user out from under an
      // overlay or interrupt real text entry.
      if (isEditable || searching || shortcutsOpen) return;

      // Vim go-to prefix: if `g` was tapped within the deadline, this
      // key is the destination. s→inbox, a→agents, e→events, q→quests,
      // i→ideas. Runs even when agentId is absent (no-op on empty
      // scope).
      if (gDeadlineRef.current > Date.now() && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const key = e.key.toLowerCase();
        const tabs: Record<string, string> = {
          s: "",
          a: "agents",
          e: "events",
          q: "quests",
          i: "ideas",
        };
        if (key in tabs && agentId) {
          e.preventDefault();
          gDeadlineRef.current = 0;
          const seg = tabs[key];
          const base = `/${encodeURIComponent(agentId)}`;
          navigate(seg ? `${base}/${seg}` : base);
          return;
        }
        // Any other key cancels the prefix so the next tap is normal.
        gDeadlineRef.current = 0;
      }
      if (e.key.toLowerCase() === "g" && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        gDeadlineRef.current = Date.now() + 1500;
        return;
      }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShortcutsOpen((s) => !s);
        return;
      }
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openSearch();
        return;
      }
      if (e.key.toLowerCase() === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        navigate(agentId ? `/new?parent=${encodeURIComponent(agentId)}` : "/start");
        return;
      }
      if (e.key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("aeqi:focus-composer"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searching, shortcutsOpen, openSearch, closeSearch, setShortcutsOpen, agentId, navigate]);
}
