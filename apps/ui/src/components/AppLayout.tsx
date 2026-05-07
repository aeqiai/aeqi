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
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
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
const AgentSettingsPage = lazy(() => import("@/pages/AgentSettingsPage"));

// Tab segments that used to live at `/c/<eid>/agents/<aid>/<tab>`
// and are now relocated under `/c/<eid>/agents/<aid>/settings/<tab>`.
// These trigger a SPA replace-navigate (the closest equivalent to a
// 308) so existing bookmarks survive the relocation.
const RELOCATED_AGENT_TABS = new Set([
  "overview",
  "quests",
  "events",
  "ideas",
  "channels",
  "treasury",
  "tools",
  "integrations",
]);

// Top-level segments under /blueprints that are catalog-kind tabs, not
// blueprint slugs. Anything else after /blueprints/ is treated as a slug
// and dispatches BlueprintDetailPage.
const BLUEPRINT_KINDS = new Set(["companies", "agents", "events", "quests", "ideas"]);

// Tabs that route through CompanyPage. Each is now a top-level sidebar
// row in the Phase-1 lock — CompanyPage is a thin per-tab dispatcher.
// Inbox is the company-scoped action queue; Overview is the cockpit;
// the rest map 1:1 to the sidebar's Organization + Settings groups.
//
// The four primitive tabs (agents/events/quests/ideas) ALSO route through
// CompanyPage at the entity scope. Without this, `/c/<eid>/agents` falls
// through to AgentPage(rootAgent) — which ignores its `tab` prop and
// renders the root agent's chat surface instead of the entity-scope LIST.
// Dispatch hole fix: 2026-05-09. The drilled-agent route
// `/c/<eid>/agents/<aid>/...` is unaffected — that path has a non-null
// `routeAgentId` and bypasses CompanyPage entirely upstream.
const COMPANY_PAGE_TABS = new Set([
  "overview",
  "inbox",
  "roles",
  "ownership",
  "treasury",
  "governance",
  "agents",
  "events",
  "quests",
  "ideas",
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
    settingsTab,
  } = useParams<{
    entityId?: string;
    trustAddress?: string;
    agentId?: string;
    tab?: string;
    itemId?: string;
    settingsTab?: string;
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
    isAccount,
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
  //
  // Drilled-agent default is the inbox/chat shape (no rail) — bare
  // `/c/<eid>/agents/<aid>/` opens the agent into the chat surface.
  // The settings sub-surface lives at `/c/<eid>/agents/<aid>/settings`
  // with the rail; clicking ⚙ on the agent header navigates there.
  const isEntityRoute = !!(routeEntityId || routeTrustAddress);
  // Are we on the agent's settings sub-surface? The route shape is
  // `agents/:agentId/settings[/:settingsTab[/:itemId]]`. We detect via
  // the path segment so the sub-surface dispatches before any
  // legacy-tab redirect runs.
  const agentSettingsSegment = (() => {
    if (!routeAgentId) return false;
    // Path slice after `/agents/<id>` — first segment is `settings`?
    const re = /\/agents\/[^/]+\/(settings)(?:\/|$)/;
    return re.test(path);
  })();
  const effectiveTab = tab || "overview";

  // Runtime mode has no account-level identity surface.
  if (isAccount && appMode && appMode !== "platform") {
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

  // Personality was dropped from the agent settings rail 2026-05-08 —
  // Ideas (HOW per the four W-primitives) is the canonical surface for
  // an agent's identity/instructions/memories. Replace-navigate any
  // stale `/personality` URL onto `/settings/ideas` — the closest
  // thing to a 308 in a SPA. Catches both the old flat shape
  // (`/c/<eid>/agents/<aid>/personality`) and the relocated shape
  // (`/c/<eid>/agents/<aid>/settings/personality`).
  if (
    drilledAgent &&
    (tab === "personality" || (agentSettingsSegment && settingsTab === "personality"))
  ) {
    const agentSeg = `/agents/${encodeURIComponent(drilledAgent.id)}`;
    return <Navigate to={`${base}${agentSeg}/settings/ideas${search}`} replace />;
  }

  // Backward-compat: the drilled-agent rail tabs (Overview, Quests,
  // Events, Ideas, Channels, Treasury, Tools, Integrations) used to
  // live at `/c/<entity>/agents/<agent>/<tab>`. They moved under the
  // settings sub-surface 2026-05-08 (the agent default surface is now
  // chat with no rail; settings owns the rail). Replace-navigate stale
  // bookmarks to the new shape — the closest thing to a 308 in a SPA.
  if (drilledAgent && tab && RELOCATED_AGENT_TABS.has(tab) && !agentSettingsSegment) {
    const agentSeg = `/agents/${encodeURIComponent(drilledAgent.id)}`;
    const sub = `/settings/${tab}`;
    const trailing = itemId ? `/${encodeURIComponent(itemId)}` : "";
    return <Navigate to={`${base}${agentSeg}${sub}${trailing}${search}`} replace />;
  }

  // Channels are an agent-rail primitive only — see
  // `apps/ui/CLAUDE.md` "Channels are an agent-rail primitive only".
  // The company-scope `/c/<id>/channels` and trust-scope
  // `/trust/<addr>/channels` URLs were briefly shipped 2026-05-07
  // and reverted same day. Redirect any stale link/bookmark to the
  // entity overview. The drilled-agent path
  // `/c/<id>/agents/<aid>/channels` is the canonical surface and is
  // unaffected (gated by `!drilledAgent` here).
  if (tab === "channels" && isEntityRoute && !drilledAgent) {
    return <Navigate to={`${base}${search}`} replace />;
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
    if (isAccount) return <ProfilePage />;
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
    // Drilled-agent settings sub-surface — dedicated page that owns
    // the PageRail. Bare `/c/<id>/agents/<aid>/settings` defaults to
    // the Overview sub-tab.
    if (drilledAgent && agentSettingsSegment) {
      return <AgentSettingsPage agentId={activeAgentId} />;
    }
    // Default drilled-agent surface: header + chat. AgentPage renders
    // the AgentSurfaceHeader at the top of the right pane and the
    // AgentSessionView below; AppLayout mounts the SessionsRail and
    // ComposerRow as siblings of the chat content column.
    return <AgentPage agentId={activeAgentId} tab={effectiveTab} itemId={itemId} />;
  })();

  // The chat composer + sessions rail belong on the drilled-agent
  // default surface (`/c/<entity>/agents/<id>/[inbox/<sid>]`). The
  // entity-scope inbox (`/trust/<addr>/inbox`) embeds
  // `<SessionDetail>` (which mounts its own composer against the
  // inbox-store POST path) — it must not also mount the AppLayout
  // chat composer or it stacks visually over the inbox detail. Same
  // applies to other top-level non-chat routes and to the agent's
  // settings sub-surface (rail without chat).
  const isAgentChatDefault =
    !!drilledAgent && !agentSettingsSegment && (tab === undefined || tab === "inbox");
  const sessionsMounted =
    !isNotFound &&
    !isDrive &&
    !isAccount &&
    !isAdmin &&
    !isStart &&
    !isEconomy &&
    !isBlueprints &&
    !isStudio &&
    isAgentChatDefault;
  const showComposer = sessionsMounted;
  const showSessionsRail = sessionsMounted && !!isEntityRoute;

  // Drilled-agent PageRail — only mounted on the settings sub-surface.
  // The default agent surface (chat) shows no rail; its breadcrumbs
  // live in the AgentSurfaceHeader at the top of the right pane.
  const showAgentRail = !!drilledAgent && agentSettingsSegment;
  const agentRailCurrent = settingsTab || "overview";
  const agentRailBase =
    drilledAgent && encodedEntityId
      ? `${base}/agents/${encodeURIComponent(drilledAgent.id)}/settings`
      : "";

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
