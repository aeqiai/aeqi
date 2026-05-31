import { Suspense, lazy, useEffect } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import AgentPage from "@/components/AgentPage";
import { useCurrentTrust } from "@/hooks/useCurrentTrust";
import { useRuntimeStatus } from "@/hooks/useRuntimeStatus";
import ProvisionRuntimeUpsell, {
  type UpsellSurface,
} from "@/components/upsell/ProvisionRuntimeUpsell";
import { withUserSessionsView } from "@/lib/sessionViews";
import { EmptyState, Page, PageBody, PageHeader } from "@/components/ui";

// TrustOverviewTab is the legacy implementation name for the canonical
// bare-`/trust/<addr>/` Views landing — renders TrustHeroStrip + roles /
// quests / activity. Lazy-loaded to keep this dispatch shell light.
const TrustOverviewTab = lazy(() => import("@/components/TrustOverviewTab"));
// Trust-scope primitive tabs. `TrustAgentsTab` is entity-typed (takes
// trustId, filters the directory). Events render through an agent lens rail
// so the same page can inspect each agent's loop handlers. Quests and Ideas
// ask their shared components for entity-wide data so sibling-agent work
// remains visible on `/trust/<addr>/...`.
const TrustAgentsTab = lazy(() => import("@/components/TrustAgentsTab"));
const TrustAppsTab = lazy(() => import("@/components/TrustAppsTab"));
const TrustBudgetsTab = lazy(() => import("@/components/TrustBudgetsTab"));
const TrustCampaignsTab = lazy(() => import("@/components/TrustCampaignsTab"));
const TrustTransactionsTab = lazy(() => import("@/components/TrustTransactionsTab"));
const TrustSessionsTab = lazy(() => import("@/components/TrustSessionsTab"));
const AgentGatewaysTab = lazy(() => import("@/components/AgentChannelsTab"));
const TrustToolsTab = lazy(() => import("@/components/TrustToolsTab"));
const TrustMembersTab = lazy(() => import("@/components/TrustMembersTab"));
const TrustRolesTab = lazy(() => import("@/components/TrustRolesTab"));
const TrustRoleDetailPage = lazy(() => import("@/components/roles/TrustRoleDetailPage"));
const EquityPage = lazy(() => import("@/pages/EquityPage"));
const AssetsPage = lazy(() => import("@/pages/AssetsPage"));
const AgentEventsTab = lazy(() => import("@/components/AgentEventsTab"));
const AgentQuestsTab = lazy(() => import("@/components/AgentQuestsTab"));
const AgentIdeasTab = lazy(() => import("@/components/AgentIdeasTab"));
const TrustSettingsTab = lazy(() => import("@/components/TrustSettingsTab"));

const PLACEHOLDER_TABS = {
  projects: {
    title: "Projects",
    description: "Native project planning will live here. For now this surface is reserved.",
  },
  goals: {
    title: "Goals",
    description:
      "Goal ownership, progress, and targets will live here. For now this surface is reserved.",
  },
  skills: {
    title: "Skills",
    description: "Reusable AEQI skills will live here. For now this surface is reserved.",
  },
  controls: {
    title: "Controls",
    description: "Governance controls, voting rules, and multisig settings will live here.",
  },
  filings: {
    title: "Filings",
    description: "Incorporation, tax, and compliance filings will live here.",
  },
  logs: {
    title: "Logs",
    description: "Audit, runtime, and infrastructure logs will live here.",
  },
} as const;

type PlaceholderTab = keyof typeof PLACEHOLDER_TABS;

function TrustPrimitivePlaceholder({ tab }: { tab: PlaceholderTab }) {
  const copy = PLACEHOLDER_TABS[tab];

  return (
    <Page width="full" padding="lg">
      <PageHeader title={copy.title} description={copy.description} />
      <PageBody>
        <EmptyState
          eyebrow="Placeholder"
          title="Reserved AEQI primitive"
          description="This surface is intentionally blank while its native workflow is being designed."
        />
      </PageBody>
    </Page>
  );
}

interface TrustTabPageProps {
  agentId: string;
  trustId: string;
  /** Resolved tab — defaulted to the legacy "overview" id upstream. The
   *  bare `/trust/<addr>` URL renders the Views landing through it. */
  tab: string;
  itemId?: string;
}

/**
 * Phase-1 sidebar lock: each former Company sub-tab is now a top-level
 * sidebar row. The internal `PageRail` is removed; TrustTabPage just
 * dispatches the right component per tab.
 *
 * Routes:
 *   /trust/:trustAddress               → TrustOverviewTab (Views landing — Health folded in)
 *   /trust/:trustAddress/roles         → TrustRolesTab (org chart)
 *   /trust/:trustAddress/roles/:roleId → TrustRoleDetailPage
 *   /trust/:trustAddress/members       → TrustMembersTab (humans + pending invites)
 *   /trust/:trustAddress/controls      → placeholder (governance controls)
 *   /trust/:trustAddress/filings       → placeholder (legal/tax filings)
 *   /trust/:trustAddress/agents        → TrustAgentsTab (LIST)
 *   /trust/:trustAddress/sessions      → TrustSessionsTab (all trust sessions)
 *   /trust/:trustAddress/projects      → placeholder (native project workspace)
 *   /trust/:trustAddress/goals         → placeholder (native goal workspace)
 *   /trust/:trustAddress/skills        → placeholder (native skill workspace)
 *   /trust/:trustAddress/inbox         → redirect to Sessions?view=mine (legacy URL)
 *   /trust/:trustAddress/apps          → TrustAppsTab(app registry)
 *   /trust/:trustAddress/mails         → TrustAppsTab(mails surface)
 *   /trust/:trustAddress/websites      → TrustAppsTab(websites surface)
 *   /trust/:trustAddress/campaigns     → TrustCampaignsTab
 *   /trust/:trustAddress/shares        → EquityPage(cap table)
 *   /trust/:trustAddress/rounds        → EquityPage(funding rounds)
 *   /trust/:trustAddress/budgets       → TrustBudgetsTab
 *   /trust/:trustAddress/assets        → AssetsPage
 *   /trust/:trustAddress/transactions  → TrustTransactionsTab
 *   /trust/:trustAddress/gateways      → AgentGatewaysTab(default/root agent lens)
 *   /trust/:trustAddress/integrations  → TrustAppsTab (external connections)
 *   /trust/:trustAddress/tools         → TrustToolsTab(default/root agent lens)
 *   /trust/:trustAddress/events        → AgentEventsTab(agent lens rail)
 *   /trust/:trustAddress/logs          → placeholder (audit/runtime logs)
 *   /trust/:trustAddress/quests        → AgentQuestsTab(entity scope)
 *   /trust/:trustAddress/ideas         → AgentIdeasTab(entity scope)
 *   /trust/:trustAddress/settings      → TrustSettingsTab
 *   /trust/:trustAddress/health        → 308 redirect to bare cockpit (legacy URL)
 *   /trust/:trustAddress/equity        → redirect to Shares (legacy URL)
 *   /trust/:trustAddress/channels      → redirect to Gateways (legacy channels tab)
 *   /trust/:trustAddress/mail          → redirect to Mails (legacy singular)
 *   /trust/:trustAddress/website       → redirect to Websites (legacy website tab)
 */
/** Tabs that require a per-tenant runtime service.
 *  When `has_runtime === false`, render `<ProvisionRuntimeUpsell>` in
 *  their slot instead of the real tab body. Views, Roles, and Members read
 *  trust state and stay reachable on free TRUSTs. */
const RUNTIME_GATED_TABS: Record<string, UpsellSurface> = {
  agents: "agents",
  integrations: "apps",
  campaigns: "campaigns",
  sessions: "sessions",
  gateways: "gateways",
  channels: "gateways",
  tools: "apps",
  events: "events",
  quests: "quests",
  ideas: "ideas",
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

  // Canonicalize legacy aliases before the runtime gate so stale links
  // still land on the current route names even when the trust has no runtime.
  if (tab === "equity") {
    const target = location.pathname.replace(/\/equity(?=\/|$)/, "/shares") + location.search;
    return <Navigate to={target} replace />;
  }
  if (tab === "channels") {
    const target = location.pathname.replace(/\/channels(?=\/|$)/, "/gateways") + location.search;
    return <Navigate to={target} replace />;
  }
  if (tab === "mail") {
    const target = location.pathname.replace(/\/mail(?=\/|$)/, "/mails") + location.search;
    return <Navigate to={target} replace />;
  }
  if (tab === "website") {
    const target = location.pathname.replace(/\/website(?=\/|$)/, "/websites") + location.search;
    return <Navigate to={target} replace />;
  }
  if (tab === "inbox") {
    const path = location.pathname.replace(/\/inbox(?=\/|$)/, "/sessions");
    return <Navigate to={withUserSessionsView(path, location.search)} replace />;
  }

  // Runtime gate — applied before the per-tab dispatch so all gated
  // surfaces share one branch. While the status query is in-flight we
  // fall through to the normal per-tab render (best-effort optimism);
  // the gate flips to the upsell on the next render once the placement
  // confirms `has_runtime: false`.
  const upsellSurface = RUNTIME_GATED_TABS[tab];
  if (upsellSurface && !runtimeStatusLoading && !hasRuntime) {
    return <ProvisionRuntimeUpsell surface={upsellSurface} trustId={trustId} />;
  }

  // /health was retired 2026-05-17 — folded into TrustOverviewTab on
  // the bare TRUST URL. Redirect existing deep links to the cockpit so
  // they land on the same content without breaking bookmarks.
  if (tab === "health") {
    const target = location.pathname.replace(/\/health\/?$/, "/") + location.search;
    return <Navigate to={target} replace />;
  }

  if (tab in PLACEHOLDER_TABS) {
    return <TrustPrimitivePlaceholder tab={tab as PlaceholderTab} />;
  }

  // Bare `/trust/<addr>/` Views renders TrustOverviewTab directly — the
  // canonical entity landing (TrustHeroStrip + roles / quests / activity).
  // Routing through AgentPage's `isDrilledAgent` branch was wrong for
  // root agents whose `trust_id` is populated and differs from
  // `agent.id` (the post-2026-04-29 schema): the branch flagged the
  // root agent as "drilled" and rendered AgentOverviewTab instead, so
  // TrustHeroStrip never mounted. TrustTabPage already knows it's the
  // bare entity URL (drilled URLs bypass TrustTabPage entirely in
  // AppLayout) — render the entity surface explicitly.
  if (tab === "overview" || tab === "views") {
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
        <TrustAppsTab trustId={trustId} surface="apps" />
      </Suspense>
    );
  }
  if (tab === "integrations") {
    return (
      <Suspense>
        <TrustAppsTab trustId={trustId} surface="integrations" />
      </Suspense>
    );
  }
  if (tab === "mails") {
    return (
      <Suspense>
        <TrustAppsTab trustId={trustId} surface="mail" />
      </Suspense>
    );
  }
  if (tab === "websites") {
    return (
      <Suspense>
        <TrustAppsTab trustId={trustId} surface="websites" />
      </Suspense>
    );
  }
  if (tab === "campaigns") {
    return (
      <Suspense>
        <TrustCampaignsTab />
      </Suspense>
    );
  }
  if (tab === "shares") {
    return (
      <Suspense>
        <EquityPage trustId={trustId} />
      </Suspense>
    );
  }
  if (tab === "rounds") {
    return (
      <Suspense>
        <EquityPage trustId={trustId} />
      </Suspense>
    );
  }
  if (tab === "budgets") {
    return (
      <Suspense>
        <TrustBudgetsTab />
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
  if (tab === "transactions") {
    return (
      <Suspense>
        <TrustTransactionsTab />
      </Suspense>
    );
  }
  if (tab === "sessions") {
    return (
      <Suspense>
        <TrustSessionsTab trustId={trustId} itemId={itemId} />
      </Suspense>
    );
  }
  if (tab === "gateways") {
    return (
      <Suspense>
        <AgentGatewaysTab agentId={agentId} />
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
  // Members — humans with trust access or pending trust invitations. This is
  // deliberately separate from Roles: a human can belong to the trust before
  // holding an authority seat, just like agents can exist before assignment.
  if (tab === "members") {
    return (
      <Suspense>
        <TrustMembersTab trustId={trustId} />
      </Suspense>
    );
  }
  // Roles — the org-chart / authority-graph surface. Hoisted from inside the
  // AEQI Ownership group on 2026-05-18 to its own peer slot under Trust, so
  // the connective-tissue primitive (authority graph) sits between the board
  // tier (Ownership) and the operating tier (Execution).
  if (tab === "roles") {
    if (itemId) {
      return (
        <Suspense>
          <TrustRoleDetailPage trustId={trustId} roleId={itemId} />
        </Suspense>
      );
    }
    return (
      <Suspense>
        <TrustRolesTab trustId={trustId} />
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
