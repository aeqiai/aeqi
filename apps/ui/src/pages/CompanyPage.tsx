import { useEffect } from "react";
import AgentPage from "@/components/AgentPage";
import PageRail from "@/components/PageRail";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "positions", label: "Positions" },
];

interface CompanyPageProps {
  agentId: string;
  entityId: string;
  /** Resolved tab — defaulted to "overview" upstream. The bare
   *  `/c/<entity>` URL redirects to `/c/<entity>/overview` in
   *  AppLayout, so this prop is always one of the TABS values. */
  tab: string;
  itemId?: string;
}

/**
 * `/c/:entityId/overview` — the company dashboard (canonical
 * company landing). Plus `/c/:entityId/positions` — the org chart.
 * Both wrap the existing AgentPage tab content with a thin PageRail
 * so the user can pivot between Overview ↔ Positions inside the
 * company dashboard surface.
 *
 * The four W-primitives (Agents / Quests / Ideas / Events) live on
 * sibling URLs (`/c/<id>/agents`, …) and route through AgentPage
 * directly with no PageRail wrapper — they're separate sidebar
 * destinations under the Company group, each with its own active
 * state.
 */
export default function CompanyPage({ agentId, entityId, tab, itemId }: CompanyPageProps) {
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
        basePath={`/c/${encodeURIComponent(entityId)}`}
        currentValue={tab}
      />
      <div className="page-rail-content page-rail-content--full">
        <AgentPage agentId={agentId} tab={tab} itemId={itemId} />
      </div>
    </div>
  );
}
