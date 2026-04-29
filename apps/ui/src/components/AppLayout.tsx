import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useParams } from "react-router-dom";
import CommandPalette from "./CommandPalette";
import AgentPage from "./AgentPage";
import LeftSidebar from "./shell/LeftSidebar";
import SessionsRail from "./shell/SessionsRail";
import ComposerRow from "./shell/ComposerRow";
import BootLoader from "./shell/BootLoader";
import ShortcutsOverlay from "./ShortcutsOverlay";
import { useDaemonStore } from "@/store/daemon";
import { activityKeys, agentKeys, entityKeys, questKeys, runtimeKeys } from "@/queries/keys";
import { useInboxStore } from "@/store/inbox";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useDaemonSocket } from "@/hooks/useDaemonSocket";
import { useShellSurface } from "@/hooks/useShellSurface";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { isRateLimited } from "@/lib/rateLimit";
import RateLimitBanner from "./shell/RateLimitBanner";
import ProjectsPage from "@/pages/ProjectsPage";
import CRMPage from "@/pages/CRMPage";
import MetricsPage from "@/pages/MetricsPage";
import OwnershipPage from "@/pages/OwnershipPage";
import TreasuryPage from "@/pages/TreasuryPage";
import GovernancePage from "@/pages/GovernancePage";

const DrivePage = lazy(() => import("@/pages/DrivePage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const StartPage = lazy(() => import("@/pages/StartPage"));
const EconomyPage = lazy(() => import("@/pages/EconomyPage"));
const CompanyPage = lazy(() => import("@/pages/CompanyPage"));
const Feed = lazy(() => import("./Feed"));
const MeInboxPage = lazy(() => import("@/pages/MeInboxPage"));
const MeQuestsPage = lazy(() => import("@/pages/MeQuestsPage"));
const MePortfolioPage = lazy(() => import("@/pages/MePortfolioPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));
const UserInboxSessionView = lazy(() => import("./inbox/UserInboxSessionView"));

// Tabs whose content is wrapped by CompanyPage's PageRail (Overview,
// Positions only — these are the company-specific surfaces). The four
// W-primitives (Agents, Events, Quests, Ideas) remain top-level
// destinations in the global LeftSidebar's Build group; they render
// through AgentPage directly with no PageRail wrapper.
const COMPANY_PAGERAIL_TABS = new Set(["overview", "positions"]);

export default function AppLayout() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searching, setSearching] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const {
    entityId: routeEntityId = "",
    agentId: routeAgentId = "",
    tab,
    itemId,
  } = useParams<{
    entityId?: string;
    agentId?: string;
    tab?: string;
    itemId?: string;
  }>();
  const path = location.pathname;

  const agents = useDaemonStore((s) => s.agents);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const activeEntity = useUIStore((s) => s.activeEntity);

  // Declared above any conditional return so the inbox-agent hook below
  // can read surface.userSessionId without violating React's rules-of-hooks.
  const surface = useShellSurface(path, tab);
  const inboxAgentId = useInboxStore((s) =>
    surface.userSessionId
      ? (s.items.find((i) => i.session_id === surface.userSessionId)?.agent_id ?? null)
      : null,
  );

  // The entity's root-agent record is the placeholder we synthesize from
  // `/api/entities` — its `entity_id` matches the route token. Every
  // company surface (`/c/<entity>/quests`, `/c/<entity>/events`, …)
  // resolves through this record.
  const rootAgent = useMemo(
    () => (routeEntityId ? (agents.find((a) => a.entity_id === routeEntityId) ?? null) : null),
    [agents, routeEntityId],
  );

  // When `/c/<entity>/agents/<agent>/...` is open, the inner agentId
  // is a direct lookup — no fuzzy matching, agents are entity-owned.
  const drilledAgent = useMemo(
    () => (routeAgentId ? (agents.find((a) => a.id === routeAgentId) ?? null) : null),
    [agents, routeAgentId],
  );

  // We never fall back to the raw URL token here — a non-entity segment
  // (e.g. "profile") would otherwise get cached as the active entity.
  const entities = useDaemonStore((s) => s.entities);
  const firstRoot = useMemo(() => entities[0]?.id ?? null, [entities]);
  const activeEntityValid = useMemo(
    () => (activeEntity && entities.some((e) => e.id === activeEntity) ? activeEntity : null),
    [entities, activeEntity],
  );
  const entityId = routeEntityId || activeEntityValid || firstRoot || "";

  // Only commit a verified-real entity — otherwise the pre-load render
  // can persist a bogus value into localStorage.
  useEffect(() => {
    if (entityId && entities.some((e) => e.id === entityId)) setActiveEntity(entityId);
  }, [entityId, entities, setActiveEntity]);

  useEffect(() => {
    const titles: Record<string, string> = {
      sessions: "home",
      channels: "Channels",
      drive: "Drive",
      settings: "Settings",
      tools: "Tools",
      profile: "Profile",
      billing: "Billing",
      agents: "Agents",
      events: "Events",
      quests: "Quests",
      ideas: "Ideas",
      projects: "Projects",
      overview: "Overview",
      crm: "CRM",
      metrics: "Metrics",
      ownership: "Ownership",
      treasury: "Treasury",
      governance: "Governance",
    };
    const section = tab || "sessions";
    const sectionTitle = titles[section] || section;
    const label = drilledAgent?.name ?? rootAgent?.name;
    document.title = label ? `${sectionTitle} — ${label} · æqi` : "æqi";
  }, [tab, drilledAgent, rootAgent]);

  // Pause the periodic refresh while rate-limited — polling while blocked
  // just piles on more 429s and extends the window the user is stuck in.
  const fetchAll = useDaemonStore((s) => s.fetchAll);
  const invalidateShellQueries = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: entityKeys.all });
    void queryClient.invalidateQueries({ queryKey: agentKeys.all });
    void queryClient.invalidateQueries({ queryKey: questKeys.all });
    void queryClient.invalidateQueries({ queryKey: activityKeys.all });
    void queryClient.invalidateQueries({ queryKey: runtimeKeys.all });
  }, [queryClient]);

  useEffect(() => {
    fetchAll();
    invalidateShellQueries();
    const i = setInterval(() => {
      if (isRateLimited()) return;
      fetchAll();
      invalidateShellQueries();
    }, 30000);
    return () => clearInterval(i);
  }, [fetchAll, entityId, invalidateShellQueries]);
  useDaemonSocket();

  const openSearch = useCallback(() => setSearching(true), []);
  const closeSearch = useCallback(() => setSearching(false), []);
  useGlobalShortcuts({
    entityId,
    searching,
    shortcutsOpen,
    openSearch,
    closeSearch,
    setShortcutsOpen,
  });

  const initialLoaded = useDaemonStore((s) => s.initialLoaded);
  const appMode = useAuthStore((s) => s.appMode);

  const {
    isHome,
    isSettings,
    isEconomy,
    isDrive,
    isStart,
    isUserSession,
    isNotFound,
    isMyInbox,
    isMyQuests,
    isMyPortfolio,
    userSessionId,
  } = surface;

  if (!initialLoaded) return <BootLoader />;

  const encodedEntityId = entityId ? encodeURIComponent(entityId) : "";
  const search = location.search || "";

  // Stale entity ref after a data reset would point at a non-existent
  // entity. Bounce home; the user picks (or creates) a fresh entity from
  // there.
  if (routeEntityId && !rootAgent) {
    localStorage.removeItem("aeqi_entity");
    return <Navigate to="/" replace />;
  }

  // The agent surface mounts on either the entity-root agent (company
  // tabs: /c/<entity>/quests, /c/<entity>/events, …) or the drilled
  // agent (per-agent tab: /c/<entity>/agents/<agent>/…). The active id
  // is the agent record's id — what AgentPage and the sub-tabs expect.
  const activeAgent = drilledAgent ?? rootAgent;
  const activeAgentId = activeAgent?.id ?? "";

  const base = encodedEntityId ? `/c/${encodedEntityId}` : "/";
  // No-tab at every scope renders Feed (the canonical home). Tabs
  // route to specific surfaces — overview/positions to CompanyPage,
  // sessions/quests/events/ideas/etc. to AgentPage. The default
  // fallback below handles tabs not enumerated explicitly.
  const effectiveTab = tab || "sessions";

  // Feed surfaces — the bare URL at each scope renders the Feed
  // component (one component, three modes).
  // - `/` (no tab, no entity): user feed.
  // - `/c/<entity>` (no tab, no drilled agent): company feed.
  // - `/c/<entity>/agents/<id>` (no tab, drilled agent): agent feed.
  const isCompanyFeed = !!routeEntityId && !drilledAgent && !tab && !isUserSession;
  const isAgentFeed = !!drilledAgent && !tab;

  // Runtime mode has no account-level identity surface.
  if (isSettings && appMode && appMode !== "platform") {
    return <Navigate to="/" replace />;
  }

  // Defensive: route should be unreachable if `agents/<agent>` resolves
  // to nothing — bounce up to the company shell.
  if (routeAgentId && !drilledAgent && encodedEntityId) {
    return <Navigate to={`/c/${encodedEntityId}${search}`} replace />;
  }

  const mainContent = (() => {
    if (isNotFound) return <NotFoundPage />;
    if (isStart) return <StartPage />;
    if (isUserSession && userSessionId) return <UserInboxSessionView sessionId={userSessionId} />;
    if (isMyInbox) return <MeInboxPage />;
    if (isMyQuests) return <MeQuestsPage />;
    if (isMyPortfolio) return <MePortfolioPage />;
    if (isHome) return <Feed scope="user" />;
    if (isCompanyFeed) return <Feed scope="company" entityId={routeEntityId} />;
    if (isAgentFeed) return <Feed scope="agent" entityId={routeEntityId} agentId={activeAgentId} />;
    if (isDrive) return <DrivePage />;
    if (isSettings) return <ProfilePage />;
    if (isEconomy) return <EconomyPage />;
    if (tab === "projects") return <ProjectsPage />;
    if (tab === "crm") return <CRMPage />;
    if (tab === "metrics") return <MetricsPage />;
    if (tab === "ownership") return <OwnershipPage />;
    if (tab === "treasury") return <TreasuryPage />;
    if (tab === "governance") return <GovernancePage />;
    if (routeEntityId && !drilledAgent && COMPANY_PAGERAIL_TABS.has(effectiveTab)) {
      return (
        <CompanyPage
          agentId={activeAgentId}
          entityId={routeEntityId}
          tab={effectiveTab}
          itemId={itemId}
        />
      );
    }
    return (
      <AgentPage
        agentId={activeAgentId}
        tab={effectiveTab}
        itemId={itemId}
        isDrilled={!!drilledAgent}
      />
    );
  })();

  // Composer + sessions rail mount only on the chat surface
  // (`/c/<entity>/agents/<id>/sessions[/...]` and `/sessions/<id>`
  // user-scope view). Feed surfaces are self-contained: no rail, no
  // composer. Inbox is its own destination at `/me/inbox`, also no
  // rail/composer (it's a list page).
  const isAnyFeed = isHome || isCompanyFeed || isAgentFeed;
  const sessionsMounted =
    !isNotFound &&
    (isUserSession ||
      (!isDrive &&
        !isSettings &&
        !isAnyFeed &&
        !isMyInbox &&
        !isMyQuests &&
        !isMyPortfolio &&
        !isStart &&
        !isEconomy &&
        effectiveTab === "sessions"));
  const showComposer = sessionsMounted;
  // The sessions rail only mounts in agent mode (drilled agent's
  // sessions chat). Inbox mode is gone — feed surfaces own the
  // attention surface for their scope; the dedicated `/me/inbox`
  // page renders inbox items inline (no rail).
  const showSessionsRail =
    isUserSession ||
    (effectiveTab === "sessions" &&
      !!routeEntityId &&
      !!drilledAgent &&
      !isSettings &&
      !isDrive &&
      !isStart &&
      !isNotFound);
  const railMode: "inbox" | "agent" = isUserSession ? "inbox" : "agent";

  return (
    <>
      <div className="shell">
        <LeftSidebar entityId={entityId} path={path} />

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
                      agentId={activeAgentId || inboxAgentId || null}
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
