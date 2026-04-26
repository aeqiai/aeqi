import { useMemo } from "react";
import { Button, EmptyState, Spinner } from "../ui";
import IdeaGraph, { type GraphNode, type GraphEdge } from "../IdeaGraph";
import { IdeasPrimitiveHead } from "./IdeasPrimitiveHead";
import IdeasFilterPopover from "./IdeasFilterPopover";
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
  view: "list" | "graph";
  onViewChange: (next: "list" | "graph") => void;
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
    filter.tag !== null ||
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
      <IdeasPrimitiveHead
        countLabel={countLabel}
        view={view}
        onViewChange={onViewChange}
        onNew={onNew}
      />
      <div className="ideas-graph-toolbar">
        <IdeasFilterPopover
          filter={filter}
          scopeCounts={scopeCounts}
          needsReviewCount={needsReviewCount}
          onChange={onFilterChange}
        />
      </div>
      <div className="ideas-graph-canvas">
        {graphLoading ? (
          <div className="ideas-graph-loading">
            <Spinner size="sm" />
            <span>Loading graph…</span>
          </div>
        ) : filteredGraph.nodes.length === 0 ? (
          <EmptyState
            title={hasFilter ? "Nothing in scope" : "No ideas to graph"}
            description={
              hasFilter
                ? "Widen scope or drop the tag to see more nodes."
                : "Create ideas to see them connected here."
            }
            action={
              hasFilter ? (
                <Button
                  variant="ghost"
                  onClick={() => onFilterChange({ scope: "all", tag: null, search: "" })}
                >
                  Reset filters
                </Button>
              ) : (
                <Button variant="primary" onClick={onNew}>
                  New idea
                </Button>
              )
            }
          />
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
  );
}
