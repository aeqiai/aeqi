import { useEffect } from "react";
import AgentPage from "@/components/AgentPage";

interface CompanyPageProps {
  agentId: string;
  /** Resolved tab — defaulted to "overview" upstream. The bare
   *  `/c/<entity>` URL renders Overview through this tab default. */
  tab: string;
  itemId?: string;
}

/**
 * `/c/:entityId/overview` (and `/c/:entityId/positions`) — the company
 * cockpit and the org chart, respectively. Both delegate to AgentPage,
 * which routes by tab. No inner PageRail: the company's "rail" IS the
 * global LeftSidebar's company section (Overview / Agents / Quests /
 * Ideas / Events / Positions). One rail per scope, mounted at the
 * outer chrome — not nested inside the page body.
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

  return <AgentPage agentId={agentId} tab={tab} itemId={itemId} />;
}
