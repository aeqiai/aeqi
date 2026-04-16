import { useEffect, useRef, useState } from "react";
import { DataState } from "@/components/ui";
import IdeaGraph, { type GraphNode, type GraphEdge } from "@/components/IdeaGraph";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useChatStore } from "@/store/chat";
import type { Idea } from "@/lib/types";

const TAG_COLORS: Record<string, string> = {
  fact: "var(--info)",
  procedure: "#8b5cf6",
  preference: "var(--warning)",
  context: "var(--text-muted)",
  evergreen: "var(--success)",
  decision: "var(--accent)",
  insight: "var(--success)",
};

const TAG_FILTERS = ["all", "fact", "procedure", "preference", "context", "evergreen"] as const;

type ViewMode = "list" | "graph";

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

function ideaTags(idea: Pick<Idea, "tags">): string[] {
  return Array.isArray(idea.tags) ? idea.tags.filter(Boolean) : [];
}

function primaryTag(idea: Pick<Idea, "tags">): string {
  return ideaTags(idea)[0] || "untagged";
}

export default function IdeasPage() {
  const selectedAgent = useChatStore((s) => s.selectedAgent);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("list");
  const [activeTag, setActiveTag] = useState<string>("all");
  const [selected, setSelected] = useState<Idea | null>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [graphLoading, setGraphLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Debounce search.
  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  // Fetch list data.
  useEffect(() => {
    setLoading(true);
    api
      .getIdeas({
        query: debouncedSearch || undefined,
        root: selectedAgent?.name || undefined,
        limit: 200,
      })
      .then((d) => {
        const normalized = ((d.ideas || []) as Idea[]).map((idea) => ({
          ...idea,
          tags: ideaTags(idea),
        }));
        setIdeas(normalized);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [debouncedSearch, selectedAgent]);

  // Fetch graph data when switching to graph view.
  useEffect(() => {
    if (view !== "graph") return;
    setGraphLoading(true);
    api
      .getIdeaGraph({
        root: selectedAgent?.name || undefined,
        limit: 100,
      })
      .then((d) => {
        setGraphData({
          nodes: ((d.nodes || []) as GraphNode[]).map((node) => ({
            ...node,
            tags: Array.isArray(node.tags) ? node.tags.filter(Boolean) : [],
          })),
          edges: (d.edges || []) as GraphEdge[],
        });
        setGraphLoading(false);
      })
      .catch(() => setGraphLoading(false));
  }, [view, selectedAgent]);

  const filtered =
    activeTag === "all" ? ideas : ideas.filter((idea) => ideaTags(idea).includes(activeTag));

  // Stats.
  const tagCounts = ideas.reduce<Record<string, number>>((acc, idea) => {
    for (const tag of ideaTags(idea)) {
      acc[tag] = (acc[tag] || 0) + 1;
    }
    return acc;
  }, {});

  // Find selected detail from list or graph node.
  const handleGraphSelect = (node: any | null) => {
    if (!node) {
      setSelected(null);
      return;
    }
    // Find full entry in ideas list, or build from graph node.
    const entry = ideas.find((m) => m.id === node.id) || {
      id: node.id,
      name: node.name,
      content: node.content,
      tags: Array.isArray(node.tags) ? node.tags.filter(Boolean) : [],
      created_at: "",
    };
    setSelected(entry);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteKnowledge({ root: selectedAgent?.name || "", id });
      setIdeas((prev) => prev.filter((m) => m.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch {
      // Silently fail.
    }
  };

  // Find edges for selected node.
  const selectedEdges = selected
    ? graphData.edges.filter((e) => e.source === selected.id || e.target === selected.id)
    : [];

  // Resolve edge targets to keys.
  const nodeMap = new Map(graphData.nodes.map((n) => [n.id, n]));

  return (
    <div className="page-content ideas-page">
      {/* View toggle — hero removed, title in ContentTopBar */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 0",
        }}
      >
        <span style={{ fontSize: 12, color: "rgba(0,0,0,0.35)" }}>
          {ideas.length} ideas
          {selectedAgent ? ` · ${selectedAgent.display_name || selectedAgent.name}` : ""}
        </span>
        <div className="ideas-view-toggle">
          <button
            className={`view-btn ${view === "list" ? "active" : ""}`}
            onClick={() => setView("list")}
          >
            List
          </button>
          <button
            className={`view-btn ${view === "graph" ? "active" : ""}`}
            onClick={() => setView("graph")}
          >
            Graph
          </button>
        </div>
      </div>

      {/* Tag chips */}
      <div className="ideas-categories">
        {TAG_FILTERS.map((tag) => (
          <button
            key={tag}
            className={`tag-chip ${activeTag === tag ? "active" : ""}`}
            style={
              tag !== "all" && activeTag === tag
                ? { borderColor: TAG_COLORS[tag], color: TAG_COLORS[tag] }
                : undefined
            }
            onClick={() => setActiveTag(tag)}
          >
            {tag}
            {tag !== "all" && tagCounts[tag] ? (
              <span className="tag-chip-count">{tagCounts[tag]}</span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Search */}
      {view === "list" && (
        <div className="filters">
          <input
            className="filter-input"
            style={{ flex: 1 }}
            placeholder="Search ideas (FTS5)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="filter-count">{filtered.length} results</span>
        </div>
      )}

      {/* Content area with optional detail panel */}
      <div className={`ideas-body ${selected ? "with-detail" : ""}`}>
        {/* Main content */}
        <div className="ideas-main">
          {view === "list" ? (
            <DataState
              loading={loading}
              empty={filtered.length === 0}
              emptyTitle="No ideas"
              emptyDescription="Ideas are knowledge and identity stored by agents across sessions."
              loadingText="Searching..."
            >
              <div className="idea-list">
                {filtered.map((m) => (
                  <div
                    key={m.id}
                    className={`idea-entry ${selected?.id === m.id ? "selected" : ""}`}
                    style={{
                      borderLeft: `3px solid ${TAG_COLORS[primaryTag(m)] || "var(--text-muted)"}`,
                    }}
                    onClick={() => setSelected(selected?.id === m.id ? null : m)}
                  >
                    <div className="idea-header">
                      <code className="idea-key">{m.name}</code>
                      <div className="idea-tags">
                        {ideaTags(m).map((tag) => (
                          <span
                            key={tag}
                            className="idea-tag"
                            style={{
                              color: TAG_COLORS[tag] || "var(--text-muted)",
                            }}
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="idea-content">
                      {m.content.length > 200 ? m.content.slice(0, 200) + "..." : m.content}
                    </div>
                    <div className="idea-meta">
                      {m.agent_id && <span>Agent: {m.agent_id}</span>}
                      <span>{timeAgo(m.created_at)}</span>
                      {m.score != null && m.score < 1 && <span>Score: {m.score.toFixed(2)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </DataState>
          ) : (
            <DataState
              loading={graphLoading}
              empty={graphData.nodes.length === 0}
              emptyTitle="No graph data"
              emptyDescription="Store some ideas to see the knowledge graph."
              loadingText="Loading graph..."
            >
              <div className="idea-graph-container">
                <IdeaGraph
                  nodes={graphData.nodes}
                  edges={graphData.edges}
                  selectedId={selected?.id}
                  onSelect={handleGraphSelect}
                />
                <div className="graph-legend">
                  {Object.entries(TAG_COLORS)
                    .filter(([k]) => tagCounts[k])
                    .map(([tag, color]) => (
                      <span key={tag} className="legend-item">
                        <span className="legend-dot" style={{ background: color }} />
                        {tag}
                      </span>
                    ))}
                </div>
              </div>
            </DataState>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="ideas-detail">
            <div className="detail-header">
              <code className="detail-key">{selected.name}</code>
              <button className="detail-close" onClick={() => setSelected(null)}>
                ×
              </button>
            </div>

            <span
              className="idea-tag"
              style={{
                color: TAG_COLORS[primaryTag(selected)] || "var(--text-muted)",
              }}
            >
              {ideaTags(selected).join(" · ")}
            </span>

            <div className="detail-content">{selected.content}</div>

            {/* Relations / Backlinks */}
            {selectedEdges.length > 0 && (
              <div className="detail-section">
                <h4 className="detail-section-title">Relations</h4>
                {selectedEdges.map((e: any, i: number) => {
                  const isSource = e.source === selected.id;
                  const otherId = isSource ? e.target : e.source;
                  const otherNode = nodeMap.get(otherId);
                  return (
                    <div
                      key={i}
                      className="detail-edge"
                      onClick={() => {
                        if (otherNode) handleGraphSelect(otherNode);
                      }}
                    >
                      <span className="edge-direction">{isSource ? "→" : "←"}</span>
                      <code className="edge-target">{otherNode?.name || otherId.slice(0, 8)}</code>
                      <span className="edge-relation">{e.relation}</span>
                      <span className="edge-strength">{(e.strength * 100).toFixed(0)}%</span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="detail-meta">
              {selected.agent_id && (
                <div>
                  <span className="meta-label">Agent</span>
                  <span>{selected.agent_id}</span>
                </div>
              )}
              {selected.created_at && (
                <div>
                  <span className="meta-label">Created</span>
                  <span>
                    {new Date(selected.created_at).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              )}
              <div>
                <span className="meta-label">ID</span>
                <span className="meta-id">{selected.id.slice(0, 12)}...</span>
              </div>
            </div>

            <button className="detail-delete" onClick={() => handleDelete(selected.id)}>
              Delete idea
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
