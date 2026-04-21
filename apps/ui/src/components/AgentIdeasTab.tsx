import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentDataStore } from "@/store/agentData";
import { Button, EmptyState } from "./ui";
import IdeaGraph, { type GraphNode, type GraphEdge } from "./IdeaGraph";
import IdeaCanvas from "./IdeaCanvas";
import type { Idea } from "@/lib/types";

const NO_IDEAS: Idea[] = [];

/**
 * Idea detail pane. The list lives in the global right rail (ContentCTA);
 * this component renders either the graph view (?view=graph) or the
 * Apple-Notes-style `IdeaCanvas` — same always-editable surface handles
 * both compose (no :itemId) and edit (with :itemId).
 */
export default function AgentIdeasTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;
  const [searchParams] = useSearchParams();
  const view: "list" | "graph" = searchParams.get("view") === "graph" ? "graph" : "list";

  const ideas = useAgentDataStore((s) => s.ideasByAgent[agentId] ?? NO_IDEAS);
  const loadIdeas = useAgentDataStore((s) => s.loadIdeas);

  useEffect(() => {
    loadIdeas(agentId);
  }, [agentId, loadIdeas]);

  const [graphData, setGraphData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({
    nodes: [],
    edges: [],
  });
  const [graphLoading, setGraphLoading] = useState(false);

  useEffect(() => {
    if (view !== "graph") return;
    setGraphLoading(true);
    api
      .getIdeaGraph({ agent_id: agentId, limit: 200 })
      .then((d) => {
        setGraphData({
          nodes: ((d.nodes || []) as GraphNode[]).map((n) => ({
            ...n,
            tags: Array.isArray(n.tags) ? n.tags.filter(Boolean) : [],
          })),
          edges: (d.edges || []) as GraphEdge[],
        });
      })
      .catch(() => setGraphData({ nodes: [], edges: [] }))
      .finally(() => setGraphLoading(false));
  }, [view, agentId]);

  const handleGraphSelect = (node: GraphNode | null) => {
    if (!node) return;
    goAgent(agentId, "ideas", node.id, { replace: true });
  };

  // "New idea" rail button → clear the URL so the canvas drops into compose.
  useEffect(() => {
    const handler = () => {
      goAgent(agentId, "ideas", undefined, { replace: true });
    };
    window.addEventListener("aeqi:new-idea", handler);
    return () => window.removeEventListener("aeqi:new-idea", handler);
  }, [agentId, goAgent]);

  if (view === "graph") {
    return (
      <div
        className="asv-main"
        style={{
          padding: "20px 28px",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {graphLoading ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading graph…</div>
        ) : graphData.nodes.length === 0 ? (
          <EmptyState
            title="No ideas to graph"
            description="Create ideas to see them connected here."
            action={
              <Button
                variant="primary"
                onClick={() => goAgent(agentId, "ideas", undefined, { replace: true })}
              >
                New idea
              </Button>
            }
          />
        ) : (
          <div style={{ flex: 1, minHeight: 0 }}>
            <IdeaGraph
              nodes={graphData.nodes}
              edges={graphData.edges}
              onSelect={handleGraphSelect}
              selectedId={selectedId}
            />
          </div>
        )}
      </div>
    );
  }

  const selected = selectedId ? ideas.find((i) => i.id === selectedId) : undefined;

  // Keying on the id resets internal canvas state when switching ideas —
  // cheaper than threading reset logic through refs.
  return <IdeaCanvas key={selected?.id ?? "compose"} agentId={agentId} idea={selected} />;
}
