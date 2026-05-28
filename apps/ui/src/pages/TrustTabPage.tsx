import { Suspense, lazy, useEffect } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import AgentPage from "@/components/AgentPage";
import { useCurrentTrust } from "@/hooks/useCurrentTrust";
import { useRuntimeStatus } from "@/hooks/useRuntimeStatus";
import ProvisionRuntimeUpsell, {
  type UpsellSurface,
} from "@/components/upsell/ProvisionRuntimeUpsell";

// TrustOverviewTab is the canonical bare-`/trust/<addr>/` landing — renders
// TrustHeroStrip + roles / quests / activity. Lazy-loaded to keep this
// dispatch shell light. Mirrors the lazy pattern used in AgentPage.
const TrustOverviewTab = lazy(() => import("@/components/TrustOverviewTab"));
const MeInboxPage = lazy(() => import("@/pages/MeInboxPage"));
// Trust-scope primitive tabs. `TrustAgentsTab` is entity-typed (takes
// trustId, filters the directory). Events render through an agent lens rail
// so the same page can inspect each agent's loop handlers. Quests and Ideas
// ask their shared components for entity-wide data so sibling-agent work
// remains visible on `/trust/<addr>/...`.
const TrustAgentsTab = lazy(() => import("@/components/TrustAgentsTab"));
const TrustAppsTab = lazy(() => import("@/components/TrustAppsTab"));
const AgentChannelsTab = lazy(() => import("@/components/AgentChannelsTab"));
const TrustToolsTab = lazy(() => import("@/components/TrustToolsTab"));
const TrustRolesTab = lazy(() => import("@/components/TrustRolesTab"));
const AssetsPage = lazy(() => import("@/pages/AssetsPage"));
const EquityPage = lazy(() => import("@/pages/EquityPage"));
const QuorumPage = lazy(() => import("@/pages/QuorumPage"));
const IncorporationPage = lazy(() => import("@/pages/IncorporationPage"));
const AgentEventsTab = lazy(() => import("@/components/AgentEventsTab"));
const AgentQuestsTab = lazy(() => import("@/components/AgentQuestsTab"));
const AgentIdeasTab = lazy(() => import("@/components/AgentIdeasTab"));
const TrustSettingsTab = lazy(() => import("@/components/TrustSettingsTab"));

interface TrustTabPageProps {
  agentId: string;
  trustId: string;
  /** Resolved tab — defaulted to "overview" upstream. The bare
   *  `/trust/<addr>` URL renders Overview through this tab default. */
  tab: string;
  itemId?: string;
}

/**
 * Phase-1 sidebar lock: each former Company sub-tab is now a top-level
 * sidebar row. The internal `PageRail` is removed; TrustTabPage just
 * dispatches the right component per tab.
 *
 * Routes:
 *   /trust/:trustAddress               → TrustOverviewTab (cockpit — Health folded in)
 *   /trust/:trustAddress/inbox         → MeInboxPage
 *   /trust/:trustAddress/health        → 308 redirect to bare cockpit (legacy URL)
 *   /trust/:trustAddress/website       → redirect to Apps (legacy website tab)
 *   /trust/:trustAddress/roles         → TrustRolesTab (org chart)
 *   /trust/:trustAddress/agents        → TrustAgentsTab (LIST)
 *   /trust/:trustAddress/apps          → TrustAppsTab (channel-backed apps)
 *   /trust/:trustAddress/events        → AgentEventsTab(agent lens rail)
 *   /trust/:trustAddress/quests        → AgentQuestsTab(entity scope)
 *   /trust/:trustAddress/ideas         → AgentIdeasTab(entity scope)
 *
 * The former `/trust/:trustAddress/settings` tab was retired — workspace label,
 * tagline, public toggle, and plan link now live in the TrustHeroStrip
 * on Overview. Workspace billing remains at `/account/billing`.
 */
/** Tabs that require a per-tenant runtime service.
 *  When `has_runtime === false`, render `<ProvisionRuntimeUpsell>` in
 *  their slot instead of the real tab body. The 6 ownership/governance
 *  tabs (Overview / Roles / Assets / Equity / Quorum / Incorporation)
 *  read on-chain state and stay reachable on free TRUSTs. */
const RUNTIME_GATED_TABS: Record<string, UpsellSurface> = {
  agents: "agents",
  apps: "apps",
  channels: "apps",
  tools: "apps",
  events: "events",
  quests: "quests",
  ideas: "ideas",
  inbox: "inbox",
  // `sessions` is rewritten upstream in AppLayout (308 to the drilled-
  // agent inbox URL), so it never lands on TrustTabPage. Listed here for
  // discoverability — gating its drilled-agent rewrite target is a
  // separate concern handled in the drilled-agent surface.
};

export default function TrustTabPage({ agentId, trustId, tab, itemId }: TrustTabPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { entity } = useCurrentTrust();
  // Runtime status drives whether the 5 execution tabs render or get
  // upsold. React Query dedupes parallel calls, so the per-tab gate
  // shares a single fetch with TrustOverviewTab.
  const { hasRuntime, isLoading: runtimeStatusLoading } = useRuntimeStatus(trustId);

  // Title effect
  useEffect(() => {
    document.title = "aeqi";
  }, []);

  // Trust-address redirect: when entity gains a trust_address, redirect to
  // the canonical /trust/<address>/tab URL (once registerTRUST lands).
  // Idempotent: skips if already on /trust/ route.
  useEffect(() => {
    // Skip if we're already on the /trust/ canonical URL or if entity has no trust_address
    if (!entity?.trust_address || location.pathname.startsWith("/trust/")) {
      return;
    }

    // Construct the target path: /trust/<address>/<tab>[/itemId]
    const trustAddr = entity.trust_address;
    let targetPath = `/trust/${encodeURIComponent(trustAddr)}/${tab}`;
    if (itemId) {
      targetPath += `/${encodeURIComponent(itemId)}`;
    }
    // Preserve the query string (`?view=kanban`, `?view=table`, etc.) —
    // a deep link like `/trust/<addr>/ideas?view=kanban` would otherwise drop
    // the `view` param on redirect and land on the default list view.
    if (location.search) {
      targetPath += location.search;
    }

    // Replace the history entry so the user doesn't pollute their back-button
    navigate(targetPath, { replace: true });
  }, [entity?.trust_address, tab, itemId, navigate, location.pathname, location.search]);

  // Runtime gate — applied before the per-tab dispatch so all gated
  // surfaces share one branch. While the status query is in-flight we
  // fall through to the normal per-tab render (best-effort optimism);
  // the gate flips to the upsell on the next render once the placement
  // confirms `has_runtime: false`.
  const upsellSurface = RUNTIME_GATED_TABS[tab];
  if (upsellSurface && !runtimeStatusLoading && !hasRuntime) {
    return <ProvisionRuntimeUpsell surface={upsellSurface} trustId={trustId} />;
  }

  // Inbox is the company-scoped action queue. Visually it's MeInbox
  // for now; the legacy top-level /inbox path is only a redirect alias.
  if (tab === "inbox") {
    return (
      <Suspense>
        <MeInboxPage />
      </Suspense>
    );
  }
  // /health was retired 2026-05-17 — folded into TrustOverviewTab on
  // the bare TRUST URL. Redirect existing deep links to the cockpit so
  // they land on the same content without breaking bookmarks.
  if (tab === "health") {
    const target = location.pathname.replace(/\/health\/?$/, "/") + location.search;
    return <Navigate to={target} replace />;
  }

  // Bare `/trust/<addr>/` Overview renders TrustOverviewTab directly — the
  // canonical entity cockpit (TrustHeroStrip + roles / quests / activity).
  // Routing through AgentPage's `isDrilledAgent` branch was wrong for
  // root agents whose `trust_id` is populated and differs from
  // `agent.id` (the post-2026-04-29 schema): the branch flagged the
  // root agent as "drilled" and rendered AgentOverviewTab instead, so
  // TrustHeroStrip never mounted. TrustTabPage already knows it's the
  // bare entity URL (drilled URLs bypass TrustTabPage entirely in
  // AppLayout) — render the entity surface explicitly.
  if (tab === "overview") {
    return (
      <Suspense>
        <TrustOverviewTab trustId={trustId} />
      </Suspense>
    );
  }

  // Trust-scope primitive tabs. Without these explicit branches the
  // fallthrough to AgentPage rendered the root agent's chat surface
  // (AgentPage's `tab` prop has been a no-op since 2026-05-08), which
  // is why `/trust/<addr>/agents` and siblings landed on a header with no
  // body. Dispatch hole fix 2026-05-09.
  if (tab === "agents") {
    return (
      <Suspense>
        <TrustAgentsTab trustId={trustId} />
      </Suspense>
    );
  }
  if (tab === "apps") {
    return (
      <Suspense>
        <TrustAppsTab trustId={trustId} />
      </Suspense>
    );
  }
  if (tab === "channels") {
    return (
      <Suspense>
        <AgentChannelsTab agentId={agentId} />
      </Suspense>
    );
  }
  if (tab === "tools") {
    return (
      <Suspense>
        <TrustToolsTab agentId={agentId} />
      </Suspense>
    );
  }
  if (tab === "website") {
    const target = location.pathname.replace(/\/website\/?$/, "/apps") + location.search;
    return <Navigate to={target} replace />;
  }
  // Roles — the org-chart / authority-graph surface. Hoisted from inside the
  // AEQI Ownership group on 2026-05-18 to its own peer slot under Trust, so
  // the connective-tissue primitive (authority graph) sits between the board
  // tier (Ownership) and the operating tier (Execution).
  if (tab === "roles") {
    return (
      <Suspense>
        <TrustRolesTab trustId={trustId} />
      </Suspense>
    );
  }
  // Incorporation — `i` in the AEQI grammar. The TRUST's constitutional
  // surface (charter, founders, registration). Renamed from "Identity"
  // 2026-05-18 when the role-graph moved to its own `roles` row.
  if (tab === "incorporation") {
    return (
      <Suspense>
        <IncorporationPage trustId={trustId} />
      </Suspense>
    );
  }
  if (tab === "assets") {
    return (
      <Suspense>
        <AssetsPage trustId={trustId} />
      </Suspense>
    );
  }
  if (tab === "equity") {
    return (
      <Suspense>
        <EquityPage trustId={trustId} />
      </Suspense>
    );
  }
  if (tab === "quorum") {
    return (
      <Suspense>
        <QuorumPage trustId={trustId} />
      </Suspense>
    );
  }
  if (tab === "events") {
    return (
      <Suspense>
        <AgentEventsTab agentId={agentId} agentRail />
      </Suspense>
    );
  }
  if (tab === "quests") {
    return (
      <Suspense>
        <AgentQuestsTab agentId={agentId} scope="entity" />
      </Suspense>
    );
  }
  if (tab === "ideas") {
    return (
      <Suspense>
        <AgentIdeasTab agentId={agentId} scope="entity" />
      </Suspense>
    );
  }
  if (tab === "settings") {
    return (
      <Suspense>
        <TrustSettingsTab trustId={trustId} />
      </Suspense>
    );
  }
  // Any unknown tab falls through to the root agent's chat surface.
  // AgentPage's tab prop is a no-op since 2026-05-08 — every entity-scope
  // tab MUST have an explicit branch above. New tabs go above this line.
  return <AgentPage agentId={agentId} tab={tab} itemId={itemId} />;
}
