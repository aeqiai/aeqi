import { useEffect, useRef, useState } from "react";
import { DataState } from "@/components/ui";
import IdeaGraph, { type GraphNode, type GraphEdge } from "@/components/IdeaGraph";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { useChatStore } from "@/store/chat";

const CATEGORY_COLORS: Record<string, string> = {
  fact: "var(--info)",
  procedure: "#8b5cf6",
  preference: "var(--warning)",
  context: "var(--text-muted)",
  evergreen: "var(--success)",
  decision: "var(--accent)",
  insight: "var(--success)",
};

const CATEGORIES = ["all", "fact", "procedure", "preference", "context", "evergreen"] as const;

type ViewMode = "list" | "graph";

interface IdeaEntry {
  id: string;
  key: string;
  content: string;
  category: string;
  scope?: string;
  agent_id?: string;
  created_at: string;
  score?: number;
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export default function IdeasPage() {
  const selectedAgent = useChatStore((s) => s.selectedAgent);
  const [ideas, setIdeas] = useState<IdeaEntry[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("list");
  const [category, setCategory] = useState<string>("all");
  const [selected, setSelected] = useState<IdeaEntry | null>(null);
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
        company: selectedAgent?.name || undefined,
        limit: 200,
      })
      .then((d) => {
        setIdeas((d.ideas || []) as IdeaEntry[]);
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
        company: selectedAgent?.name || undefined,
        limit: 100,
      })
      .then((d) => {
        setGraphData({ nodes: (d.nodes || []) as GraphNode[], edges: (d.edges || []) as GraphEdge[] });
        setGraphLoading(false);
      })
      .catch(() => setGraphLoading(false));
  }, [view, selectedAgent]);

  // Filter by category.
  const filtered =
    category === "all"
      ? ideas
      : ideas.filter((m) => m.category === category);

  // Stats.
  const catCounts = ideas.reduce<Record<string, number>>((acc, m) => {
    acc[m.category] = (acc[m.category] || 0) + 1;
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
      key: node.key,
      content: node.content,
      category: node.category,
      created_at: "",
    };
    setSelected(entry);
  };

  const handleDelete = async (id: string) => {
    try {
      await api.deleteKnowledge({ company: selectedAgent?.name || "", id });
      setIdeas((prev) => prev.filter((m) => m.id !== id));
      if (selected?.id === id) setSelected(null);
    } catch {
      // Silently fail.
    }
  };

  // Find edges for selected node.
  const selectedEdges = selected
    ? graphData.edges.filter(
        (e) => e.source === selected.id || e.target === selected.id,
      )
    : [];

  // Resolve edge targets to keys.
  const nodeMap = new Map(graphData.nodes.map((n) => [n.id, n]));

  return (
    <div className="page-content ideas-page">
      {/* View toggle — hero removed, title in ContentTopBar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0" }}>
        <span style={{ fontSize: 12, color: "rgba(0,0,0,0.35)" }}>
          {ideas.length} ideas{selectedAgent ? ` · ${selectedAgent.display_name || selectedAgent.name}` : ""}
        </span>
        <div className="ideas-view-toggle">
          <button className={`view-btn ${view === "list" ? "active" : ""}`} onClick={() => setView("list")}>List</button>
          <button className={`view-btn ${view === "graph" ? "active" : ""}`} onClick={() => setView("graph")}>Graph</button>
        </div>
      </div>

      {/* Category chips */}
      <div className="ideas-categories">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`cat-chip ${category === cat ? "active" : ""}`}
            style={
              cat !== "all" && category === cat
                ? { borderColor: CATEGORY_COLORS[cat], color: CATEGORY_COLORS[cat] }
                : undefined
            }
            onClick={() => setCategory(cat)}
          >
            {cat}
            {cat !== "all" && catCounts[cat] ? (
              <span className="cat-chip-count">{catCounts[cat]}</span>
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
                      borderLeft: `3px solid ${CATEGORY_COLORS[m.category] || "var(--text-muted)"}`,
                    }}
                    onClick={() => setSelected(selected?.id === m.id ? null : m)}
                  >
                    <div className="idea-header">
                      <code className="idea-key">{m.key}</code>
                      <div className="idea-tags">
                        <span
                          className="idea-category"
                          style={{
                            color:
                              CATEGORY_COLORS[m.category] || "var(--text-muted)",
                          }}
                        >
                          {m.category}
                        </span>
                      </div>
                    </div>
                    <div className="idea-content">
                      {m.content.length > 200
                        ? m.content.slice(0, 200) + "..."
                        : m.content}
                    </div>
                    <div className="idea-meta">
                      {m.agent_id && <span>Agent: {m.agent_id}</span>}
                      <span>{timeAgo(m.created_at)}</span>
                      {m.score != null && m.score < 1 && (
                        <span>Score: {m.score.toFixed(2)}</span>
                      )}
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
                  {Object.entries(CATEGORY_COLORS)
                    .filter(([k]) => catCounts[k])
                    .map(([cat, color]) => (
                      <span key={cat} className="legend-item">
                        <span
                          className="legend-dot"
                          style={{ background: color }}
                        />
                        {cat}
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
              <code className="detail-key">{selected.key}</code>
              <button
                className="detail-close"
                onClick={() => setSelected(null)}
              >
                ×
              </button>
            </div>

            <span
              className="idea-category"
              style={{
                color:
                  CATEGORY_COLORS[selected.category] || "var(--text-muted)",
              }}
            >
              {selected.category}
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
                      <span className="edge-direction">
                        {isSource ? "→" : "←"}
                      </span>
                      <code className="edge-target">
                        {otherNode?.key || otherId.slice(0, 8)}
                      </code>
                      <span className="edge-relation">{e.relation}</span>
                      <span className="edge-strength">
                        {(e.strength * 100).toFixed(0)}%
                      </span>
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

            <button
              className="detail-delete"
              onClick={() => handleDelete(selected.id)}
            >
              Delete idea
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
