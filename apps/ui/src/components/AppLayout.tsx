import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useParams } from "react-router-dom";
import CommandPalette from "./CommandPalette";
import AgentPage, { AGENT_RAIL_TABS, AGENT_RAIL_SETTINGS_TABS } from "./AgentPage";
import LeftSidebar from "./shell/LeftSidebar";
import SessionsRail from "./shell/SessionsRail";
import PageRail from "./PageRail";
import ComposerRow from "./shell/ComposerRow";
import BootLoader from "./shell/BootLoader";
import ShortcutsOverlay from "./ShortcutsOverlay";
import { useDaemonStore } from "@/store/daemon";
import { activityKeys, agentKeys, entityKeys, questKeys, runtimeKeys } from "@/queries/keys";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useDaemonSocket } from "@/hooks/useDaemonSocket";
import { useShellSurface } from "@/hooks/useShellSurface";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { isRateLimited } from "@/lib/rateLimit";
import RateLimitBanner from "./shell/RateLimitBanner";

const DrivePage = lazy(() => import("@/pages/DrivePage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const StartPage = lazy(() => import("@/pages/StartPage"));
const CompanySetupPage = lazy(() => import("@/pages/CompanySetupPage"));
const EconomyPage = lazy(() => import("@/pages/EconomyPage"));
const CompanyPage = lazy(() => import("@/pages/CompanyPage"));
const MeInboxPage = lazy(() => import("@/pages/MeInboxPage"));
const PortfolioPage = lazy(() => import("@/pages/PortfolioPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));

// Tabs that route through CompanyPage. Overview is the canonical
// company landing; Roles is the org-chart; Cap Table / Treasury /
// Governance / Settings are the company's financial, decisions, and
// configuration surfaces. Treasury holds the full financial picture
// (balance, budgets, transactions) as sub-views once wired.
const COMPANY_PAGERAIL_TABS = new Set([
  "overview",
  "roles",
  "cap-table",
  "treasury",
  "governance",
  "settings",
]);

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

  const surface = useShellSurface(path, tab);

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
      overview: "Overview",
      "cap-table": "Cap Table",
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

  const { isSettings, isEconomy, isDrive, isStart, isNotFound, isMyInbox, isPortfolio } = surface;

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
  // No-tab default at entity scope = "overview" (the company
  // dashboard is the canonical landing). At user scope `/`, isMyInbox
  // dispatches before the tab default is consulted. Drilled agents
  // default to "sessions" so the bare drilled URL opens chat.
  const effectiveTab = tab || (routeEntityId && !drilledAgent ? "overview" : "sessions");

  // Runtime mode has no account-level identity surface.
  if (isSettings && appMode && appMode !== "platform") {
    return <Navigate to="/" replace />;
  }

  // Bare `/c/<entity>` doesn't render independently — `effectiveTab`
  // defaults to "overview" so CompanyPage handles the bare URL with
  // tab="overview". (An earlier JSX-level <Navigate> caused a render
  // loop; the dispatch path below is the canonical answer instead.)
  // The Overview sidebar item also lights at `/c/<entity>` to match.

  // Defensive: route should be unreachable if `agents/<agent>` resolves
  // to nothing — bounce up to the company shell.
  if (routeAgentId && !drilledAgent && encodedEntityId) {
    return <Navigate to={`/c/${encodedEntityId}${search}`} replace />;
  }

  const mainContent = (() => {
    if (isNotFound) return <NotFoundPage />;
    if (isStart) {
      // /start/<slug> → CompanySetupPage (the name + roles + plan
      // confirmation surface). Bare /start stays on the catalog
      // launch picker.
      if (path.startsWith("/start/")) return <CompanySetupPage />;
      return <StartPage />;
    }
    if (isMyInbox) return <MeInboxPage />;
    if (isPortfolio) return <PortfolioPage />;
    if (isDrive) return <DrivePage />;
    if (isSettings) return <ProfilePage />;
    if (isEconomy) return <EconomyPage />;
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
    return <AgentPage agentId={activeAgentId} tab={effectiveTab} itemId={itemId} />;
  })();

  // The chat composer + sessions rail only belong on the chat surface
  // (drilled agent at /c/<entity>/agents/<id>/sessions[/<sid>]). Inbox,
  // company overview, list pages — none of these mount the composer.
  // The legacy `/sessions/<id>` URL redirects to the deep shape
  // outside this shell, so we don't special-case it.
  const sessionsMounted =
    !isNotFound &&
    !isDrive &&
    !isSettings &&
    !isMyInbox &&
    !isPortfolio &&
    !isStart &&
    !isEconomy &&
    effectiveTab === "sessions";
  const showComposer = sessionsMounted;
  const showSessionsRail = sessionsMounted && !!routeEntityId && !!drilledAgent;

  // Drilled-agent PageRail. Mounted at the body-row level so it sits
  // as a sibling of the SessionsRail and the chat content column —
  // the order reads `[ rail | sessions list | chat ]` matching the
  // user's mental model. Active state collapses settings / tools /
  // integrations / plan onto the "settings" rail entry; the inner
  // SettingsShell renders the finer sub-rail itself.
  const showAgentRail = !!drilledAgent;
  const agentRailCurrent = AGENT_RAIL_SETTINGS_TABS.has(effectiveTab) ? "settings" : effectiveTab;
  const agentRailBase =
    drilledAgent && encodedEntityId
      ? `/c/${encodedEntityId}/agents/${encodeURIComponent(drilledAgent.id)}`
      : "";

  return (
    <>
      <div className="shell">
        <LeftSidebar entityId={entityId} path={path} />

        <div className="content-column">
          <div className="content-card">
            <div className="content-paper">
              <div className="content-body-row">
                {showAgentRail && (
                  <PageRail
                    tabs={AGENT_RAIL_TABS}
                    defaultTab="sessions"
                    title={drilledAgent?.name || "Agent"}
                    basePath={agentRailBase}
                    currentValue={agentRailCurrent}
                  />
                )}
                {showSessionsRail && (
                  <aside className="sessions-rail-col">
                    <SessionsRail />
                  </aside>
                )}
                <div className="content-main-col">
                  <div className="content-scroll">
                    <Suspense fallback={null}>{mainContent}</Suspense>
                  </div>
                  {showComposer && (
                    <ComposerRow
                      agentId={activeAgentId || null}
                      base={base}
                      sessionsMounted={sessionsMounted}
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
