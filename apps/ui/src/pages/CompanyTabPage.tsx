import { Suspense, lazy, useEffect } from "react";
import { Navigate, useNavigate, useLocation } from "react-router-dom";
import AgentPage from "@/components/AgentPage";
import { useCurrentCompany } from "@/hooks/useCurrentCompany";
import { useRuntimeStatus } from "@/hooks/useRuntimeStatus";
import ProvisionRuntimeUpsell, {
  type UpsellSurface,
} from "@/components/upsell/ProvisionRuntimeUpsell";
import { withUserSessionsView } from "@/lib/sessionViews";
import { EmptyState, Page, PageBody, PageHeader } from "@/components/ui";

// CompanyOverviewTab is the legacy implementation name for the canonical
// bare-`/company/<addr>/` Views landing — renders CompanyHeroStrip + roles /
// quests / activity. Lazy-loaded to keep this dispatch shell light.
const CompanyOverviewTab = lazy(() => import("@/components/CompanyOverviewTab"));
// Company-scope primitive tabs. `CompanyAgentsTab` is entity-typed (takes
// companyId, filters the directory). Events render through an agent lens rail
// so the same page can inspect each agent's loop handlers. Quests and Ideas
// ask their shared components for entity-wide data so sibling-agent work
// remains visible on `/company/<addr>/...`.
const CompanyAgentsTab = lazy(() => import("@/components/CompanyAgentsTab"));
const CompanyAppsTab = lazy(() => import("@/components/CompanyAppsTab"));
const CompanyBudgetsTab = lazy(() => import("@/components/CompanyBudgetsTab"));
const CompanyCampaignsTab = lazy(() => import("@/components/CompanyCampaignsTab"));
const CompanyTransactionsTab = lazy(() => import("@/components/CompanyTransactionsTab"));
const CompanySessionsTab = lazy(() => import("@/components/CompanySessionsTab"));
const AgentGatewaysTab = lazy(() => import("@/components/AgentChannelsTab"));
const CompanyToolsTab = lazy(() => import("@/components/CompanyToolsTab"));
const CompanyMembersTab = lazy(() => import("@/components/CompanyMembersTab"));
const CompanyRolesTab = lazy(() => import("@/components/CompanyRolesTab"));
const CompanyRoleDetailPage = lazy(() => import("@/components/roles/CompanyRoleDetailPage"));
const EquityPage = lazy(() => import("@/pages/EquityPage"));
const AssetsPage = lazy(() => import("@/pages/AssetsPage"));
const AgentEventsTab = lazy(() => import("@/components/AgentEventsTab"));
const AgentQuestsTab = lazy(() => import("@/components/AgentQuestsTab"));
const AgentIdeasTab = lazy(() => import("@/components/AgentIdeasTab"));
const CompanySettingsTab = lazy(() => import("@/components/CompanySettingsTab"));

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
  runtime: {
    title: "Runtime",
    description: "Runtime placement, health, and service controls will live here.",
  },
  usage: {
    title: "Usage",
    description: "Usage meters, limits, and spend telemetry will live here.",
  },
  billing: {
    title: "Billing",
    description: "Invoices, payment methods, and billing controls will live here.",
  },
  logs: {
    title: "Logs",
    description: "Audit, runtime, and infrastructure logs will live here.",
  },
} as const;

type PlaceholderTab = keyof typeof PLACEHOLDER_TABS;

function CompanyPrimitivePlaceholder({ tab }: { tab: PlaceholderTab }) {
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

interface CompanyTabPageProps {
  agentId: string;
  companyId: string;
  /** Resolved tab — defaulted to the legacy "overview" id upstream. The
   *  bare `/company/<addr>` URL renders the Views landing through it. */
  tab: string;
  itemId?: string;
}

/**
 * Phase-1 sidebar lock: each former Company sub-tab is now a top-level
 * sidebar row. The internal `PageRail` is removed; CompanyTabPage just
 * dispatches the right component per tab.
 *
 * Routes:
 *   /company/:companyAddress               → CompanyOverviewTab (Views landing — Health folded in)
 *   /company/:companyAddress/roles         → CompanyRolesTab (org chart)
 *   /company/:companyAddress/roles/:roleId → CompanyRoleDetailPage
 *   /company/:companyAddress/members       → CompanyMembersTab (humans + pending invites)
 *   /company/:companyAddress/controls      → placeholder (governance controls)
 *   /company/:companyAddress/filings       → placeholder (legal/tax filings)
 *   /company/:companyAddress/agents        → CompanyAgentsTab (LIST)
 *   /company/:companyAddress/sessions      → CompanySessionsTab (all company sessions)
 *   /company/:companyAddress/projects      → placeholder (native project workspace)
 *   /company/:companyAddress/goals         → placeholder (native goal workspace)
 *   /company/:companyAddress/skills        → placeholder (native skill workspace)
 *   /company/:companyAddress/inbox         → redirect to Sessions?view=mine (legacy URL)
 *   /company/:companyAddress/apps          → CompanyAppsTab(app registry)
 *   /company/:companyAddress/mails         → CompanyAppsTab(mails surface)
 *   /company/:companyAddress/websites      → CompanyAppsTab(websites surface)
 *   /company/:companyAddress/campaigns     → CompanyCampaignsTab
 *   /company/:companyAddress/shares        → EquityPage(cap table)
 *   /company/:companyAddress/rounds        → EquityPage(funding rounds)
 *   /company/:companyAddress/budgets       → CompanyBudgetsTab
 *   /company/:companyAddress/assets        → AssetsPage
 *   /company/:companyAddress/transactions  → CompanyTransactionsTab
 *   /company/:companyAddress/gateways      → AgentGatewaysTab(default/root agent lens)
 *   /company/:companyAddress/integrations  → CompanyAppsTab (external connections)
 *   /company/:companyAddress/tools         → CompanyToolsTab(default/root agent lens)
 *   /company/:companyAddress/runtime       → placeholder (runtime controls)
 *   /company/:companyAddress/usage         → placeholder (usage telemetry)
 *   /company/:companyAddress/billing       → placeholder (billing controls)
 *   /company/:companyAddress/events        → AgentEventsTab(agent lens rail)
 *   /company/:companyAddress/logs          → placeholder (audit/runtime logs)
 *   /company/:companyAddress/quests        → AgentQuestsTab(entity scope)
 *   /company/:companyAddress/ideas         → AgentIdeasTab(entity scope)
 *   /company/:companyAddress/settings      → CompanySettingsTab
 *   /company/:companyAddress/health        → 308 redirect to bare cockpit (legacy URL)
 *   /company/:companyAddress/equity        → redirect to Shares (legacy URL)
 *   /company/:companyAddress/channels      → redirect to Gateways (legacy channels tab)
 *   /company/:companyAddress/mail          → redirect to Mails (legacy singular)
 *   /company/:companyAddress/website       → redirect to Websites (legacy website tab)
 */
/** Tabs that require a per-tenant runtime service.
 *  When `has_runtime === false`, render `<ProvisionRuntimeUpsell>` in
 *  their slot instead of the real tab body. Views, Roles, and Members read
 *  company state and stay reachable on free Companies. */
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

export default function CompanyTabPage({ agentId, companyId, tab, itemId }: CompanyTabPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { entity } = useCurrentCompany();
  // Runtime status drives whether the 5 execution tabs render or get
  // upsold. React Query dedupes parallel calls, so the per-tab gate
  // shares a single fetch with CompanyOverviewTab.
  const { hasRuntime, isLoading: runtimeStatusLoading } = useRuntimeStatus(companyId);

  // Title effect
  useEffect(() => {
    document.title = "aeqi";
  }, []);

  // Company-address redirect: when entity gains a company_address, redirect to
  // the canonical /company/<address>/tab URL (once registerCOMPANY lands).
  // Idempotent: skips if already on /company/ route.
  useEffect(() => {
    // Skip if we're already on the /company/ canonical URL or if entity has no company_address
    if (!entity?.company_address || location.pathname.startsWith("/company/")) {
      return;
    }

    // Construct the target path: /company/<address>/<tab>[/itemId]
    const trustAddr = entity.company_address;
    let targetPath = `/company/${encodeURIComponent(trustAddr)}/${tab}`;
    if (itemId) {
      targetPath += `/${encodeURIComponent(itemId)}`;
    }
    // Preserve the query string (`?view=kanban`, `?view=table`, etc.) —
    // a deep link like `/company/<addr>/ideas?view=kanban` would otherwise drop
    // the `view` param on redirect and land on the default list view.
    if (location.search) {
      targetPath += location.search;
    }

    // Replace the history entry so the user doesn't pollute their back-button
    navigate(targetPath, { replace: true });
  }, [entity?.company_address, tab, itemId, navigate, location.pathname, location.search]);

  // Canonicalize legacy aliases before the runtime gate so stale links
  // still land on the current route names even when the company has no runtime.
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
    return <ProvisionRuntimeUpsell surface={upsellSurface} companyId={companyId} />;
  }

  // /health was retired 2026-05-17 — folded into CompanyOverviewTab on
  // the bare COMPANY URL. Redirect existing deep links to the cockpit so
  // they land on the same content without breaking bookmarks.
  if (tab === "health") {
    const target = location.pathname.replace(/\/health\/?$/, "/") + location.search;
    return <Navigate to={target} replace />;
  }

  if (tab in PLACEHOLDER_TABS) {
    return <CompanyPrimitivePlaceholder tab={tab as PlaceholderTab} />;
  }

  // Bare `/company/<addr>/` Views renders CompanyOverviewTab directly — the
  // canonical entity landing (CompanyHeroStrip + roles / quests / activity).
  // Routing through AgentPage's `isDrilledAgent` branch was wrong for
  // root agents whose `company_id` is populated and differs from
  // `agent.id` (the post-2026-04-29 schema): the branch flagged the
  // root agent as "drilled" and rendered AgentOverviewTab instead, so
  // CompanyHeroStrip never mounted. CompanyTabPage already knows it's the
  // bare entity URL (drilled URLs bypass CompanyTabPage entirely in
  // AppLayout) — render the entity surface explicitly.
  if (tab === "overview" || tab === "views") {
    return (
      <Suspense>
        <CompanyOverviewTab companyId={companyId} />
      </Suspense>
    );
  }

  // Company-scope primitive tabs. Without these explicit branches the
  // fallthrough to AgentPage rendered the root agent's chat surface
  // (AgentPage's `tab` prop has been a no-op since 2026-05-08), which
  // is why `/company/<addr>/agents` and siblings landed on a header with no
  // body. Dispatch hole fix 2026-05-09.
  if (tab === "agents") {
    return (
      <Suspense>
        <CompanyAgentsTab companyId={companyId} />
      </Suspense>
    );
  }
  if (tab === "apps") {
    return (
      <Suspense>
        <CompanyAppsTab companyId={companyId} surface="apps" />
      </Suspense>
    );
  }
  if (tab === "integrations") {
    return (
      <Suspense>
        <CompanyAppsTab companyId={companyId} surface="integrations" />
      </Suspense>
    );
  }
  if (tab === "mails") {
    return (
      <Suspense>
        <CompanyAppsTab companyId={companyId} surface="mail" />
      </Suspense>
    );
  }
  if (tab === "websites") {
    return (
      <Suspense>
        <CompanyAppsTab companyId={companyId} surface="websites" />
      </Suspense>
    );
  }
  if (tab === "campaigns") {
    return (
      <Suspense>
        <CompanyCampaignsTab />
      </Suspense>
    );
  }
  if (tab === "shares") {
    return (
      <Suspense>
        <EquityPage companyId={companyId} />
      </Suspense>
    );
  }
  if (tab === "rounds") {
    return (
      <Suspense>
        <EquityPage companyId={companyId} />
      </Suspense>
    );
  }
  if (tab === "budgets") {
    return (
      <Suspense>
        <CompanyBudgetsTab />
      </Suspense>
    );
  }
  if (tab === "assets") {
    return (
      <Suspense>
        <AssetsPage companyId={companyId} />
      </Suspense>
    );
  }
  if (tab === "transactions") {
    return (
      <Suspense>
        <CompanyTransactionsTab />
      </Suspense>
    );
  }
  if (tab === "sessions") {
    return (
      <Suspense>
        <CompanySessionsTab companyId={companyId} itemId={itemId} />
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
        <CompanyToolsTab agentId={agentId} />
      </Suspense>
    );
  }
  // Members — humans with company access or pending company invitations. This is
  // deliberately separate from Roles: a human can belong to the company before
  // holding an authority seat, just like agents can exist before assignment.
  if (tab === "members") {
    return (
      <Suspense>
        <CompanyMembersTab companyId={companyId} />
      </Suspense>
    );
  }
  // Roles — the org-chart / authority-graph surface. Hoisted from inside the
  // AEQI Ownership group on 2026-05-18 to its own peer slot under Company, so
  // the connective-tissue primitive (authority graph) sits between the board
  // tier (Ownership) and the operating tier (Execution).
  if (tab === "roles") {
    if (itemId) {
      return (
        <Suspense>
          <CompanyRoleDetailPage companyId={companyId} roleId={itemId} />
        </Suspense>
      );
    }
    return (
      <Suspense>
        <CompanyRolesTab companyId={companyId} />
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
        <CompanySettingsTab companyId={companyId} />
      </Suspense>
    );
  }
  // Any unknown tab falls through to the root agent's chat surface.
  // AgentPage's tab prop is a no-op since 2026-05-08 — every entity-scope
  // tab MUST have an explicit branch above. New tabs go above this line.
  return <AgentPage agentId={agentId} tab={tab} itemId={itemId} />;
}
