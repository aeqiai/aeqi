import { useMemo } from "react";
import { Lightbulb, Plus } from "lucide-react";
import { Button, Icon, Loading, PrimitivePageHeader, Tooltip } from "../ui";
import IdeaGraph, { type GraphNode, type GraphEdge } from "../IdeaGraph";
import IdeasToolbar from "./IdeasToolbar";
import { type IdeasView } from "./IdeasViewPopover";
import { type FilterState } from "./types";
import type { IdeasFilter } from "./types";

export interface IdeasGraphViewProps {
  agentId: string;
  graphData: { nodes: GraphNode[]; edges: GraphEdge[] };
  filteredGraph: { nodes: GraphNode[]; edges: GraphEdge[] };
  graphLoading: boolean;
  filter: FilterState;
  scopeCounts: Record<IdeasFilter, number>;
  selectedId: string | null;
  view: IdeasView;
  onViewChange: (next: IdeasView) => void;
  onNew: () => void;
  onSelect: (node: GraphNode | null) => void;
  onFilterChange: (patch: Partial<FilterState>) => void;
}

export default function IdeasGraphView({
  graphData,
  filteredGraph,
  graphLoading,
  filter,
  scopeCounts,
  selectedId,
  view,
  onViewChange,
  onNew,
  onSelect,
  onFilterChange,
}: IdeasGraphViewProps) {
  const hasFilter =
    filter.scope !== "all" ||
    filter.tags.length > 0 ||
    filter.search.trim() !== "" ||
    filter.needsReview;
  const nodeCount = filteredGraph.nodes.length;
  const edgeCount = filteredGraph.edges.length;
  const countLabel = graphLoading
    ? "…"
    : `${nodeCount}${hasFilter && nodeCount !== graphData.nodes.length ? `/${graphData.nodes.length}` : ""} · ${edgeCount} links`;
  const needsReviewCount = useMemo(
    () =>
      graphData.nodes.filter((n) => {
        const t = n.tags ?? [];
        return (
          t.includes("skill") &&
          t.includes("candidate") &&
          !t.includes("promoted") &&
          !t.includes("rejected")
        );
      }).length,
    [graphData.nodes],
  );

  return (
    <div className="ideas-graph">
      <PrimitivePageHeader
        title="Ideas"
        children={
          <IdeasToolbar
            inline
            filter={filter}
            scopeCounts={scopeCounts}
            needsReviewCount={needsReviewCount}
            onFilter={onFilterChange}
            view={view}
            onViewChange={onViewChange}
            toolbarMeta={
              <span
                className="ideas-toolbar-meta"
                title={`${nodeCount} nodes · ${edgeCount} links`}
              >
                {countLabel}
              </span>
            }
          />
        }
        actions={
          <Tooltip content="New idea (N)">
            <Button
              variant="primary"
              size="md"
              onClick={onNew}
              leadingIcon={<Icon icon={Plus} size="sm" />}
            >
              New
            </Button>
          </Tooltip>
        }
      />
      <div className="ideas-graph-canvas">
        <div className="ideas-graph-surface">
          {graphLoading ? (
            <div className="ideas-graph-loading">
              <Loading size="sm" />
              <span>Loading graph…</span>
            </div>
          ) : filteredGraph.nodes.length === 0 ? (
            <div className="ideas-graph-empty">
              <Lightbulb
                size={22}
                strokeWidth={1.5}
                className="ideas-graph-empty-icon"
                aria-hidden
              />
              <p className="ideas-graph-empty-title">
                {hasFilter ? "Nothing in scope" : "No ideas to graph"}
              </p>
              <p className="ideas-graph-empty-hint">
                {hasFilter
                  ? "Widen scope or drop the tag to see more nodes."
                  : "Capture decisions, mandates, and memories your agents will reuse."}
              </p>
              <div className="ideas-graph-empty-action">
                {hasFilter ? (
                  <Button
                    variant="ghost"
                    onClick={() => onFilterChange({ scope: "all", tags: [], search: "" })}
                  >
                    Reset filters
                  </Button>
                ) : (
                  <Button variant="primary" onClick={onNew}>
                    New idea
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <IdeaGraph
              nodes={filteredGraph.nodes}
              edges={filteredGraph.edges}
              onSelect={onSelect}
              selectedId={selectedId}
            />
          )}
        </div>
      </div>
    </div>
  );
}
