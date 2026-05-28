import { useMemo } from "react";
import { Lightbulb, Plus } from "lucide-react";
import { Button, Icon, Loading, PrimitivePageHeader, Tooltip } from "../ui";
import IdeaGraph, { formatRelationLabel, type GraphNode, type GraphEdge } from "../IdeaGraph";
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

function relationClassName(relation: string): string {
  return relation.toLowerCase().replace(/[^a-z0-9]+/g, "-");
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
  const graphSummary = useMemo(() => {
    const degree = new Map<string, number>();
    const relationCounts = new Map<string, number>();
    for (const node of filteredGraph.nodes) degree.set(node.id, 0);
    for (const edge of filteredGraph.edges) {
      degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1);
      degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1);
      relationCounts.set(edge.relation, (relationCounts.get(edge.relation) ?? 0) + 1);
    }
    return {
      isolated: filteredGraph.nodes.filter((node) => (degree.get(node.id) ?? 0) === 0).length,
      relationCounts: Array.from(relationCounts.entries())
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 4),
    };
  }, [filteredGraph.edges, filteredGraph.nodes]);
  const selectedContext = useMemo(() => {
    if (!selectedId) return null;
    const nodesById = new Map(filteredGraph.nodes.map((node) => [node.id, node]));
    const selected = nodesById.get(selectedId);
    if (!selected) return null;
    const connections = filteredGraph.edges
      .flatMap((edge) => {
        if (edge.source !== selectedId && edge.target !== selectedId) return [];
        const targetId = edge.source === selectedId ? edge.target : edge.source;
        const target = nodesById.get(targetId);
        if (!target) return [];
        return [
          {
            edge,
            target,
            direction: edge.source === selectedId ? "out" : "in",
          },
        ];
      })
      .sort(
        (a, b) => b.edge.strength - a.edge.strength || a.target.name.localeCompare(b.target.name),
      )
      .slice(0, 8);
    return { selected, connections };
  }, [filteredGraph.edges, filteredGraph.nodes, selectedId]);
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
            <>
              <IdeaGraph
                nodes={filteredGraph.nodes}
                edges={filteredGraph.edges}
                onSelect={onSelect}
                selectedId={selectedId}
              />
              <div className="ideas-graph-readout" aria-label="Graph connectivity">
                <span>
                  <strong>{nodeCount}</strong>
                  <small>ideas</small>
                </span>
                <span>
                  <strong>{edgeCount}</strong>
                  <small>links</small>
                </span>
                <span className={graphSummary.isolated > 0 ? "is-warning" : undefined}>
                  <strong>{graphSummary.isolated}</strong>
                  <small>isolated</small>
                </span>
                {graphSummary.relationCounts.map(([relation, count]) => (
                  <span
                    key={relation}
                    className={`ideas-graph-relation ideas-graph-relation--${relationClassName(relation)}`}
                  >
                    <i aria-hidden />
                    <strong>{count}</strong>
                    <small>{formatRelationLabel(relation)}</small>
                  </span>
                ))}
              </div>
              {selectedContext && (
                <div className="ideas-graph-context" aria-label="Selected idea connections">
                  <div className="ideas-graph-context-head">
                    <span>{selectedContext.selected.name}</span>
                    <small>{selectedContext.connections.length} links</small>
                  </div>
                  {selectedContext.connections.length > 0 ? (
                    <div className="ideas-graph-context-list">
                      {selectedContext.connections.map(({ edge, target, direction }) => (
                        <button
                          key={`${edge.source}:${edge.target}:${edge.relation}`}
                          type="button"
                          className="ideas-graph-context-row"
                          onClick={() => onSelect(target)}
                        >
                          <span
                            className={`ideas-graph-relation-swatch ideas-graph-relation-swatch--${relationClassName(edge.relation)}`}
                            aria-hidden
                          />
                          <span className="ideas-graph-context-relation">
                            {formatRelationLabel(edge.relation)}
                          </span>
                          <span className="ideas-graph-context-target">{target.name}</span>
                          <small>{direction}</small>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="ideas-graph-context-empty">No links in this filter.</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
