import { Suspense, lazy, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import AgentPage from "@/components/AgentPage";
import OwnershipPage from "@/pages/OwnershipPage";
import TreasuryPage from "@/pages/TreasuryPage";
import GovernancePage from "@/pages/GovernancePage";
import MeInboxPage from "@/pages/MeInboxPage";
import { useCurrentCompany } from "@/hooks/useCurrentCompany";

// EntityOverviewTab is the canonical bare-`/c/<id>/` landing — renders
// EntityHeroStrip + roles / quests / activity. Lazy-loaded to keep this
// dispatch shell light. Mirrors the lazy pattern used in AgentPage.
const EntityOverviewTab = lazy(() => import("@/components/EntityOverviewTab"));
// Entity-scope primitive tabs. `EntityAgentsTab` is entity-typed (takes
// entityId, filters the directory). The remaining three render the
// agent-scoped tab against the entity's ROOT agent. Without these explicit branches,
// the fallthrough to `<AgentPage tab=...>` rendered the root agent's chat
// surface (AgentPage ignores `tab`) — see "Dispatch hole fix 2026-05-09".
const EntityAgentsTab = lazy(() => import("@/components/EntityAgentsTab"));
const EntityRolesTab = lazy(() => import("@/components/EntityRolesTab"));
const AgentEventsTab = lazy(() => import("@/components/AgentEventsTab"));
const AgentQuestsTab = lazy(() => import("@/components/AgentQuestsTab"));
const AgentIdeasTab = lazy(() => import("@/components/AgentIdeasTab"));

const TAB_TITLES: Record<string, string> = {
  overview: "overview",
  inbox: "inbox",
  roles: "roles",
  ownership: "ownership",
  treasury: "treasury",
  governance: "governance",
  agents: "agents",
  events: "events",
  quests: "quests",
  ideas: "ideas",
};

interface CompanyPageProps {
  agentId: string;
  entityId: string;
  /** Resolved tab — defaulted to "overview" upstream. The bare
   *  `/c/<entity>` URL renders Overview through this tab default. */
  tab: string;
  itemId?: string;
}

/**
 * Phase-1 sidebar lock: each former Company sub-tab is now a top-level
 * sidebar row. The internal `PageRail` is removed; CompanyPage just
 * dispatches the right component per tab.
 *
 * Routes:
 *   /c/:entityId               → EntityOverviewTab (cockpit)
 *   /c/:entityId/inbox         → MeInboxPage
 *   /c/:entityId/roles         → EntityRolesTab (org chart)
 *   /c/:entityId/ownership     → OwnershipPage
 *   /c/:entityId/treasury      → TreasuryPage
 *   /c/:entityId/governance    → GovernancePage
 *   /c/:entityId/agents        → EntityAgentsTab (LIST)
 *   /c/:entityId/events        → AgentEventsTab(rootAgent)
 *   /c/:entityId/quests        → AgentQuestsTab(rootAgent)
 *   /c/:entityId/ideas         → AgentIdeasTab(rootAgent)
 *
 * The former `/c/:entityId/settings` tab was retired — workspace label,
 * tagline, public toggle, and plan link now live in the EntityHeroStrip
 * on Overview. Workspace billing remains at `/account/billing`.
 */
export default function CompanyPage({ agentId, entityId, tab, itemId }: CompanyPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { entity } = useCurrentCompany();

  // Title effect
  useEffect(() => {
    const section = TAB_TITLES[tab] ?? "company";
    document.title = `${section} · æqi`;
  }, [tab]);

  // Trust-address redirect: when entity gains a trust_address, redirect to
  // the canonical /trust/<address>/tab URL (once registerTRUST lands).
  // Idempotent: skips if already on /trust/ route.
  useEffect(() => {
    // Skip if we're already on the /trust/ canonical URL or if entity has no trust_address
    if (!entity?.trust_address || location.pathname.startsWith("/trust/")) {
      return;
    }

    // Construct the target path: /trust/<address>/<tab>[/itemId]
    const trustAddr = entity.trust_address.toLowerCase();
    let targetPath = `/trust/${encodeURIComponent(trustAddr)}/${tab}`;
    if (itemId) {
      targetPath += `/${encodeURIComponent(itemId)}`;
    }
    // Preserve the query string (`?view=kanban`, `?view=table`, etc.) —
    // a deep link like `/c/<id>/ideas?view=kanban` would otherwise drop
    // the `view` param on redirect and land on the default list view.
    if (location.search) {
      targetPath += location.search;
    }

    // Replace the history entry so the user doesn't pollute their back-button
    navigate(targetPath, { replace: true });
  }, [entity?.trust_address, tab, itemId, navigate, location.pathname, location.search]);

  // Inbox is the company-scoped action queue. Visually it's MeInbox
  // for now (Phase-1 cross-company aggregation lives at top-level
  // /inbox in WS-57).
  if (tab === "inbox") return <MeInboxPage />;
  if (tab === "ownership") return <OwnershipPage entityId={entityId} />;
  if (tab === "treasury") return <TreasuryPage entityId={entityId} />;
  if (tab === "governance") return <GovernancePage entityId={entityId} />;

  // Bare `/c/<id>/` Overview renders EntityOverviewTab directly — the
  // canonical entity cockpit (EntityHeroStrip + roles / quests / activity).
  // Routing through AgentPage's `isDrilledAgent` branch was wrong for
  // root agents whose `entity_id` is populated and differs from
  // `agent.id` (the post-2026-04-29 schema): the branch flagged the
  // root agent as "drilled" and rendered AgentOverviewTab instead, so
  // EntityHeroStrip never mounted. CompanyPage already knows it's the
  // bare entity URL (drilled URLs bypass CompanyPage entirely in
  // AppLayout) — render the entity surface explicitly.
  if (tab === "overview") {
    return (
      <Suspense>
        <EntityOverviewTab entityId={entityId} />
      </Suspense>
    );
  }

  // Entity-scope primitive tabs. Without these explicit branches the
  // fallthrough to AgentPage rendered the root agent's chat surface
  // (AgentPage's `tab` prop has been a no-op since 2026-05-08), which
  // is why `/c/<id>/agents` and siblings landed on a header with no
  // body. Dispatch hole fix 2026-05-09.
  if (tab === "agents") {
    return (
      <Suspense>
        <EntityAgentsTab entityId={entityId} />
      </Suspense>
    );
  }
  if (tab === "roles") {
    return (
      <Suspense>
        <EntityRolesTab entityId={entityId} />
      </Suspense>
    );
  }
  if (tab === "events") {
    return (
      <Suspense>
        <AgentEventsTab agentId={agentId} />
      </Suspense>
    );
  }
  if (tab === "quests") {
    return (
      <Suspense>
        <AgentQuestsTab agentId={agentId} />
      </Suspense>
    );
  }
  if (tab === "ideas") {
    return (
      <Suspense>
        <AgentIdeasTab agentId={agentId} />
      </Suspense>
    );
  }

  // Any unknown tab falls through to the root agent's chat surface.
  // AgentPage's tab prop is a no-op since 2026-05-08 — every entity-scope
  // tab MUST have an explicit branch above. New tabs go above this line.
  return <AgentPage agentId={agentId} tab={tab} itemId={itemId} />;
}
