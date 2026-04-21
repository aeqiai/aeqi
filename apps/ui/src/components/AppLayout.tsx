import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import CommandPalette from "./CommandPalette";
import AgentPage from "./AgentPage";
import ContentTopBar from "./ContentTopBar";
import ContentCTA from "./ContentCTA";
import LeftSidebar from "./shell/LeftSidebar";
import SessionsRail from "./shell/SessionsRail";
import ComposerRow from "./shell/ComposerRow";
import BootLoader from "./shell/BootLoader";
import ShortcutsOverlay from "./ShortcutsOverlay";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useDaemonSocket } from "@/hooks/useDaemonSocket";
import type { Agent } from "@/lib/types";

// Out-of-flow pages rendered inside the shell — lazy to keep AppLayout light.
// Drive is root-only. Profile is user-scoped but lives under
// /:agentId/profile so it inherits the sidebar + tree chrome (Refined A).
const DrivePage = lazy(() => import("@/pages/DrivePage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));

/** Walk up parent_id to find the root ancestor. */
function findRoot(agents: Agent[], id: string): Agent | null {
  const byId = new Map<string, Agent>(agents.map((a) => [a.id, a]));
  let current = byId.get(id);
  for (let i = 0; i < 20 && current; i++) {
    if (!current.parent_id) return current;
    current = byId.get(current.parent_id);
  }
  return current || null;
}

/**
 * Top-level shell: sidebar, content card, right rail, persistent composer.
 *
 * Version B: routes are flat — `/:agentId/[:tab/[:itemId]]`. This component
 * parses those params, resolves the target agent, derives the tree's root
 * from the parent chain, and routes to the right tab renderer. No more
 * `/agents/` URL segment, no regex URL sniffing.
 */
export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searching, setSearching] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const {
    agentId = "",
    tab,
    itemId,
  } = useParams<{
    agentId?: string;
    tab?: string;
    itemId?: string;
  }>();
  const path = location.pathname;

  const agents = useDaemonStore((s) => s.agents);
  const setActiveRoot = useUIStore((s) => s.setActiveRoot);

  // Resolve current agent + derive the root of its tree.
  const { currentAgent, rootAgent } = useMemo(() => {
    const current = agents.find((a) => a.id === agentId || a.name === agentId) || null;
    const root = current ? findRoot(agents, current.id) : null;
    return {
      currentAgent: current,
      rootAgent: root,
    };
  }, [agents, agentId]);

  const rootId = rootAgent?.id || agentId;

  // Sync the active root scope into the UI store (used by /profile etc.).
  useEffect(() => {
    if (rootId) setActiveRoot(rootId);
  }, [rootId, setActiveRoot]);

  // Browser tab title — echoes the current primitive + agent so multi-tab
  // power users can scan their window strip. Format mirrors the in-app
  // breadcrumb: "<section> — <agent> · æqi". Bare "æqi" before an agent
  // resolves.
  useEffect(() => {
    const titles: Record<string, string> = {
      sessions: "Inbox",
      channels: "Channels",
      drive: "Drive",
      settings: "Settings",
      tools: "Tools",
      profile: "Profile",
      agents: "agents",
      events: "events",
      quests: "quests",
      ideas: "ideas",
    };
    const section = tab || "sessions";
    const sectionTitle = titles[section] || section;
    const agentLabel = currentAgent?.display_name || currentAgent?.name;
    document.title = agentLabel ? `${sectionTitle} — ${agentLabel} · æqi` : "æqi";
  }, [tab, currentAgent]);

  // Daemon bootstrap + live updates.
  const fetchAll = useDaemonStore((s) => s.fetchAll);
  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, 30000);
    return () => clearInterval(i);
  }, [fetchAll, rootId]);
  useDaemonSocket();

  // Global keyboard shortcuts:
  //   ⌘K / Ctrl+K — command palette
  //   /           — command palette (vim-style)
  //   ?           — shortcuts cheatsheet
  //   Esc         — close palette / overlay
  //   N           — spawn a sub-agent under the current agent
  //   C           — focus the composer (write mode without a mouse)
  //   g then a/e/q/i/s — jump to Agents / Events / Quests / Ideas / inbox
  //                      for the current agent (vim-style go-to prefix;
  //                      letters match the sidebar's A-E-Q-I wordmark).
  //                      Skip when typing in an input/textarea, or when
  //                      modifiers are held, so real text entry is never
  //                      hijacked.
  const openSearch = useCallback(() => setSearching(true), []);
  const closeSearch = useCallback(() => setSearching(false), []);
  // Vim-style two-key prefix. When the user taps `g`, we set a deadline ~1.5s
  // ahead; the next letter during that window is treated as the navigation
  // target instead of whatever shortcut it would otherwise trigger. A ref
  // keeps the deadline stable across renders without re-binding the handler.
  const gDeadlineRef = useRef<number>(0);
  // The top-bar "Search" button dispatches `aeqi:open-palette` so callers
  // don't need AppLayout-scoped state threaded down — same pattern as the
  // per-tab `+ New X` buttons in the right rail.
  useEffect(() => {
    window.addEventListener("aeqi:open-palette", openSearch);
    return () => window.removeEventListener("aeqi:open-palette", openSearch);
  }, [openSearch]);
  // UI-triggered shortcuts overlay — lets the topbar `?` button open the
  // cheatsheet without prop-drilling the setter.
  useEffect(() => {
    const open = () => setShortcutsOpen(true);
    window.addEventListener("aeqi:open-shortcuts", open);
    return () => window.removeEventListener("aeqi:open-shortcuts", open);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (searching) closeSearch();
        else openSearch();
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
      if (isEditable || searching) return;
      // Vim go-to prefix: if the previous key was `g` within the window,
      // this key is the target. Consume + navigate, return before any other
      // shortcut gets a chance. s→inbox, a→agents, e→events, q→quests,
      // i→ideas. Runs even when agentId is absent (no-op on empty scope).
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
        navigate(agentId ? `/new?parent=${encodeURIComponent(agentId)}` : "/new");
        return;
      }
      if (e.key.toLowerCase() === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("aeqi:focus-composer"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searching, shortcutsOpen, openSearch, closeSearch, agentId, navigate]);

  const initialLoaded = useDaemonStore((s) => s.initialLoaded);
  const appMode = useAuthStore((s) => s.appMode);
  if (!initialLoaded) return <BootLoader />;

  // URL points at an agent that no longer exists (e.g., after a data reset
  // the stale `aeqi_root` localStorage still referenced it). Drop the stale
  // pointer and bounce to the entity picker — never to /new directly, which
  // can create a self-sustaining loop when a placement exists without a
  // matching runtime agent.
  if (agentId && !currentAgent) {
    localStorage.removeItem("aeqi_root");
    const firstRoot = agents.find((a) => !a.parent_id);
    if (firstRoot) {
      return <Navigate to={`/${encodeURIComponent(firstRoot.id)}`} replace />;
    }
    return <Navigate to="/" replace />;
  }

  const base = `/${encodeURIComponent(agentId)}`;

  // Pick what renders in the main content area.
  //   - drive                          → dedicated page (available on every agent)
  //   - profile                        → user profile (any agent scope)
  //   - no tab                         → Inbox (agent landing — same as tab="sessions")
  //   - everything else                → AgentPage with tab/itemId
  const isDrive = tab === "drive";
  const isProfile = tab === "profile";
  // Inbox is the default surface. No-tab URLs are treated identically to
  // tab="sessions" so /:agentId renders the Inbox directly — no redirect,
  // no "home" dashboard, no welcome splash.
  const effectiveTab = tab || "sessions";

  // Profile is platform-mode only — runtime mode has nowhere to manage
  // account-level identity, so kick back to the agent's Inbox.
  if (isProfile && appMode && appMode !== "platform") {
    return <Navigate to={`/${encodeURIComponent(agentId)}`} replace />;
  }

  const mainContent = (() => {
    if (isDrive) return <DrivePage />;
    if (isProfile) return <ProfilePage />;
    return <AgentPage agentId={agentId} tab={effectiveTab} itemId={itemId} />;
  })();

  // ContentTopBar is the primary per-agent nav — always mount it when there's
  // an agent in scope. Profile owns its own header and is user-scoped, so it
  // opts out. No-agent routes (pre-boot) render raw.
  const showTopBar = !!agentId && !isProfile;
  // Profile owns its own header + tabs and is user-scoped — composer and
  // CTA right rail are noise there.
  const showComposer = !isProfile && !!agentId;
  const showCTA = !isProfile;
  // The rail only has content for tabs that are master/detail. Drive,
  // settings → rail reserves its space (no twitch) but is left empty and
  // transparent so the card reads as one clean pane.
  const RAIL_TABS = new Set(["events", "channels", "tools", "quests", "ideas", "agents"]);
  const hasRailContent = RAIL_TABS.has(effectiveTab);
  // AgentSessionView only mounts when AgentPage is rendered on the Inbox surface.
  const sessionsMounted = !isDrive && !isProfile && effectiveTab === "sessions";
  // Inbox gets its own left-adjacent threads rail instead of the right rail,
  // so the master/detail pair flows with natural reading order.
  const showSessionsRail = effectiveTab === "sessions" && !!agentId && !isProfile && !isDrive;

  return (
    <>
      <div className="shell">
        <LeftSidebar rootId={rootId} agentId={agentId} path={path} />

        {showSessionsRail && (
          <aside className="sessions-rail-col">
            <SessionsRail />
          </aside>
        )}

        <div className={`content-column${showCTA && !hasRailContent ? " no-rail" : ""}`}>
          <div className="content-main-stack">
            <div className="content-card">
              {showTopBar ? (
                <>
                  <ContentTopBar />
                  <div className="content-scroll">
                    <Suspense fallback={null}>{mainContent}</Suspense>
                  </div>
                </>
              ) : (
                <Suspense fallback={null}>{mainContent}</Suspense>
              )}
            </div>
            {showComposer && (
              <ComposerRow
                agentId={agentId || null}
                base={base}
                sessionsMounted={sessionsMounted}
              />
            )}
          </div>
          {showCTA && hasRailContent && (
            <aside className="content-cta-col">
              <ContentCTA />
            </aside>
          )}
        </div>
      </div>
      <CommandPalette open={searching} onClose={closeSearch} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
