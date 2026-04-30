import { useEffect } from "react";
import AgentPage from "@/components/AgentPage";
import PageRail from "@/components/PageRail";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "roles", label: "Roles" },
];

interface CompanyPageProps {
  agentId: string;
  entityId: string;
  /** Resolved tab — defaulted to "overview" upstream. The bare
   *  `/c/<entity>` URL renders Overview through this tab default. */
  tab: string;
  itemId?: string;
}

/**
 * `/c/:entityId/overview` (and `/c/:entityId/roles`) — the company
 * cockpit and the org chart. Both delegate to AgentPage, which routes
 * by tab. The inner PageRail is the company entity's secondary nav —
 * it sits below the global LeftSidebar's company section (which owns
 * the four primitives + Overview) and lists company-as-an-entity views
 * like Roles, Treasury, Governance, Cap Table — surfaces that grow as
 * the company grows. Distinct from the agent rail (which mounts at
 * AppLayout body-row level and lists agent-scoped destinations).
 */
export default function CompanyPage({ agentId, entityId, tab, itemId }: CompanyPageProps) {
  useEffect(() => {
    const titles: Record<string, string> = {
      overview: "overview",
      roles: "roles",
    };
    const section = titles[tab] || "company";
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
        <AgentPage agentId={agentId} tab={tab} itemId={itemId} />
      </div>
    </div>
  );
}
