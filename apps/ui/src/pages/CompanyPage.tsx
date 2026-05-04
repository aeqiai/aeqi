import { useEffect } from "react";
import AgentPage from "@/components/AgentPage";
import OwnershipPage from "@/pages/OwnershipPage";
import TreasuryPage from "@/pages/TreasuryPage";
import GovernancePage from "@/pages/GovernancePage";
import CompanySettingsPage from "@/pages/CompanySettingsPage";
import MeInboxPage from "@/pages/MeInboxPage";

const TAB_TITLES: Record<string, string> = {
  overview: "overview",
  inbox: "inbox",
  roles: "roles",
  ownership: "ownership",
  treasury: "treasury",
  governance: "governance",
  settings: "settings",
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
 *   /c/:entityId               → AgentPage tab="overview" (cockpit)
 *   /c/:entityId/inbox         → MeInboxPage
 *   /c/:entityId/roles         → AgentPage tab="roles" (EntityRolesTab)
 *   /c/:entityId/ownership     → OwnershipPage
 *   /c/:entityId/treasury      → TreasuryPage
 *   /c/:entityId/governance    → GovernancePage
 *   /c/:entityId/settings      → CompanySettingsPage
 *
 * Every other tab name (agents, events, quests, ideas, sessions, …)
 * falls through to AgentPage, which is the canonical primitive surface.
 */
export default function CompanyPage({ agentId, entityId, tab, itemId }: CompanyPageProps) {
  useEffect(() => {
    const section = TAB_TITLES[tab] ?? "company";
    document.title = `${section} · æqi`;
  }, [tab]);

  // Inbox is the company-scoped action queue. Visually it's MeInbox
  // for now (Phase-1 cross-company aggregation lives at top-level
  // /inbox in WS-57).
  if (tab === "inbox") return <MeInboxPage />;
  if (tab === "ownership") return <OwnershipPage entityId={entityId} />;
  if (tab === "treasury") return <TreasuryPage entityId={entityId} />;
  if (tab === "governance") return <GovernancePage entityId={entityId} />;
  if (tab === "settings") return <CompanySettingsPage agentId={agentId} />;

  // Overview, Roles, and any other primitive tab (agents, events,
  // quests, ideas) render through AgentPage on the entity's root agent.
  return <AgentPage agentId={agentId} tab={tab} itemId={itemId} />;
}
