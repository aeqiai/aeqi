import { useEffect } from "react";
import AgentPage from "@/components/AgentPage";
import PageRail from "@/components/PageRail";
import OwnershipPage from "@/pages/OwnershipPage";
import TreasuryPage from "@/pages/TreasuryPage";
import GovernancePage from "@/pages/GovernancePage";
import CompanySettingsPage from "@/pages/CompanySettingsPage";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "roles", label: "Roles" },
  { id: "ownership", label: "Ownership" },
  { id: "treasury", label: "Treasury" },
  { id: "governance", label: "Governance" },
  { id: "settings", label: "Settings" },
];

const TAB_TITLES: Record<string, string> = {
  overview: "overview",
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
 * `/c/:entityId/{overview,roles,ownership,treasury,governance,settings}`
 * — the company cockpit. The PageRail is the company's secondary nav,
 * sitting below the global LeftSidebar's company section (which owns the
 * four primitives + Overview). Overview / Roles delegate to AgentPage;
 * Ownership / Treasury / Governance / Settings are dedicated
 * company-entity views (cap table, balance + budgets + transactions,
 * proposals, configuration) so they render their own pages inside the
 * same rail. Treasury holds the full financial picture (state, planned
 * spend, realised flow) as sub-views once wired. Settings is
 * company-scoped — distinct from user-account settings at `/me/*`.
 */
export default function CompanyPage({ agentId, entityId, tab, itemId }: CompanyPageProps) {
  useEffect(() => {
    const section = TAB_TITLES[tab] ?? "company";
    document.title = `${section} · æqi`;
  }, [tab]);

  return (
    <div className="page-rail-shell">
      <PageRail
        tabs={TABS}
        defaultTab="overview"
        title="Company"
        basePath={`/c/${encodeURIComponent(entityId)}`}
        currentValue={tab}
      />
      <div className="page-rail-content page-rail-content--full">
        {tab === "ownership" ? (
          <OwnershipPage />
        ) : tab === "treasury" ? (
          <TreasuryPage />
        ) : tab === "governance" ? (
          <GovernancePage />
        ) : tab === "settings" ? (
          <CompanySettingsPage />
        ) : (
          <AgentPage agentId={agentId} tab={tab} itemId={itemId} />
        )}
      </div>
    </div>
  );
}
