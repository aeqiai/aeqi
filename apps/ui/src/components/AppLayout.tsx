import { useState, useEffect, useCallback } from "react";
import { useLocation, useSearchParams, useParams, Outlet } from "react-router-dom";
import CommandPalette from "./CommandPalette";
import AgentPage from "./AgentPage";
import ContentTopBar from "./ContentTopBar";
import ContentCTA from "./ContentCTA";
import LeftSidebar from "./shell/LeftSidebar";
import ComposerRow from "./shell/ComposerRow";
import BootLoader from "./shell/BootLoader";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { useDaemonSocket } from "@/hooks/useDaemonSocket";

/**
 * Top-level shell that composes the sidebar, content card, right rail, and
 * persistent composer. Owns only cross-cutting concerns: URL parsing, daemon
 * data bootstrap, ⌘K search toggling, and root-scope sync into the UI store.
 * Everything chunky (sidebar, composer, boot splash) lives in ./shell/*.
 */
export default function AppLayout() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [searching, setSearching] = useState(false);

  const routeParams = useParams<{
    root?: string;
    agentId?: string;
    tab?: string;
    itemId?: string;
  }>();
  const path = location.pathname;

  // Detect the root agent's chat URL: `/:root/sessions(/:itemId)?`. AppLayout
  // renders AgentPage for these without requiring `/agents/:rootId` in the URL.
  const rootSessionMatch = !routeParams.agentId
    ? path.match(/^\/[^/]+\/sessions(?:\/([^/]+))?\/?$/)
    : null;
  const rootSessionItemId = rootSessionMatch?.[1] || null;
  const isRootChat = !!rootSessionMatch;
  const agentId =
    routeParams.agentId ||
    searchParams.get("agent") ||
    (isRootChat ? routeParams.root || "" : null);

  // Sync URL root → store so sidebar nav still works on user-level pages
  // (e.g. /profile) where the URL has no :root segment.
  const setActiveRoot = useUIStore((s) => s.setActiveRoot);
  const activeRoot = useUIStore((s) => s.activeRoot);
  const rootId = routeParams.root || activeRoot || "";
  useEffect(() => {
    if (routeParams.root) setActiveRoot(routeParams.root);
  }, [routeParams.root, setActiveRoot]);

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
  if (!initialLoaded) return <BootLoader />;

  const base = `/${encodeURIComponent(rootId)}`;

  return (
    <>
      <div className="shell">
        <LeftSidebar rootId={rootId} agentId={agentId} path={path} />

        <div className="content-column">
          <div className="content-card">
            <div className="content-main">
              {agentId ? (
                <AgentPage
                  agentId={agentId}
                  tab={isRootChat ? "sessions" : undefined}
                  itemId={isRootChat ? rootSessionItemId : undefined}
                />
              ) : (
                <>
                  <ContentTopBar />
                  <div className="content-scroll">
                    <Outlet />
                  </div>
                </>
              )}
            </div>
            <aside className="content-cta-col">
              <ContentCTA />
            </aside>
          </div>
          <ComposerRow agentId={agentId} base={base} />
        </div>
      </div>
      <CommandPalette open={searching} onClose={closeSearch} />
    </>
  );
}
