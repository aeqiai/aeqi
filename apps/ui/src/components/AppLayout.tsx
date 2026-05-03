import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useParams } from "react-router-dom";
import CommandPalette from "./CommandPalette";
import AgentPage, { AGENT_RAIL_TABS } from "./AgentPage";
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
const AdminPage = lazy(() => import("@/pages/AdminPage"));
const CompanySetupPage = lazy(() => import("@/pages/CompanySetupPage"));
const EconomyPage = lazy(() => import("@/pages/EconomyPage"));
const BlueprintsPage = lazy(() => import("@/pages/BlueprintsPage"));
const BlueprintDetailPage = lazy(() => import("@/pages/BlueprintDetailPage"));
const CompanyPage = lazy(() => import("@/pages/CompanyPage"));
const PortfolioPage = lazy(() => import("@/pages/PortfolioPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));
const RoleNewPage = lazy(() => import("@/pages/RoleNewPage"));
const RoleDetailPage = lazy(() => import("@/pages/RoleDetailPage"));
const RoleEditPage = lazy(() => import("@/pages/RoleEditPage"));
const RoleInvitePage = lazy(() => import("@/pages/RoleInvitePage"));

// Top-level segments under /blueprints that are catalog-kind tabs, not
// blueprint slugs. Anything else after /blueprints/ is treated as a slug
// and dispatches BlueprintDetailPage.
const BLUEPRINT_KINDS = new Set(["companies", "agents", "events", "quests", "ideas"]);

// Tabs that route through CompanyPage. Each is now a top-level sidebar
// row in the Phase-1 lock — CompanyPage is a thin per-tab dispatcher.
// Inbox is the company-scoped action queue; Overview is the cockpit;
// the rest map 1:1 to the sidebar's Organization + Settings groups.
// Workspace tabs (agents/events/quests/ideas) bypass CompanyPage and
// render directly through AgentPage on the entity's root agent.
const COMPANY_PAGE_TABS = new Set([
  "overview",
  "inbox",
  "roles",
  "ownership",
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
      inbox: "Inbox",
      roles: "Roles",
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
    isSettings,
    isEconomy,
    isBlueprints,
    isDrive,
    isStart,
    isNotFound,
    isPortfolio,
    isAdmin,
    isRolesNew,
    isRoleDetail,
    isRoleEdit,
    isRoleInvite,
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
  // No-tab default at entity scope = "overview" (the company
  // dashboard is the canonical landing). `/` is served outside this
  // shell as the public Discover page, so it never reaches AppLayout.
  // Drilled agents default to "sessions" so the bare drilled URL opens
  // chat.
  const effectiveTab = tab || (routeEntityId && !drilledAgent ? "overview" : "sessions");

  // Runtime mode has no account-level identity surface.
  if (isSettings && appMode && appMode !== "platform") {
    return <Navigate to="/" replace />;
  }

  // Bare `/c/<entity>` doesn't render independently — `effectiveTab`
  // defaults to "overview" so CompanyPage handles the bare URL with
  // tab="overview". The "Company" sidebar row points at this bare URL
  // and lights up only when no sub-tab is active.

  // Defensive: route should be unreachable if `agents/<agent>` resolves
  // to nothing — bounce up to the company shell.
  if (routeAgentId && !drilledAgent && encodedEntityId) {
    return <Navigate to={`/c/${encodedEntityId}${search}`} replace />;
  }

  const mainContent = (() => {
    if (isNotFound) return <NotFoundPage />;
    if (isRolesNew) return <RoleNewPage />;
    if (isRoleInvite) return <RoleInvitePage />;
    if (isRoleEdit) return <RoleEditPage />;
    if (isRoleDetail) return <RoleDetailPage />;
    if (isStart) {
      // /start/<slug> → CompanySetupPage (the name + roles + plan
      // confirmation surface). Bare /start stays on the catalog
      // launch picker.
      if (path.startsWith("/start/")) return <CompanySetupPage />;
      return <StartPage />;
    }
    if (isPortfolio) return <PortfolioPage />;
    if (isAdmin) return <AdminPage />;
    if (isDrive) return <DrivePage />;
    if (isSettings) return <ProfilePage />;
    if (isEconomy) return <EconomyPage />;
    if (isBlueprints) {
      // /blueprints/<seg> where <seg> is a known kind (companies / agents /
      // events / quests / ideas) → catalog tab. Otherwise <seg> is a slug
      // → detail page. Bare /blueprints also lands on the catalog.
      const segments = path.split("/").filter(Boolean);
      // segments[0] === "blueprints"; segments[1] (if present) is either a
      // catalog kind or a blueprint slug.
      const second = segments[1];
      const isDetail = !!second && !BLUEPRINT_KINDS.has(second);
      return isDetail ? <BlueprintDetailPage /> : <BlueprintsPage />;
    }
    if (routeEntityId && !drilledAgent && COMPANY_PAGE_TABS.has(effectiveTab)) {
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
    !isPortfolio &&
    !isAdmin &&
    !isStart &&
    !isEconomy &&
    !isBlueprints &&
    effectiveTab === "sessions";
  const showComposer = sessionsMounted;
  const showSessionsRail = sessionsMounted && !!routeEntityId && !!drilledAgent;

  // Drilled-agent PageRail. Mounted at the body-row level so it sits
  // as a sibling of the SessionsRail and the chat content column —
  // the order reads `[ rail | sessions list | chat ]` matching the
  // user's mental model. The rail tabs are flat — Channels, Tools,
  // Integrations, and Settings are siblings, no nested sub-rail.
  const showAgentRail = !!drilledAgent;
  const agentRailCurrent = effectiveTab;
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
                    title="Agent"
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
