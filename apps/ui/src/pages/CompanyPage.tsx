import { useEffect } from "react";
import AgentPage from "@/components/AgentPage";
import PageRail from "@/components/PageRail";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "positions", label: "Positions" },
];

interface CompanyPageProps {
  agentId: string;
  /** Resolved tab — already defaulted to "overview" upstream when the URL
   *  has no `:tab` segment. */
  tab: string;
  itemId?: string;
}

/**
 * /:entityId[/:tab] — the company-scoped surface.
 *
 * Two-column page-rail-shell mirroring `/economy`: the left rail lists
 * the company's primitives (Overview / Positions / Agents / Events /
 * Quests / Ideas), the right pane renders whichever tab AgentPage
 * already knows how to draw. Sub-tab navigation is owned here so the
 * global LeftSidebar carries one "Company" item, not six.
 */
export default function CompanyPage({ agentId, tab, itemId }: CompanyPageProps) {
  useEffect(() => {
    const titles: Record<string, string> = {
      overview: "overview",
      positions: "positions",
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
        basePath={`/${encodeURIComponent(agentId)}`}
        currentValue={tab}
      />
      <div className="page-rail-content page-rail-content--full">
        <AgentPage agentId={agentId} tab={tab} itemId={itemId} />
      </div>
    </div>
  );
}
