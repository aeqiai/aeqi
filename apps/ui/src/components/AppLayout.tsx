import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import CommandPalette from "./CommandPalette";
import AgentPage from "./AgentPage";
import LeftSidebar from "./shell/LeftSidebar";
import SessionsRail from "./shell/SessionsRail";
import ComposerRow from "./shell/ComposerRow";
import BootLoader from "./shell/BootLoader";
import ShortcutsOverlay from "./ShortcutsOverlay";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useDaemonSocket } from "@/hooks/useDaemonSocket";
import { useShellSurface } from "@/hooks/useShellSurface";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { isRateLimited } from "@/lib/rateLimit";
import RateLimitBanner from "./shell/RateLimitBanner";
import type { Agent } from "@/lib/types";

const DrivePage = lazy(() => import("@/pages/DrivePage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const StartPage = lazy(() => import("@/pages/StartPage"));
const BlueprintsPage = lazy(() => import("@/pages/BlueprintsPage"));
const BlueprintDetailPage = lazy(() => import("@/pages/BlueprintDetailPage"));
const EconomyPage = lazy(() => import("@/pages/EconomyPage"));
const HomeDashboard = lazy(() => import("./HomeDashboard"));
const UserInboxSessionView = lazy(() => import("./inbox/UserInboxSessionView"));

function findRoot(agents: Agent[], id: string): Agent | null {
  const byId = new Map<string, Agent>(agents.map((a) => [a.id, a]));
  let current = byId.get(id);
  for (let i = 0; i < 20 && current; i++) {
    if (!current.parent_id) return current;
    current = byId.get(current.parent_id);
  }
  return current || null;
}

export default function AppLayout() {
  const location = useLocation();
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
  const activeRoot = useUIStore((s) => s.activeRoot);

  // Declared above any conditional return so the inbox-agent hook below
  // can read surface.userSessionId without violating React's rules-of-hooks.
  const surface = useShellSurface(path, agentId, tab);
  const inboxAgentId = useInboxStore((s) =>
    surface.userSessionId
      ? (s.items.find((i) => i.session_id === surface.userSessionId)?.agent_id ?? null)
      : null,
  );

  const { currentAgent, rootAgent } = useMemo(() => {
    const current = agents.find((a) => a.id === agentId || a.name === agentId) || null;
    const root = current ? findRoot(agents, current.id) : null;
    return {
      currentAgent: current,
      rootAgent: root,
    };
  }, [agents, agentId]);

  // We never fall back to the raw URL agentId here — a non-agent segment
  // (e.g. "profile") would otherwise get cached as the active root.
  const firstRoot = useMemo(() => agents.find((a) => !a.parent_id)?.id || null, [agents]);
  const activeRootValid = useMemo(
    () => (activeRoot && agents.some((a) => a.id === activeRoot) ? activeRoot : null),
    [agents, activeRoot],
  );
  const rootId = rootAgent?.id || activeRootValid || firstRoot || "";

  // Only commit a verified-real root — otherwise the pre-load render
  // can persist a bogus value into localStorage.
  useEffect(() => {
    if (rootId && agents.some((a) => a.id === rootId)) setActiveRoot(rootId);
  }, [rootId, agents, setActiveRoot]);

  useEffect(() => {
    const titles: Record<string, string> = {
      sessions: "home",
      channels: "Channels",
      drive: "Drive",
      settings: "Settings",
      tools: "Tools",
      profile: "Profile",
      billing: "Billing",
      agents: "agents",
      events: "events",
      quests: "quests",
      ideas: "ideas",
    };
    const section = tab || "sessions";
    const sectionTitle = titles[section] || section;
    const agentLabel = currentAgent?.name;
    document.title = agentLabel ? `${sectionTitle} — ${agentLabel} · æqi` : "æqi";
  }, [tab, currentAgent]);

  // Pause the periodic refresh while rate-limited — polling while blocked
  // just piles on more 429s and extends the window the user is stuck in.
  const fetchAll = useDaemonStore((s) => s.fetchAll);
  useEffect(() => {
    fetchAll();
    const i = setInterval(() => {
      if (isRateLimited()) return;
      fetchAll();
    }, 30000);
    return () => clearInterval(i);
  }, [fetchAll, rootId]);
  useDaemonSocket();

  const openSearch = useCallback(() => setSearching(true), []);
  const closeSearch = useCallback(() => setSearching(false), []);
  useGlobalShortcuts({
    agentId,
    searching,
    shortcutsOpen,
    openSearch,
    closeSearch,
    setShortcutsOpen,
  });

  const initialLoaded = useDaemonStore((s) => s.initialLoaded);
  const appMode = useAuthStore((s) => s.appMode);

  if (!initialLoaded) return <BootLoader />;

  // Stale `aeqi_root` after a data reset would point at a non-existent
  // agent. Bounce home — NOT to /new directly, which can self-loop when
  // a placement exists without a matching runtime agent.
  if (agentId && !currentAgent) {
    localStorage.removeItem("aeqi_root");
    return <Navigate to="/" replace />;
  }

  const {
    isHome,
    isSettings,
    isBlueprints,
    isEconomy,
    isDrive,
    isStart,
    isUserSession,
    userSessionId,
    blueprintSlug,
  } = surface;

  const base = agentId ? `/${encodeURIComponent(agentId)}` : "/";
  // No-tab URLs collapse to tab="sessions" so /:agentId renders the Inbox
  // directly — no redirect, no per-agent welcome splash.
  const effectiveTab = tab || "sessions";

  // Runtime mode has no account-level identity surface.
  if (isSettings && appMode && appMode !== "platform") {
    return <Navigate to="/" replace />;
  }

  // Collapse /:agentId/sessions (no session picked) onto bare /:agentId.
  // Keep /:agentId/sessions/:sessionId intact — the itemId is real state.
  if (agentId && tab === "sessions" && !itemId) {
    return <Navigate to={`/${encodeURIComponent(agentId)}`} replace />;
  }

  const mainContent = (() => {
    if (isStart) return <StartPage />;
    if (isUserSession && userSessionId) return <UserInboxSessionView sessionId={userSessionId} />;
    if (isHome) return <HomeDashboard />;
    if (isDrive) return <DrivePage />;
    if (isSettings) return <ProfilePage />;
    if (isBlueprints) return blueprintSlug ? <BlueprintDetailPage /> : <BlueprintsPage />;
    if (isEconomy) return <EconomyPage />;
    return <AgentPage agentId={agentId} tab={effectiveTab} itemId={itemId} />;
  })();

  const sessionsMounted =
    isUserSession ||
    (!isDrive &&
      !isSettings &&
      !isHome &&
      !isStart &&
      !isBlueprints &&
      !isEconomy &&
      effectiveTab === "sessions");
  const showComposer = sessionsMounted;
  // inbox-mode: at / and /sessions/:id (user scope) — items across all agents.
  // agent-mode: at /:agentId/sessions[/...] — that agent's sessions only.
  const inboxRail =
    (isHome || isUserSession) && !isSettings && !isBlueprints && !isEconomy && !isStart;
  const agentRail =
    effectiveTab === "sessions" && !!agentId && !isSettings && !isDrive && !isHome && !isStart;
  const showSessionsRail = inboxRail || agentRail;
  const railMode: "inbox" | "agent" = inboxRail ? "inbox" : "agent";

  return (
    <>
      <div className="shell">
        <LeftSidebar agentId={agentId} path={path} />

        <div className="content-column">
          <div className="content-card">
            <div className="content-paper">
              <div className="content-body-row">
                {showSessionsRail && (
                  <aside className="sessions-rail-col">
                    <SessionsRail mode={railMode} selectedSessionId={userSessionId} />
                  </aside>
                )}
                <div className="content-main-col">
                  <div className="content-scroll">
                    <Suspense fallback={null}>{mainContent}</Suspense>
                  </div>
                  {showComposer && (
                    <ComposerRow
                      agentId={agentId || inboxAgentId || null}
                      base={base}
                      sessionsMounted={sessionsMounted}
                      sessionId={isUserSession ? userSessionId : undefined}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
          <RateLimitBanner />
        </div>
      </div>
      <CommandPalette open={searching} onClose={closeSearch} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}
