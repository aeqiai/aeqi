import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useParams } from "react-router-dom";
import LeftSidebar from "./shell/LeftSidebar";
import BootLoader from "./shell/BootLoader";
import { AgentInboxControlsProvider, AgentInboxToolbar } from "./shell/AgentInboxControls";
import { useDaemonStore } from "@/store/daemon";
import { activityKeys, agentKeys, entityKeys, questKeys, runtimeKeys } from "@/queries/keys";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useDaemonSocket } from "@/hooks/useDaemonSocket";
import { useShellSurface } from "@/hooks/useShellSurface";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { isRateLimited } from "@/lib/rateLimit";
import RateLimitBanner from "./shell/RateLimitBanner";
import { useCurrentTrust } from "@/hooks/useCurrentTrust";
import type { Agent, Trust } from "@/lib/types";
import { entityPathFromId } from "@/lib/entityPath";

const CommandPalette = lazy(() => import("./CommandPalette"));
const AgentPage = lazy(() => import("./AgentPage"));
const AgentSurfaceHeader = lazy(() => import("./AgentSurfaceHeader"));
const AgentSessionContextHeader = lazy(() => import("./shell/AgentSessionContextHeader"));
const SessionsRail = lazy(() => import("./shell/SessionsRail"));
const ComposerRow = lazy(() => import("./shell/ComposerRow"));
const ShortcutsOverlay = lazy(() => import("./ShortcutsOverlay"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const AdminPage = lazy(() => import("@/pages/AdminPage"));
const TrustSetupPage = lazy(() => import("@/pages/TrustSetupPage"));
const BlueprintsPage = lazy(() => import("@/pages/BlueprintsPage"));
const EconomyPage = lazy(() => import("@/pages/EconomyPage"));
const TrustPage = lazy(() => import("@/pages/TrustPage"));
const StartPage = lazy(() => import("@/pages/StartPage"));
const BlueprintDetailPage = lazy(() => import("@/pages/BlueprintDetailPage"));
const TrustTabPage = lazy(() => import("@/pages/TrustTabPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));
const RoleNewPage = lazy(() => import("@/pages/RoleNewPage"));
const RoleDetailPage = lazy(() => import("@/pages/RoleDetailPage"));
const RoleEditPage = lazy(() => import("@/pages/RoleEditPage"));
const RoleInvitePage = lazy(() => import("@/pages/RoleInvitePage"));
const AgentHealthPage = lazy(() => import("@/pages/AgentHealthPage"));
const AgentSettingsPage = lazy(() => import("@/pages/AgentSettingsPage"));

// Legacy drilled-agent segments. MVP agent detail exposes only Sessions
// and Settings; stale deep links collapse to Settings rather than
// duplicating full primitive pages under an agent.
const RELOCATED_AGENT_TABS = new Set(["overview", "quests", "events", "ideas", "integrations"]);

// Top-level segments under /blueprints that are catalog-kind tabs, not
// blueprint ids. Anything else after /blueprints/ is treated as a blueprint
// id and dispatches BlueprintDetailPage.
const BLUEPRINT_KINDS = new Set(["companies", "agents", "events", "quests", "ideas"]);

// Tabs that route through TrustTabPage. Each is now a top-level sidebar
// row in the Phase-1 lock — TrustTabPage is a thin per-tab dispatcher.
// Inbox is the company-scoped action queue; Overview is the cockpit;
// Roles, Members, Agents, Sessions, Inbox, Channels, Apps, Tools, Events,
// Quests, and Ideas sit together as one continuous trust surface.
//
// The runtime primitive tabs (agents/events/quests/ideas) ALSO route through
// TrustTabPage at the entity scope. Without this, `/trust/<addr>/agents`
// falls through to AgentPage(defaultAgent) — which ignores its `tab` prop
// and renders the default agent's chat surface instead of the entity-scope
// LIST. Dispatch hole fix: 2026-05-09. The drilled-agent route
// `/trust/<addr>/agents/<aid>/...` is unaffected — that path has a
// non-null `routeAgentId` and bypasses TrustTabPage entirely upstream.
const COMPANY_PAGE_TABS = new Set([
  "overview",
  "roles",
  "members",
  "agents",
  "sessions",
  "inbox",
  "channels",
  "apps",
  "tools",
  "events",
  "quests",
  "ideas",
  "health",
  // Legacy alias: Website moved into Apps. TrustTabPage redirects
  // `/trust/<addr>/website` to `/trust/<addr>/apps`.
  "website",
  // Trust-level Settings surface: irreversible administrative actions
  // (ownership transfer; future archival / principal rotation). Reachable
  // from the Ownership group footer link on TrustOverviewTab.
  "settings",
]);

export function resolveDefaultAgent(
  agents: Agent[],
  entity: Pick<Trust, "agent_id"> | null,
  effectiveRouteEntityId: string,
): Agent | null {
  if (entity?.agent_id) {
    const agent = agents.find((a) => a.id === entity.agent_id);
    if (agent) return agent;
  }

  return effectiveRouteEntityId
    ? (agents.find((a) => a.trust_id === effectiveRouteEntityId) ?? null)
    : null;
}

export default function AppLayout() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searching, setSearching] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const {
    trustId: routeEntityId = "",
    trustAddress: routeTrustAddress = "",
    agentId: routeAgentId = "",
    tab,
    itemId,
    settingsTab,
  } = useParams<{
    trustId?: string;
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

  const surface = useShellSurface(path);

  // Resolve entity from the canonical trust route and return a stable id.
  const { entity, trustId: resolvedEntityId } = useCurrentTrust();
  // The effective route entity id — prefer the resolved id from the trust
  // route and fall back to any raw route token only if one was somehow present.
  const effectiveRouteEntityId = resolvedEntityId || routeEntityId;

  // Prefer the platform placement's default-agent id from `/api/entities`.
  // Some hosted runtimes carry a runtime-local `agent.trust_id`, so the
  // older `agent.trust_id === trustId` match is only a fallback.
  const defaultAgent = useMemo(
    () => resolveDefaultAgent(agents, entity, effectiveRouteEntityId),
    [agents, entity, effectiveRouteEntityId],
  );

  // When `/trust/<addr>/agents/<agent>/...` is open, the inner agentId
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
  const trustId = effectiveRouteEntityId || activeEntityValid || firstRoot || "";

  // Only commit a verified-real entity — otherwise the pre-load render
  // can persist a bogus value into localStorage.
  useEffect(() => {
    if (trustId && entities.some((e) => e.id === trustId)) setActiveEntity(trustId);
  }, [trustId, entities, setActiveEntity]);

  useEffect(() => {
    document.title = "aeqi";
  }, []);

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
  }, [fetchAll, trustId, invalidateShellQueries]);
  useDaemonSocket();

  const openSearch = useCallback(() => setSearching(true), []);
  const closeSearch = useCallback(() => setSearching(false), []);
  useGlobalShortcuts({
    trustId,
    searching,
    shortcutsOpen,
    openSearch,
    closeSearch,
    setShortcutsOpen,
  });

  const initialLoaded = useDaemonStore((s) => s.initialLoaded);
  const agentsLoaded = useDaemonStore((s) => s.agentsLoaded);
  const appMode = useAuthStore((s) => s.appMode);

  const {
    isHome,
    isAccount,
    isBlueprints,
    isLaunch,
    isEconomy,
    isInbox,
    isStart,
    isTrustsPicker,
    isNotFound,
    isAdmin,
    isRolesNew,
    isRolesDetail,
    isRolesEdit,
    isRolesInvite,
  } = surface;

  if (!initialLoaded) return <BootLoader />;

  const encodedEntityId = trustId ? encodeURIComponent(trustId) : "";
  const search = location.search || "";

  if (entities.length === 0 && (isHome || isStart)) {
    return <Navigate to="/launch?blueprint=personal-os" replace />;
  }

  // Drilled-agent pages depend on the agent directory itself, not just the
  // trust root. Hold the shell on the loader until that directory has
  // settled so a refresh does not bounce the user back to the trust cockpit
  // before the agent rows finish hydrating.
  if (routeAgentId && !agentsLoaded) {
    return <BootLoader />;
  }

  // Stale entity ref after a data reset would point at a non-existent
  // entity. Bounce home; the user picks (or creates) a fresh entity from
  // there. Applies to the trust route.
  //
  // Welcome users land on `/trust/<addr>/` immediately after auth, BEFORE
  // any aeqi-host runtime is provisioned for their company — `/api/agents`
  // returns []. Don't gate the shell on `defaultAgent`; render the entity
  // shell as soon as entities is settled and the entity is known. Surfaces
  // that need an agent (drilled-agent routes, sessions) handle their own
  // empty state.
  if (routeTrustAddress) {
    const entityKnown = effectiveRouteEntityId
      ? entities.some((e) => e.id === effectiveRouteEntityId)
      : false;
    const entityListSettled = initialLoaded && entities.length > 0;
    if (entityListSettled && !entityKnown) {
      // Keep the trust shell mounted instead of kicking the user back to
      // the home picker. A stale cache or slow trust hydration should not
      // hide the actual detail route.
      return <BootLoader />;
    }
    if (!initialLoaded || entities.length === 0) {
      // Daemon store still hydrating, or the entities request 502'd
      // mid-flight. Periodic refresh will recover.
      return <BootLoader />;
    }
    // entity exists in the list — fall through and render the shell,
    // even when defaultAgent is null (no runtime provisioned yet).
  }

  // The agent surface mounts on either the entity's default agent (company
  // tabs: /trust/<addr>/quests, /trust/<addr>/events, …) or the drilled
  // agent (per-agent tab: /trust/<addr>/agents/<agent>/…). The active id
  // is the agent record's id — what AgentPage and the sub-tabs expect.
  const activeAgent = drilledAgent ?? defaultAgent;
  const activeAgentId = activeAgent?.id ?? "";

  // Base path for the current entity. Everything is trust-scoped now.
  const base = (() => {
    if (routeTrustAddress) return `/trust/${routeTrustAddress}`;
    return "";
  })();
  // No-tab default at entity scope = "overview" (the company
  // dashboard is the canonical landing). `/` is served outside this
  // shell as the public Discover page, so it never reaches AppLayout.
  //
  // Drilled-agent default is Settings. Conversations are first-class under
  // trust-wide Sessions, with drilled-agent `/inbox` kept as the direct chat
  // deep link for existing conversations.
  const isEntityRoute = !!routeTrustAddress;
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

  // Legacy top-level inbox route — the canonical inbox now lives under the
  // active TRUST, so keep `/inbox` as a compatibility alias only.
  if (isInbox) {
    if (!trustId) {
      return <Navigate to="/trust" replace />;
    }
    return <Navigate to={`${entityPathFromId(entities, trustId, "inbox")}${search}`} replace />;
  }

  // Bare `/trust/<addr>` doesn't render independently — `effectiveTab`
  // defaults to "overview" so TrustTabPage handles the bare URL with
  // tab="overview". The "Company" sidebar row points at this bare URL
  // and lights up only when no sub-tab is active.

  // Defensive: route should be unreachable if `agents/<agent>` resolves
  // to nothing — bounce up to the company shell.
  if (routeAgentId && agentsLoaded && !drilledAgent && encodedEntityId) {
    return <Navigate to={`${base}${search}`} replace />;
  }

  // Legacy drilled-agent sessions URL rewrites to the drilled agent inbox.
  // Trust-level `/trust/<addr>/sessions` is its own all-agent session index.
  if (drilledAgent && tab === "sessions" && encodedEntityId) {
    const suffix = itemId ? `/inbox/${encodeURIComponent(itemId)}` : "/inbox";
    const agentSeg = `/agents/${encodeURIComponent(drilledAgent.id)}`;
    return <Navigate to={`${base}${agentSeg}${suffix}${search}`} replace />;
  }

  if (drilledAgent && !tab && !agentSettingsSegment) {
    const agentSeg = `/agents/${encodeURIComponent(drilledAgent.id)}`;
    return <Navigate to={`${base}${agentSeg}/settings${search}`} replace />;
  }

  // Personality and the old drilled-agent primitive tabs no longer have a
  // scoped settings rail. Replace-navigate stale links onto Settings.
  if (
    drilledAgent &&
    (tab === "personality" || (agentSettingsSegment && settingsTab === "personality"))
  ) {
    const agentSeg = `/agents/${encodeURIComponent(drilledAgent.id)}`;
    return <Navigate to={`${base}${agentSeg}/settings${search}`} replace />;
  }

  if (drilledAgent && agentSettingsSegment && settingsTab) {
    const agentSeg = `/agents/${encodeURIComponent(drilledAgent.id)}`;
    return <Navigate to={`${base}${agentSeg}/settings${search}`} replace />;
  }

  // Old drilled-agent primitive tabs collapse to Settings instead of
  // recreating the whole app under an agent.
  if (drilledAgent && tab && RELOCATED_AGENT_TABS.has(tab) && !agentSettingsSegment) {
    const agentSeg = `/agents/${encodeURIComponent(drilledAgent.id)}`;
    return <Navigate to={`${base}${agentSeg}/settings${search}`} replace />;
  }

  if (drilledAgent && tab === "treasury" && !agentSettingsSegment) {
    return <NotFoundPage />;
  }

  // The bare `/trust/<addr>` URL IS the company cockpit — there is no
  // separate `/overview` segment. Replace-navigate any stale link/bookmark
  // onto the bare URL so the sidebar's "Company" row activates correctly.
  if (tab === "overview" && isEntityRoute && !drilledAgent) {
    return <Navigate to={`${base}${search}`} replace />;
  }

  const mainContent = (() => {
    if (isNotFound) return <NotFoundPage />;
    if (isRolesNew) return <RoleNewPage />;
    if (isRolesInvite) return <RoleInvitePage />;
    if (isRolesEdit) return <RoleEditPage />;
    if (isRolesDetail) return <RoleDetailPage />;
    if (isLaunch) {
      // When the URL omits a blueprint id, TrustSetupPage resolves the
      // default blueprint internally so the launch surface is a single wizard.
      return <TrustSetupPage />;
    }
    if (isAdmin) return <AdminPage />;
    if (isAccount) return <ProfilePage />;
    if (isEconomy) return <EconomyPage />;
    // `/` is the Start surface (welcome + previews). The legacy `/start`
    // URL keeps working as an alias for any link already in circulation.
    if (isHome || isStart) return <StartPage />;
    // `/trust` (bare, no address) is the canonical trusts picker. The
    // 2026-05-19 back-compat aliases (`/network`, `/identity`,
    // `/acting-as`) were retired the same day — only `/trust` is mounted.
    if (isTrustsPicker) return <TrustPage />;
    if (isBlueprints) {
      // /blueprints/<seg> where <seg> is a known kind (companies / agents /
      // events / quests / ideas) → catalog tab. Otherwise <seg> is a blueprint
      // id → detail page. Bare /blueprints also lands on the catalog.
      const segments = path.split("/").filter(Boolean);
      // segments[0] === "blueprints"; segments[1] (if present) is either a
      // catalog kind or a blueprint id.
      const second = segments[1];
      const isDetail = !!second && !BLUEPRINT_KINDS.has(second);
      return isDetail ? <BlueprintDetailPage /> : <BlueprintsPage />;
    }
    if (isEntityRoute && !drilledAgent && tab && !COMPANY_PAGE_TABS.has(tab)) {
      return <NotFoundPage />;
    }
    if (isEntityRoute && !drilledAgent && COMPANY_PAGE_TABS.has(effectiveTab)) {
      return (
        <TrustTabPage
          agentId={activeAgentId}
          trustId={effectiveRouteEntityId}
          tab={effectiveTab}
          itemId={itemId}
        />
      );
    }
    if (drilledAgent && tab === "health") {
      return <AgentHealthPage agentId={activeAgentId} />;
    }
    // Drilled-agent settings sub-surface — simple model + tools page.
    if (drilledAgent && agentSettingsSegment) {
      return <AgentSettingsPage agentId={activeAgentId} />;
    }
    // Default drilled-agent surface: AppLayout renders the shared inbox
    // topbar and mounts the SessionsRail / ComposerRow around the chat
    // content column. AgentPage owns only the selected conversation.
    return <AgentPage agentId={activeAgentId} tab={effectiveTab} itemId={itemId} />;
  })();

  // The chat composer + sessions rail belong on the drilled-agent
  // default surface (`/trust/<addr>/agents/<id>/[inbox/<sid>]`). The
  // trust-scoped inbox (`/trust/<addr>/inbox`) embeds
  // `<SessionDetail>` (which mounts its own composer against the
  // inbox-store POST path) — it must not also mount the AppLayout
  // chat composer or it stacks visually over the inbox detail. Same
  // applies to other top-level non-chat routes and to the agent's
  // settings sub-surface (rail without chat).
  const isAgentChatDefault =
    !!drilledAgent && !agentSettingsSegment && (tab === undefined || tab === "inbox");
  const sessionsMounted =
    !isNotFound &&
    !isHome &&
    !isAccount &&
    !isAdmin &&
    !isLaunch &&
    !isBlueprints &&
    !isEconomy &&
    !isStart &&
    !isTrustsPicker &&
    isAgentChatDefault;
  const showComposer = sessionsMounted;
  const showSessionsRail = sessionsMounted && !!isEntityRoute;

  const contentBody = (
    <div className="content-body-row">
      {showSessionsRail && (
        <aside className="sessions-rail-col">
          <Suspense fallback={null}>
            <SessionsRail />
          </Suspense>
        </aside>
      )}
      <main id="main-content" className="content-main-col">
        <div className="content-scroll">
          <Suspense fallback={null}>{mainContent}</Suspense>
        </div>
        {showComposer && (
          <Suspense fallback={null}>
            <ComposerRow
              agentId={activeAgentId || null}
              base={base}
              sessionsMounted={sessionsMounted}
            />
          </Suspense>
        )}
      </main>
    </div>
  );

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="shell">
        <LeftSidebar trustId={trustId} path={path} />

        <div className="content-column">
          <div className="content-card">
            <div className="content-paper">
              {showSessionsRail ? (
                <AgentInboxControlsProvider>
                  <div className="agent-inbox-shell">
                    <Suspense fallback={null}>
                      <AgentSurfaceHeader agentId={activeAgentId} middle={<AgentInboxToolbar />} />
                    </Suspense>
                    <Suspense fallback={null}>
                      <AgentSessionContextHeader />
                    </Suspense>
                    {contentBody}
                  </div>
                </AgentInboxControlsProvider>
              ) : (
                contentBody
              )}
            </div>
          </div>
          <RateLimitBanner />
        </div>
      </div>
      {searching && (
        <Suspense fallback={null}>
          <CommandPalette open onClose={closeSearch} />
        </Suspense>
      )}
      {shortcutsOpen && (
        <Suspense fallback={null}>
          <ShortcutsOverlay open onClose={() => setShortcutsOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
