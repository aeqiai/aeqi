import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import CommandPalette from "./CommandPalette";
import AgentPage from "./AgentPage";
import ContentTopBar from "./ContentTopBar";
import ContentCTA from "./ContentCTA";
import LeftSidebar from "./shell/LeftSidebar";
import ComposerRow from "./shell/ComposerRow";
import BootLoader from "./shell/BootLoader";
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
  const [searching, setSearching] = useState(false);

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

  // Daemon bootstrap + live updates.
  const fetchAll = useDaemonStore((s) => s.fetchAll);
  useEffect(() => {
    fetchAll();
    const i = setInterval(fetchAll, 30000);
    return () => clearInterval(i);
  }, [fetchAll, rootId]);
  useDaemonSocket();

  // ⌘K / Ctrl+K command palette.
  const openSearch = useCallback(() => setSearching(true), []);
  const closeSearch = useCallback(() => setSearching(false), []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (searching) closeSearch();
        else openSearch();
      }
      if (e.key === "Escape" && searching) closeSearch();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searching, openSearch, closeSearch]);

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
  const RAIL_TABS = new Set([
    "sessions",
    "events",
    "channels",
    "tools",
    "quests",
    "ideas",
    "agents",
  ]);
  const hasRailContent = RAIL_TABS.has(effectiveTab);
  // AgentSessionView only mounts when AgentPage is rendered on the Inbox surface.
  const sessionsMounted = !isDrive && !isProfile && effectiveTab === "sessions";

  return (
    <>
      <div className="shell">
        <LeftSidebar rootId={rootId} agentId={agentId} path={path} />

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
    </>
  );
}
