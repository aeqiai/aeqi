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

// Out-of-flow pages rendered inside the shell — lazy to keep AppLayout light.
// Drive is root-only. Profile is user-scoped and lives at top-level `/profile`
// (never namespaced under an agent) — it inherits the sidebar + tree chrome.
const DrivePage = lazy(() => import("@/pages/DrivePage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const BlueprintsPage = lazy(() => import("@/pages/BlueprintsPage"));
const EconomyPage = lazy(() => import("@/pages/EconomyPage"));
// HomeDashboard is the `/` landing — user-scoped summary across every
// company the user has.
const HomeDashboard = lazy(() => import("./HomeDashboard"));
const UserInboxSessionView = lazy(() => import("./inbox/UserInboxSessionView"));

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
 * Top-level shell: sidebar, content card, persistent composer. (The old
 * right rail was removed — each tab now renders its own inline picker.)
 *
 * Version B: routes are flat — `/:agentId/[:tab/[:itemId]]`. This component
 * parses those params, resolves the target agent, derives the tree's root
 * from the parent chain, and routes to the right tab renderer. No more
 * `/agents/` URL segment, no regex URL sniffing.
 */
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

  // Surface flags — every "is this the X page?" derivation in one
  // place. Pure path/param parsing; declared up here so the inbox-
  // agent hook below can read userSessionId without violating React's
  // rules-of-hooks (no early returns between hook calls).
  const surface = useShellSurface(path, agentId, tab);
  const inboxAgentId = useInboxStore((s) =>
    surface.userSessionId
      ? (s.items.find((i) => i.session_id === surface.userSessionId)?.agent_id ?? null)
      : null,
  );

  // Resolve current agent + derive the root of its tree.
  const { currentAgent, rootAgent } = useMemo(() => {
    const current = agents.find((a) => a.id === agentId || a.name === agentId) || null;
    const root = current ? findRoot(agents, current.id) : null;
    return {
      currentAgent: current,
      rootAgent: root,
    };
  }, [agents, agentId]);

  // Fallback root for context-less routes (/, /profile, /drive) so the sidebar
  // surface-nav + tree expansion render the same everywhere. Prefer:
  //   current agent's root → last-visited root (if it still exists) → first root.
  // We deliberately do NOT fall back to the raw `agentId` from the URL — if
  // it doesn't resolve to a real agent we've already redirected home above,
  // and we never want to cache a non-agent segment (e.g. "profile") as the
  // active root.
  const firstRoot = useMemo(() => agents.find((a) => !a.parent_id)?.id || null, [agents]);
  const activeRootValid = useMemo(
    () => (activeRoot && agents.some((a) => a.id === activeRoot) ? activeRoot : null),
    [agents, activeRoot],
  );
  const rootId = rootAgent?.id || activeRootValid || firstRoot || "";

  // Sync the active root scope into the UI store (used by /profile etc.).
  // Only commit once we have a verified-real root, otherwise the initial
  // pre-load render can persist a bogus value into localStorage.
  useEffect(() => {
    if (rootId && agents.some((a) => a.id === rootId)) setActiveRoot(rootId);
  }, [rootId, agents, setActiveRoot]);

  // Browser tab title — echoes the current primitive + agent so multi-tab
  // power users can scan their window strip. Format mirrors the in-app
  // breadcrumb: "<section> — <agent> · æqi". Bare "æqi" before an agent
  // resolves.
  useEffect(() => {
    const titles: Record<string, string> = {
      sessions: "home",
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
    const agentLabel = currentAgent?.name;
    document.title = agentLabel ? `${sectionTitle} — ${agentLabel} · æqi` : "æqi";
  }, [tab, currentAgent]);

  // Daemon bootstrap + live updates.  We pause the periodic refresh while
  // the central 429 state says we're rate-limited — polling while blocked
  // just piles on more 429s and extends the window the user is stuck.
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

  // Global keyboard shortcuts + custom-event bridges all live in one
  // hook so this component reads as a layout, not a keystroke router.
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

  // URL points at an agent that no longer exists (e.g., after a data reset
  // the stale `aeqi_root` localStorage still referenced it). Drop the stale
  // pointer and bounce home — never to /new directly, which can create a
  // self-sustaining loop when a placement exists without a matching runtime
  // agent.
  if (agentId && !currentAgent) {
    localStorage.removeItem("aeqi_root");
    return <Navigate to="/" replace />;
  }

  // Surface flags from the hook above; destructured here so the
  // rendering logic below reads as a flat decision tree.
  const { isHome, isSettings, isBlueprints, isEconomy, isDrive, isUserSession, userSessionId } =
    surface;

  const base = agentId ? `/${encodeURIComponent(agentId)}` : "/";
  // Inbox is the default surface. No-tab URLs are treated identically to
  // tab="sessions" so /:agentId renders the Inbox directly — no redirect,
  // no per-agent welcome splash.
  const effectiveTab = tab || "sessions";

  // User settings are platform-mode only — runtime mode has nowhere to
  // manage account-level identity, so kick back to `/`.
  if (isSettings && appMode && appMode !== "platform") {
    return <Navigate to="/" replace />;
  }

  // Canonicalize the per-agent sessions URL: `/:agentId/sessions` (no
  // session picked) renders the same surface as bare `/:agentId`, so
  // collapse it. Keep `/:agentId/sessions/:sessionId` intact — the
  // itemId is real state.
  if (agentId && tab === "sessions" && !itemId) {
    return <Navigate to={`/${encodeURIComponent(agentId)}`} replace />;
  }

  const mainContent = (() => {
    if (isUserSession && userSessionId) return <UserInboxSessionView sessionId={userSessionId} />;
    if (isHome) return <HomeDashboard />;
    if (isDrive) return <DrivePage />;
    if (isSettings) return <ProfilePage />;
    if (isBlueprints) return <BlueprintsPage />;
    if (isEconomy) return <EconomyPage />;
    return <AgentPage agentId={agentId} tab={effectiveTab} itemId={itemId} />;
  })();

  // AgentSessionView mounts on the per-agent sessions surface and on the
  // user-scope inbox session view. Both want the persistent composer +
  // streaming-state event bridge; the user-scope variant just resolves
  // its agent from the inbox row instead of from the URL.
  const sessionsMounted =
    isUserSession ||
    (!isDrive &&
      !isSettings &&
      !isHome &&
      !isBlueprints &&
      !isEconomy &&
      effectiveTab === "sessions");
  // Composer lives with the sessions surface. At user scope, hide it
  // when no session is selected — there's nothing to be texting to.
  const showComposer = sessionsMounted;
  // Sessions rail variants:
  //   - inbox mode: at /, /sessions/:id (and only at user scope) — list
  //     of awaiting items across every agent.
  //   - agent mode: at /:agentId/sessions[/...] — that agent's session list.
  // Other tabs render their own inline picker inside the content column
  // and own their full width.
  const inboxRail = (isHome || isUserSession) && !isSettings && !isBlueprints && !isEconomy;
  const agentRail = effectiveTab === "sessions" && !!agentId && !isSettings && !isDrive && !isHome;
  const showSessionsRail = inboxRail || agentRail;
  const railMode: "inbox" | "agent" = inboxRail ? "inbox" : "agent";

  return (
    <>
      <div className="shell">
        <LeftSidebar agentId={agentId} path={path} />

        <div className="content-column">
          <div className="content-card">
            {/* ContentTopBar dropped — after moving Settings to the
                LeftSidebar the band held only an avatar in user scope
                and a budget meter in agent scope, both better-placed
                inside the page that owns them. The empty strip read
                as a gap above every page. Page content now renders
                flush against the content card's top edge. */}
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
