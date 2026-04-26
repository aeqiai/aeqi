import { useMemo } from "react";
import { Button, EmptyState, Spinner } from "../ui";
import IdeaGraph, { type GraphNode, type GraphEdge } from "../IdeaGraph";
import IdeasFilterPopover from "./IdeasFilterPopover";
import IdeasSortPopover from "./IdeasSortPopover";
import IdeasViewPopover from "./IdeasViewPopover";
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
    filter.tags.length > 0 ||
    filter.search.trim() !== "" ||
    filter.needsReview;
  const searchActive = filter.search.trim() !== "";
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
      <div className="ideas-list-head">
        <div className="ideas-toolbar">
          <span className="ideas-list-search-field">
            <svg
              className="ideas-list-search-glyph"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="5.2" cy="5.2" r="3.2" />
              <path d="M7.6 7.6 L10 10" />
            </svg>
            <input
              className="ideas-list-search"
              type="text"
              placeholder="Search ideas"
              value={filter.search}
              onChange={(e) => onFilterChange({ search: e.target.value })}
            />
            {filter.search && (
              <button
                type="button"
                className="ideas-list-search-clear"
                onClick={() => onFilterChange({ search: "" })}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </span>
          <span className="ideas-toolbar-meta" title={`${nodeCount} nodes · ${edgeCount} links`}>
            {countLabel}
          </span>
          <IdeasSortPopover
            sort={filter.sort}
            disabled={searchActive}
            onChange={(next) => onFilterChange({ sort: next })}
          />
          <IdeasFilterPopover
            filter={filter}
            scopeCounts={scopeCounts}
            needsReviewCount={needsReviewCount}
            onChange={onFilterChange}
          />
          <IdeasViewPopover view={view} onChange={onViewChange} />
          <button type="button" className="ideas-toolbar-new" onClick={onNew} title="New idea (N)">
            <svg
              width="11"
              height="11"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
            new idea
          </button>
        </div>
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
                  onClick={() => onFilterChange({ scope: "all", tags: [], search: "" })}
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
