import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useParams } from "react-router-dom";
import LeftSidebar from "./shell/LeftSidebar";
import BootLoader from "./shell/BootLoader";
import { useDaemonStore } from "@/store/daemon";
import { activityKeys, agentKeys, entityKeys, questKeys, runtimeKeys } from "@/queries/keys";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useChatStore } from "@/store/chat";
import { useDaemonSocket } from "@/hooks/useDaemonSocket";
import { useShellSurface } from "@/hooks/useShellSurface";
import { useGlobalShortcuts } from "@/hooks/useGlobalShortcuts";
import { isRateLimited } from "@/lib/rateLimit";
import RateLimitBanner from "./shell/RateLimitBanner";
import { useCurrentCompany } from "@/hooks/useCurrentCompany";
import type { Agent, Company } from "@/lib/types";
import { entityPathFromId } from "@/lib/entityPath";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { userSessionsPath, withUserSessionsView } from "@/lib/sessionViews";
import { sessionLabel } from "@/components/session/types";

const CommandPalette = lazy(() => import("./CommandPalette"));
const AgentPage = lazy(() => import("./AgentPage"));
const ComposerRow = lazy(() => import("./shell/ComposerRow"));
const ShortcutsOverlay = lazy(() => import("./ShortcutsOverlay"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const AdminPage = lazy(() => import("@/pages/AdminPage"));
const CompanySetupPage = lazy(() => import("@/pages/CompanySetupPage"));
const BlueprintsPage = lazy(() => import("@/pages/BlueprintsPage"));
const EconomyPage = lazy(() => import("@/pages/EconomyPage"));
const ReferralsPage = lazy(() => import("@/pages/ReferralsPage"));
const CompanyPage = lazy(() => import("@/pages/CompanyPage"));
const StartPage = lazy(() => import("@/pages/StartPage"));
const BlueprintDetailPage = lazy(() => import("@/pages/BlueprintDetailPage"));
const CompanyTabPage = lazy(() => import("@/pages/CompanyTabPage"));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));
const RoleInvitePage = lazy(() => import("@/pages/RoleInvitePage"));
const AgentHealthPage = lazy(() => import("@/pages/AgentHealthPage"));
const AgentSettingsPage = lazy(() => import("@/pages/AgentSettingsPage"));

const NO_AGENT_SESSIONS: ReturnType<typeof useChatStore.getState>["sessionsByAgent"][string] = [];

// Legacy drilled-agent segments. MVP agent detail exposes a simple card;
// stale primitive sub-tabs collapse to that card rather than duplicating
// full primitive pages under an agent.
const RELOCATED_AGENT_TABS = new Set(["overview", "quests", "events", "ideas", "integrations"]);

// Top-level segments under /templates that are catalog-kind tabs, not
// template ids. Anything else after /templates/ is treated as a template
// id and dispatches BlueprintDetailPage.
const BLUEPRINT_KINDS = new Set(["companies", "agents", "events", "quests", "ideas"]);

// Tabs that route through CompanyTabPage. CompanyTabPage is a thin per-tab
// dispatcher for entity-scoped surfaces. The sidebar presents primitive
// registries grouped as Operations, Ownership, and Infrastructure; concrete
// apps like Mails/Websites/Campaigns stay deep-linked but roll up under Apps.
// Views is the composable company landing at the bare entity URL.
//
// The runtime primitive tabs (agents/events/quests/ideas) ALSO route through
// CompanyTabPage at the entity scope. Without this, `/company/<addr>/agents`
// falls through to AgentPage(defaultAgent) — which ignores its `tab` prop
// and renders the default agent's chat surface instead of the entity-scope
// LIST. Dispatch hole fix: 2026-05-09. The drilled-agent route
// `/company/<addr>/agents/<aid>/...` is unaffected — that path has a
// non-null `routeAgentId` and bypasses CompanyTabPage entirely upstream.
const COMPANY_PAGE_TABS = new Set([
  "overview",
  "views",
  "roles",
  "members",
  "controls",
  "filings",
  "agents",
  "sessions",
  "projects",
  "goals",
  // Legacy alias: Inbox is now the pinned user-filtered Sessions view.
  "inbox",
  "mails",
  // Legacy alias: Mail is canonicalized to plural Mails.
  "mail",
  "websites",
  "campaigns",
  "shares",
  // Legacy alias: Equity is canonicalized to Shares.
  "equity",
  "rounds",
  "budgets",
  "assets",
  "transactions",
  "gateways",
  // Legacy alias: Channels was renamed to Gateways. CompanyTabPage redirects
  // `/company/<addr>/channels` to `/company/<addr>/gateways`.
  "channels",
  "integrations",
  // Apps is now the operating-surface registry (Mails, Websites, Campaigns).
  "apps",
  "tools",
  "runtime",
  "usage",
  "billing",
  "events",
  "logs",
  "quests",
  "ideas",
  "skills",
  "health",
  // Legacy alias: singular Website moved to the first-class Websites
  // primitive. CompanyTabPage redirects `/company/<addr>/website` to
  // `/company/<addr>/websites`.
  "website",
  // Company-level Settings surface: irreversible administrative actions
  // (ownership transfer; future archival / principal rotation). Reachable
  // from the Ownership group footer link on CompanyOverviewTab.
  "settings",
]);

export function resolveDefaultAgent(
  agents: Agent[],
  entity: Pick<Company, "agent_id"> | null,
  effectiveRouteEntityId: string,
): Agent | null {
  if (entity?.agent_id) {
    const agent = agents.find((a) => a.id === entity.agent_id);
    if (agent) return agent;
  }

  return effectiveRouteEntityId
    ? (agents.find((a) => a.company_id === effectiveRouteEntityId) ?? null)
    : null;
}

export default function AppLayout() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const [searching, setSearching] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const {
    companyId: routeEntityId = "",
    companyAddress: routeCompanyAddress = "",
    agentId: routeAgentId = "",
    roleId = "",
    tab,
    itemId,
    settingsTab,
  } = useParams<{
    companyId?: string;
    companyAddress?: string;
    agentId?: string;
    roleId?: string;
    tab?: string;
    itemId?: string;
    settingsTab?: string;
  }>();
  const path = location.pathname;

  const agents = useDaemonStore((s) => s.agents);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const activeEntity = useUIStore((s) => s.activeEntity);

  const surface = useShellSurface(path);

  // Resolve entity from the canonical company route and return a stable id.
  const { entity, companyId: resolvedEntityId } = useCurrentCompany();
  // The effective route entity id — prefer the resolved id from the company
  // route and fall back to any raw route token only if one was somehow present.
  const effectiveRouteEntityId = resolvedEntityId || routeEntityId;

  // Prefer the platform placement's default-agent id from `/api/entities`.
  // Some hosted runtimes carry a runtime-local `agent.company_id`, so the
  // older `agent.company_id === companyId` match is only a fallback.
  const defaultAgent = useMemo(
    () => resolveDefaultAgent(agents, entity, effectiveRouteEntityId),
    [agents, entity, effectiveRouteEntityId],
  );

  // When `/company/<addr>/agents/<agent>/...` is open, the inner agentId
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
  const companyId = effectiveRouteEntityId || activeEntityValid || firstRoot || "";

  // Only commit a verified-real entity — otherwise the pre-load render
  // can persist a bogus value into localStorage.
  useEffect(() => {
    if (companyId && entities.some((e) => e.id === companyId)) setActiveEntity(companyId);
  }, [companyId, entities, setActiveEntity]);

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
  }, [fetchAll, companyId, invalidateShellQueries]);
  useDaemonSocket();

  const openSearch = useCallback(() => setSearching(true), []);
  const closeSearch = useCallback(() => setSearching(false), []);
  useGlobalShortcuts({
    companyId,
    searching,
    shortcutsOpen,
    openSearch,
    closeSearch,
    setShortcutsOpen,
  });

  const initialLoaded = useDaemonStore((s) => s.initialLoaded);
  const agentsLoaded = useDaemonStore((s) => s.agentsLoaded);
  const appMode = useAuthStore((s) => s.appMode);
  // The agent surface mounts on either the entity's default agent (company
  // tabs: /company/<addr>/quests, /company/<addr>/events, …) or the drilled
  // agent (per-agent tab: /company/<addr>/agents/<agent>/…). The active id
  // is the agent record's id — what AgentPage and the sub-tabs expect.
  const activeAgent = drilledAgent ?? defaultAgent;
  const activeAgentId = activeAgent?.id ?? "";
  const activeAgentSessions = useChatStore((s) =>
    activeAgentId ? (s.sessionsByAgent[activeAgentId] ?? NO_AGENT_SESSIONS) : NO_AGENT_SESSIONS,
  );

  const {
    isHome,
    isAccount,
    isBlueprints,
    isLaunch,
    isEconomy,
    isReferrals,
    isInbox,
    isStart,
    isCompaniesPicker,
    isNotFound,
    isAdmin,
    isRolesNew,
    isRolesDetail,
    isRolesEdit,
    isRolesInvite,
  } = surface;

  if (!initialLoaded) return <BootLoader />;

  const encodedEntityId = companyId ? encodeURIComponent(companyId) : "";
  const search = location.search || "";

  if (entities.length === 0 && (isHome || isStart)) {
    return <Navigate to="/launch?blueprint=personal-os" replace />;
  }

  // Drilled-agent pages depend on the agent directory itself, not just the
  // company root. Hold the shell on the loader until that directory has
  // settled so a refresh does not bounce the user back to the company cockpit
  // before the agent rows finish hydrating.
  if (routeAgentId && !agentsLoaded) {
    return <BootLoader />;
  }

  // Stale entity ref after a data reset would point at a non-existent
  // entity. Bounce home; the user picks (or creates) a fresh entity from
  // there. Applies to the company route.
  //
  // Welcome users land on `/company/<addr>/` immediately after auth, BEFORE
  // any aeqi-host runtime is provisioned for their company — `/api/agents`
  // returns []. Don't gate the shell on `defaultAgent`; render the entity
  // shell as soon as entities is settled and the entity is known. Surfaces
  // that need an agent (drilled-agent routes, sessions) handle their own
  // empty state.
  if (routeCompanyAddress) {
    const entityKnown = effectiveRouteEntityId
      ? entities.some((e) => e.id === effectiveRouteEntityId)
      : false;
    const entityListSettled = initialLoaded && entities.length > 0;
    if (entityListSettled && !entityKnown) {
      // Keep the company shell mounted instead of kicking the user back to
      // the home picker. A stale cache or slow company hydration should not
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

  // Base path for the current entity. Everything is company-scoped now.
  const base = (() => {
    if (routeCompanyAddress) return `/company/${routeCompanyAddress}`;
    return "";
  })();
  const roleCreateTarget = (() => {
    const params = new URLSearchParams(search);
    params.set("new", "1");
    const qs = params.toString();
    return `${base}/roles${qs ? `?${qs}` : ""}`;
  })();
  const roleEditTarget = (() => {
    if (!roleId) return null;
    return `${base}/roles/${encodeURIComponent(roleId)}${search}`;
  })();
  // No-tab default at entity scope = "overview" internally. The product
  // label is Views, but the legacy tab id remains the compatibility path
  // behind the canonical bare company URL.
  const isEntityRoute = !!routeCompanyAddress;
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

  // Legacy top-level inbox route — the user-filtered queue is now the
  // blueprint-seeded "My sessions" pinned view under the active COMPANY.
  if (isInbox) {
    if (!companyId) {
      return <Navigate to="/company" replace />;
    }
    return (
      <Navigate
        to={withUserSessionsView(entityPathFromId(entities, companyId, "sessions"), search)}
        replace
      />
    );
  }

  // Bare `/company/<addr>` doesn't render independently — `effectiveTab`
  // defaults to the legacy "overview" id so CompanyTabPage handles the
  // canonical Views landing. The sidebar row points at this bare URL and
  // lights up only when no sub-tab is active.

  // Defensive: route should be unreachable if `agents/<agent>` resolves
  // to nothing — bounce up to the company shell.
  if (routeAgentId && agentsLoaded && !drilledAgent && encodedEntityId) {
    return <Navigate to={`${base}${search}`} replace />;
  }

  // Legacy drilled-agent session URLs rewrite to the company-level Sessions
  // primitive. The nested agent inbox page is retired.
  if (drilledAgent && tab === "sessions" && encodedEntityId) {
    const target = itemId
      ? `${base}/sessions/${encodeURIComponent(itemId)}${search}`
      : `${base}/sessions?agent=${encodeURIComponent(drilledAgent.id)}`;
    return <Navigate to={target} replace />;
  }
  if (drilledAgent && tab === "inbox" && encodedEntityId) {
    const target = itemId
      ? `${base}/sessions/${encodeURIComponent(itemId)}${search}`
      : `${base}/sessions?agent=${encodeURIComponent(drilledAgent.id)}`;
    return <Navigate to={target} replace />;
  }

  // Personality and the old drilled-agent primitive tabs no longer have a
  // scoped settings rail. Replace-navigate stale links onto Settings.
  if (
    drilledAgent &&
    (tab === "personality" || (agentSettingsSegment && settingsTab === "personality"))
  ) {
    const agentSeg = `/agents/${encodeURIComponent(drilledAgent.id)}`;
    return <Navigate to={`${base}${agentSeg}${search}`} replace />;
  }

  if (drilledAgent && agentSettingsSegment && settingsTab) {
    const agentSeg = `/agents/${encodeURIComponent(drilledAgent.id)}`;
    return <Navigate to={`${base}${agentSeg}/settings${search}`} replace />;
  }

  // Old drilled-agent primitive tabs collapse to Settings instead of
  // recreating the whole app under an agent.
  if (drilledAgent && tab && RELOCATED_AGENT_TABS.has(tab) && !agentSettingsSegment) {
    const agentSeg = `/agents/${encodeURIComponent(drilledAgent.id)}`;
    return <Navigate to={`${base}${agentSeg}${search}`} replace />;
  }

  if (drilledAgent && tab === "treasury" && !agentSettingsSegment) {
    return <NotFoundPage />;
  }

  // The bare `/company/<addr>` URL IS the canonical Views landing — there is
  // no separate `/overview` or `/views` segment. Replace-navigate stale or
  // guessed links onto the bare URL so the sidebar activates correctly.
  if ((tab === "overview" || tab === "views") && isEntityRoute && !drilledAgent) {
    return <Navigate to={`${base}${search}`} replace />;
  }

  // Roles has a canonical table/list surface at `/roles` and a canonical
  // object surface at `/roles/:roleId`. Creation stays query-mode because it
  // is a workspace modal; stale edit links collapse to the object surface.
  if (isRolesNew) {
    return <Navigate to={roleCreateTarget} replace />;
  }
  if (isRolesEdit && roleEditTarget) {
    return <Navigate to={roleEditTarget} replace />;
  }
  if (path === "/economy" || path.startsWith("/economy/")) {
    return <Navigate to={`${path.replace("/economy", "/markets")}${search}`} replace />;
  }
  if (path === "/blueprints" || path.startsWith("/blueprints/")) {
    return <Navigate to={`${path.replace("/blueprints", "/templates")}${search}`} replace />;
  }

  const mainContent = (() => {
    if (isNotFound) return <NotFoundPage />;
    if (isRolesInvite) return <RoleInvitePage />;
    if (isLaunch) {
      // When the URL omits a blueprint id, CompanySetupPage resolves the
      // default blueprint internally so the launch surface is a single wizard.
      return <CompanySetupPage />;
    }
    if (isAdmin) return <AdminPage />;
    if (isAccount) return <ProfilePage />;
    if (isEconomy) return <EconomyPage />;
    if (isReferrals) return <ReferralsPage />;
    // `/` is the Start surface (welcome + previews). The legacy `/start`
    // URL keeps working as an alias for any link already in circulation.
    if (isHome || isStart) return <StartPage />;
    // `/company` (bare, no address) is the canonical companies picker. The
    // 2026-05-19 back-compat aliases (`/network`, `/identity`,
    // `/acting-as`) were retired the same day — only `/company` is mounted.
    if (isCompaniesPicker) return <CompanyPage />;
    if (isBlueprints) {
      // /templates/<seg> where <seg> is a known kind (companies / agents /
      // events / quests / ideas) → catalog tab. Otherwise <seg> is a template
      // id → detail page. Bare /templates also lands on the catalog.
      const segments = path.split("/").filter(Boolean);
      // segments[0] === "templates"; segments[1] (if present) is either a
      // catalog kind or a template id.
      const second = segments[1];
      const isDetail = !!second && !BLUEPRINT_KINDS.has(second);
      return isDetail ? <BlueprintDetailPage /> : <BlueprintsPage />;
    }
    if (isRolesDetail && roleId) {
      return (
        <CompanyTabPage
          agentId={activeAgentId}
          companyId={effectiveRouteEntityId}
          tab="roles"
          itemId={roleId}
        />
      );
    }
    if (isEntityRoute && !drilledAgent && tab && !COMPANY_PAGE_TABS.has(tab)) {
      return <NotFoundPage />;
    }
    if (isEntityRoute && !drilledAgent && COMPANY_PAGE_TABS.has(effectiveTab)) {
      return (
        <CompanyTabPage
          agentId={activeAgentId}
          companyId={effectiveRouteEntityId}
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
    // Default drilled-agent surface: simple agent detail card. Sessions
    // live only on the company-level Sessions primitive.
    return <AgentPage agentId={activeAgentId} tab={effectiveTab} itemId={itemId} />;
  })();

  const showComposer = false;
  const ambientDockAllowed =
    !showComposer &&
    !isNotFound &&
    !isHome &&
    !isAccount &&
    !isAdmin &&
    !isLaunch &&
    !isBlueprints &&
    !isEconomy &&
    !isStart &&
    !isCompaniesPicker &&
    isEntityRoute &&
    !drilledAgent &&
    !!activeAgentId &&
    tab !== "sessions";
  const dockSession = activeAgentSessions
    .filter((s) => s.session_type !== "task")
    .slice()
    .sort((a, b) => {
      const aTs = Date.parse(a.last_active || a.created_at || "") || 0;
      const bTs = Date.parse(b.last_active || b.created_at || "") || 0;
      return bTs - aTs;
    })[0];
  const dockComposeHref = activeAgentId
    ? `${base}/sessions?agent=${encodeURIComponent(activeAgentId)}`
    : userSessionsPath(base);
  const dockSessionHref = dockSession
    ? sessionDeepUrlFromId(entities, companyId, activeAgentId, dockSession.id)
    : dockComposeHref;

  const contentBody = (
    <div className="content-body-row">
      <main id="main-content" className="content-main-col">
        <div className="content-scroll">
          <Suspense fallback={null}>{mainContent}</Suspense>
        </div>
        {showComposer && (
          <Suspense fallback={null}>
            <ComposerRow agentId={activeAgentId || null} base={base} sessionsMounted={false} />
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
        <LeftSidebar companyId={companyId} path={path} />

        <div className="content-column">
          <div className="content-card">
            <div className="content-paper">{contentBody}</div>
          </div>
          {ambientDockAllowed && (
            <Suspense fallback={null}>
              <ComposerRow
                agentId={activeAgentId || null}
                base={base}
                sessionsMounted={false}
                mode="dock"
                composeHref={dockComposeHref}
                sessionHref={dockSessionHref}
                sessionLinkLabel={dockSession ? sessionLabel(dockSession) : "Session"}
              />
            </Suspense>
          )}
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
