import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentDataStore } from "@/store/agentData";
import { Button, EmptyState, Spinner } from "./ui";
import IdeaGraph, { type GraphNode, type GraphEdge } from "./IdeaGraph";
import IdeaCanvas from "./IdeaCanvas";
import type { Idea } from "@/lib/types";

const NO_IDEAS: Idea[] = [];

type IdeasScope = "all" | "mine" | "global" | "inherited";

function snippetFor(text: string, query: string, length = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!query) return flat.slice(0, length);
  const words = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const lower = flat.toLowerCase();
  let matchIdx = -1;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i !== -1) {
      matchIdx = i;
      break;
    }
  }
  if (matchIdx === -1) return flat.slice(0, length);
  const half = Math.floor(length / 2);
  const start = Math.max(0, matchIdx - half);
  const end = Math.min(flat.length, start + length);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < flat.length ? "…" : "";
  return prefix + flat.slice(start, end) + suffix;
}

/**
 * Ideas tab. Routes to:
 *   - graph view (?view=graph)
 *   - compose canvas (?compose=1 — triggered by New idea)
 *   - detail canvas (`:itemId` selected)
 *   - dense inline picker grouped by tag (default — no itemId, no compose)
 */
export default function AgentIdeasTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;
  const [searchParams, setSearchParams] = useSearchParams();
  const view: "list" | "graph" = searchParams.get("view") === "graph" ? "graph" : "list";
  const composing = searchParams.get("compose") === "1";

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

  // "+ New idea" — compose mode is an explicit search param so the default
  // no-itemId state stays on the inline picker.
  useEffect(() => {
    const handler = () => {
      goAgent(agentId, "ideas", undefined, { replace: true });
      // Give the navigate a tick, then flip compose on via the search param.
      requestAnimationFrame(() => {
        const next = new URLSearchParams(window.location.search);
        next.set("compose", "1");
        setSearchParams(next, { replace: true });
      });
    };
    window.addEventListener("aeqi:new-idea", handler);
    return () => window.removeEventListener("aeqi:new-idea", handler);
  }, [agentId, goAgent, setSearchParams]);

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
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: 13,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Spinner size="sm" />
            Loading graph…
          </div>
        ) : graphData.nodes.length === 0 ? (
          <EmptyState
            title="No ideas to graph"
            description="Create ideas to see them connected here."
            action={
              <Button
                variant="primary"
                onClick={() => window.dispatchEvent(new CustomEvent("aeqi:new-idea"))}
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

  if (selected || composing) {
    // Keying on the id resets internal canvas state when switching ideas —
    // cheaper than threading reset logic through refs.
    return <IdeaCanvas key={selected?.id ?? "compose"} agentId={agentId} idea={selected} />;
  }

  return <IdeasPicker agentId={agentId} ideas={ideas} />;
}

function IdeasPicker({ agentId, ideas }: { agentId: string; ideas: Idea[] }) {
  const { goAgent } = useNav();
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<IdeasScope>("all");
  const [tag, setTag] = useState<string | null>(null);

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const idea of ideas) {
      for (const t of idea.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [ideas]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ideas.filter((idea) => {
      if (scope === "mine" && idea.agent_id !== agentId) return false;
      if (scope === "global" && idea.agent_id != null) return false;
      if (scope === "inherited" && (idea.agent_id == null || idea.agent_id === agentId))
        return false;
      if (tag && !(idea.tags || []).includes(tag)) return false;
      if (q) {
        const inName = idea.name.toLowerCase().includes(q);
        const inContent = idea.content.toLowerCase().includes(q);
        if (!inName && !inContent) return false;
      }
      return true;
    });
  }, [ideas, search, scope, tag, agentId]);

  // Group filtered ideas by primary tag for Notion-style section headings.
  // Ideas with no tag fall into the "untagged" bucket at the end.
  const grouped = useMemo(() => {
    const byTag = new Map<string, Idea[]>();
    for (const idea of filtered) {
      const primary = idea.tags?.[0] ?? "untagged";
      const list = byTag.get(primary) ?? [];
      list.push(idea);
      byTag.set(primary, list);
    }
    // Stable order: sort by count desc, untagged last.
    const entries = Array.from(byTag.entries()).sort((a, b) => {
      if (a[0] === "untagged") return 1;
      if (b[0] === "untagged") return -1;
      return b[1].length - a[1].length;
    });
    return entries;
  }, [filtered]);

  const isFiltered = search.trim() !== "" || scope !== "all" || tag !== null;
  const fireNew = () => window.dispatchEvent(new CustomEvent("aeqi:new-idea"));

  return (
    <div className="ideas-list">
      <div className="ideas-list-head">
        <div className="ideas-list-search-row">
          <span className="ideas-list-search-field">
            <input
              className="ideas-list-search"
              type="text"
              placeholder="Search ideas…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="ideas-list-search-clear"
                onClick={() => setSearch("")}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </span>
          <div className="ideas-list-scope">
            {(["all", "mine", "global", "inherited"] as IdeasScope[]).map((s) => (
              <button
                key={s}
                type="button"
                className={`ideas-list-scope-btn${scope === s ? " active" : ""}`}
                onClick={() => setScope(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        {tagCounts.length > 0 && (
          <div className="ideas-list-tags">
            {tagCounts.slice(0, 24).map(([t, n]) => (
              <button
                key={t}
                type="button"
                className={`ideas-list-tag${tag === t ? " active" : ""}`}
                onClick={() => setTag(tag === t ? null : t)}
              >
                {t} <span className="ideas-list-tag-count">{n}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="ideas-list-body">
        {filtered.length === 0 ? (
          <button type="button" className="inline-picker-empty-cta" onClick={fireNew}>
            <span className="inline-picker-empty-cta-label">
              {ideas.length === 0 ? "No ideas yet" : "No matches"}
            </span>
            <span className="inline-picker-empty-cta-hint">
              {ideas.length === 0 ? "New idea" : "Adjust filters"}
            </span>
          </button>
        ) : (
          grouped.map(([groupTag, items]) => (
            <section key={groupTag} className="ideas-list-group">
              <div className="inline-picker-group">
                <span className="inline-picker-group-label">{groupTag}</span>
                <span className="inline-picker-group-rule" />
                <span className="inline-picker-group-count">{items.length}</span>
              </div>
              {items.map((idea) => {
                const snippet = snippetFor(idea.content, search);
                const extraTags = (idea.tags?.length ?? 0) - 1;
                return (
                  <button
                    key={idea.id}
                    type="button"
                    className="ideas-list-row"
                    onClick={() => goAgent(agentId, "ideas", idea.id)}
                  >
                    <div className="ideas-list-row-head">
                      <span className="ideas-list-row-name">{idea.name}</span>
                      {idea.agent_id == null && (
                        <span className="ideas-list-row-scope">GLOBAL</span>
                      )}
                      {extraTags > 0 && <span className="ideas-list-row-more">+{extraTags}</span>}
                    </div>
                    {snippet && <div className="ideas-list-row-snippet">{snippet}</div>}
                  </button>
                );
              })}
            </section>
          ))
        )}
        {isFiltered && filtered.length > 0 && (
          <div className="ideas-list-footer">
            {filtered.length} of {ideas.length}
            <button
              type="button"
              className="ideas-list-clear-all"
              onClick={() => {
                setSearch("");
                setScope("all");
                setTag(null);
              }}
            >
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
