import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useLocation, useParams } from "react-router-dom";
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

// Root-only pages — lazy to keep AppLayout light for child-agent navigation.
const RuntimeHomePage = lazy(() => import("@/pages/RuntimeHomePage"));
const WelcomePage = lazy(() => import("@/pages/WelcomePage"));
const DrivePage = lazy(() => import("@/pages/DrivePage"));
const AppsPage = lazy(() => import("@/pages/AppsPage"));

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
  const { rootAgent, isRoot } = useMemo(() => {
    const current = agents.find((a) => a.id === agentId || a.name === agentId) || null;
    const root = current ? findRoot(agents, current.id) : null;
    return {
      rootAgent: root,
      isRoot: !!current && !current.parent_id,
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

  const base = `/${encodeURIComponent(agentId)}`;

  // Pick what renders in the main content area.
  //   - no tab + root + platform mode  → welcome card (onboarding)
  //   - no tab + root                  → dashboard home
  //   - drive / apps (root-only)       → dedicated pages
  //   - everything else                → AgentPage with tab/itemId
  const rootOnly = isRoot && (tab === "drive" || tab === "apps");
  const rootDefault = isRoot && !tab;

  const mainContent = (() => {
    if (rootDefault) {
      return appMode === "platform" ? <WelcomePage /> : <RuntimeHomePage />;
    }
    if (rootOnly && tab === "drive") return <DrivePage />;
    if (rootOnly && tab === "apps") return <AppsPage />;
    return <AgentPage agentId={agentId} tab={tab} itemId={itemId} />;
  })();

  const usesTopBar = rootDefault || rootOnly;

  return (
    <>
      <div className="shell">
        <LeftSidebar rootId={rootId} agentId={agentId} path={path} />

        <div className="content-column">
          <div className="content-card">
            <div className="content-main">
              {usesTopBar ? (
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
            <aside className="content-cta-col">
              <ContentCTA />
            </aside>
          </div>
          <ComposerRow agentId={agentId || null} base={base} />
        </div>
      </div>
      <CommandPalette open={searching} onClose={closeSearch} />
    </>
  );
}
