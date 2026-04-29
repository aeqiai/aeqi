import { useEffect } from "react";
import AgentPage from "@/components/AgentPage";
import Feed from "@/components/Feed";
import PageRail from "@/components/PageRail";

const TABS = [
  { id: "feed", label: "Feed" },
  { id: "overview", label: "Overview" },
  { id: "positions", label: "Positions" },
];

interface CompanyPageProps {
  agentId: string;
  entityId: string;
  /** Resolved tab — defaults to "feed" upstream when the URL has no
   *  `:tab` segment (the bare `/c/<entity>` URL is the company feed). */
  tab: string;
  itemId?: string;
}

/**
 * /c/:entityId[/:tab] — the company surface.
 *
 * One PageRail-shell wraps the three company-as-noun tabs: Feed (the
 * canonical home — chronological activity), Overview (org card),
 * Positions (org chart). The bare `/c/<entity>` URL lands on Feed;
 * Company sidebar item is active across all three tabs because they
 * are facets of the same surface.
 *
 * The four W-primitives (Agents / Events / Quests / Ideas) live on
 * sibling URLs (`/c/<entity>/agents`, …) and route through AgentPage
 * directly with no PageRail — they're separate sidebar destinations
 * with their own active state.
 */
export default function CompanyPage({ agentId, entityId, tab, itemId }: CompanyPageProps) {
  useEffect(() => {
    const titles: Record<string, string> = {
      feed: "company",
      overview: "overview",
      positions: "positions",
    };
    const section = titles[tab] || "company";
    document.title = `${section} · æqi`;
  }, [tab]);

  // Feed is the canonical landing — render the Feed component scoped
  // to this entity. Overview / Positions render the existing
  // AgentPage tabs (which know how to draw EntityOverviewTab and
  // EntityPositionsTab).
  const isFeed = tab === "feed";

  return (
    <div className="page-rail-shell">
      <PageRail
        tabs={TABS}
        defaultTab="feed"
        title="Company"
        basePath={`/c/${encodeURIComponent(entityId)}`}
        currentValue={tab}
      />
      <div className="page-rail-content page-rail-content--full">
        {isFeed ? (
          <Feed scope="company" entityId={entityId} />
        ) : (
          <AgentPage agentId={agentId} tab={tab} itemId={itemId} />
        )}
      </div>
    </div>
  );
}
