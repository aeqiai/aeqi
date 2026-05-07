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
import { useCurrentCompany } from "@/hooks/useCurrentCompany";

const DrivePage = lazy(() => import("@/pages/DrivePage"));
const MePage = lazy(() => import("@/pages/MePage"));
const StartPage = lazy(() => import("@/pages/StartPage"));
const AdminPage = lazy(() => import("@/pages/AdminPage"));
const CompanySetupPage = lazy(() => import("@/pages/CompanySetupPage"));
const EconomyPage = lazy(() => import("@/pages/EconomyPage"));
const BlueprintsPage = lazy(() => import("@/pages/BlueprintsPage"));
const BlueprintDetailPage = lazy(() => import("@/pages/BlueprintDetailPage"));
const StudioPage = lazy(() => import("@/pages/StudioPage"));
const CompanyPage = lazy(() => import("@/pages/CompanyPage"));
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
  "channels",
]);

export default function AppLayout() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searching, setSearching] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const {
    entityId: routeEntityId = "",
    trustAddress: routeTrustAddress = "",
    agentId: routeAgentId = "",
    tab,
    itemId,
  } = useParams<{
    entityId?: string;
    trustAddress?: string;
    agentId?: string;
    tab?: string;
    itemId?: string;
  }>();
  const path = location.pathname;

  const agents = useDaemonStore((s) => s.agents);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const activeEntity = useUIStore((s) => s.activeEntity);

  const surface = useShellSurface(path, tab);

  // Resolve entity from either /trust/:trustAddress or /c/:entityId.
  // useCurrentCompany handles both route shapes and returns a stable id.
  const { entityId: resolvedEntityId } = useCurrentCompany();
  // The effective route entity id — prefer the resolved id (covers trust
  // route) and fall back to the raw route token (covers /c/:entityId).
  const effectiveRouteEntityId = resolvedEntityId || routeEntityId;

  // The entity's root-agent record is the placeholder we synthesize from
  // `/api/entities` — its `entity_id` matches the route token. Every
  // company surface (`/c/<entity>/quests`, `/c/<entity>/events`, …)
  // resolves through this record.
  const rootAgent = useMemo(
    () =>
      effectiveRouteEntityId
        ? (agents.find((a) => a.entity_id === effectiveRouteEntityId) ?? null)
        : null,
    [agents, effectiveRouteEntityId],
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
  const entityId = effectiveRouteEntityId || activeEntityValid || firstRoot || "";

  // Only commit a verified-real entity — otherwise the pre-load render
  // can persist a bogus value into localStorage.
  useEffect(() => {
    if (entityId && entities.some((e) => e.id === entityId)) setActiveEntity(entityId);
  }, [entityId, entities, setActiveEntity]);

  useEffect(() => {
    const titles: Record<string, string> = {
      inbox: "Inbox",
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
      roles: "Roles",
      ownership: "Ownership",
      treasury: "Treasury",
      governance: "Governance",
    };
    const section = tab || "overview";
    const sectionTitle = titles[section] || section;
    const label = drilledAgent?.name ?? rootAgent?.name;
    document.title = label ? `${sectionTitle} — ${label} · æiq` : "æiq";
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
    isStudio,
    isDrive,
    isStart,
    isNotFound,
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
  // there. Applies to both /c/:entityId and /trust/:trustAddress shapes.
  //
  // BUT only bounce when we're sure the entity doesn't exist — i.e. the
  // user-scoped entity list is non-empty AND the target id isn't in it.
  // If `entities` is empty, the request hasn't resolved yet (or the
  // /api/agents call 502'd mid-flight before agents materialized) and
  // bouncing here drops the user onto the `/economy` shell rather than
  // showing a degraded company shell. Holds them on the URL while the
  // host service recovers; once `agents` repopulates, `rootAgent`
  // becomes non-null and the shell renders normally. If the entity is
  // genuinely missing from a non-empty entities list, the bounce still
  // fires — that's the canonical stale-ref case.
  if ((routeEntityId || routeTrustAddress) && !rootAgent) {
    const entityKnown = effectiveRouteEntityId
      ? entities.some((e) => e.id === effectiveRouteEntityId)
      : false;
    const entityListSettled = entities.length > 0;
    if (entityListSettled && !entityKnown) {
      localStorage.removeItem("aeqi_entity");
      return <Navigate to="/" replace />;
    }
    // Else: entities not yet loaded, or the entity exists but agents
    // haven't (host restart, transient 502). Render the shell with a
    // boot spinner — the periodic refresh will recover.
    return <BootLoader />;
  }

  // The agent surface mounts on either the entity-root agent (company
  // tabs: /c/<entity>/quests, /c/<entity>/events, …) or the drilled
  // agent (per-agent tab: /c/<entity>/agents/<agent>/…). The active id
  // is the agent record's id — what AgentPage and the sub-tabs expect.
  const activeAgent = drilledAgent ?? rootAgent;
  const activeAgentId = activeAgent?.id ?? "";

  // base: use /trust/ for on-chain entities, /c/ for pending ones.
  // This keeps internal navigation (ComposerRow, agentRailBase) on the
  // canonical URL shape once an entity is on-chain.
  const base = (() => {
    if (!encodedEntityId) return "/";
    if (routeTrustAddress) return `/trust/${routeTrustAddress}`;
    return `/c/${encodedEntityId}`;
  })();
  // No-tab default at entity scope = "overview" (the company
  // dashboard is the canonical landing). `/` is served outside this
  // shell as the public Discover page, so it never reaches AppLayout.
  // Drilled agents also default to "overview" — clicking on an agent
  // lands on its cockpit, not its chat. Inbox is one click off.
  const isEntityRoute = !!(routeEntityId || routeTrustAddress);
  const effectiveTab = tab || "overview";

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
    return <Navigate to={`${base}${search}`} replace />;
  }

  // Backward-compat: the drilled-agent inbox URL was previously
  // `/c/<entity>/agents/<agent>/sessions[/<sid>]`. The canonical
  // shape is now `/inbox` instead of `/sessions`. Replace-navigate
  // any stale links/bookmarks onto the new shape — the closest
  // thing to a 308 in a SPA. Mirrors the company-scope `/sessions`
  // case as well (no drilled agent, root-agent inbox).
  if (tab === "sessions" && encodedEntityId) {
    const suffix = itemId ? `/inbox/${encodeURIComponent(itemId)}` : "/inbox";
    const agentSeg = drilledAgent ? `/agents/${encodeURIComponent(drilledAgent.id)}` : "";
    return <Navigate to={`${base}${agentSeg}${suffix}${search}`} replace />;
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
    if (isAdmin) return <AdminPage />;
    if (isDrive) return <DrivePage />;
    if (isSettings) return <MePage />;
    if (isEconomy) return <EconomyPage />;
    if (isStudio) return <StudioPage />;
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
    if (isEntityRoute && !drilledAgent && COMPANY_PAGE_TABS.has(effectiveTab)) {
      return (
        <CompanyPage
          agentId={activeAgentId}
          entityId={effectiveRouteEntityId}
          tab={effectiveTab}
          itemId={itemId}
        />
      );
    }
    return <AgentPage agentId={activeAgentId} tab={effectiveTab} itemId={itemId} />;
  })();

  // The chat composer + sessions rail only belong on the chat surface
  // (drilled agent at /c/<entity>/agents/<id>/inbox[/<sid>]). Inbox,
  // company overview, list pages — none of these mount the composer.
  // The legacy flat `/sessions/<id>` URL redirects to the deep shape
  // outside this shell, so we don't special-case it.
  const sessionsMounted =
    !isNotFound &&
    !isDrive &&
    !isSettings &&
    !isAdmin &&
    !isStart &&
    !isEconomy &&
    !isBlueprints &&
    !isStudio &&
    effectiveTab === "inbox";
  const showComposer = sessionsMounted;
  const showSessionsRail = sessionsMounted && !!isEntityRoute && !!drilledAgent;

  // Drilled-agent PageRail. Mounted at the body-row level so it sits
  // as a sibling of the SessionsRail and the chat content column —
  // the order reads `[ rail | sessions list | chat ]` matching the
  // user's mental model. The rail tabs are flat — Channels, Tools,
  // Integrations, and Settings are siblings, no nested sub-rail.
  const showAgentRail = !!drilledAgent;
  const agentRailCurrent = effectiveTab;
  const agentRailBase =
    drilledAgent && encodedEntityId ? `${base}/agents/${encodeURIComponent(drilledAgent.id)}` : "";

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="shell">
        <LeftSidebar entityId={entityId} path={path} />

        <div className="content-column">
          <div className="content-card">
            <div className="content-paper">
              <div className="content-body-row">
                {showAgentRail && (
                  <PageRail
                    tabs={AGENT_RAIL_TABS}
                    defaultTab="overview"
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
                <main id="main-content" className="content-main-col">
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
                </main>
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
