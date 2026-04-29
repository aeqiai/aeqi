import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentIdeas } from "@/queries/ideas";
import type { Idea } from "@/lib/types";
import type { GraphNode, GraphEdge } from "./IdeaGraph";
import IdeasListView from "./ideas/IdeasListView";
import IdeasGraphView from "./ideas/IdeasGraphView";
import IdeasCanvasView from "./ideas/IdeasCanvasView";
import {
  type FilterState,
  type IdeasFilter,
  IDEA_FILTER_VALUES,
  IDEA_SCOPE_VALUES,
  parseScope,
  parseSort,
  parseTags,
  serializeTags,
} from "./ideas/types";

const NO_IDEAS: Idea[] = [];

/**
 * Ideas tab. Routes to:
 *   - graph view (?view=graph)
 *   - compose canvas (?compose=1 — triggered by New idea)
 *   - detail canvas (`:itemId` selected)
 *   - dense inline picker grouped by tag (default — no itemId, no compose)
 *
 * Filter state (scope / q / tag) lives in URL search params so switching
 * between list and graph keeps the frame; the graph view applies the same
 * filters to its nodes so the two views stay coherent.
 */
export default function AgentIdeasTab({ agentId }: { agentId: string }) {
  const { goEntity, entityId } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;
  const [searchParams, setSearchParams] = useSearchParams();
  const view: "list" | "graph" = searchParams.get("view") === "graph" ? "graph" : "list";
  const composing = searchParams.get("compose") === "1";

  const filter: FilterState = {
    scope: parseScope(searchParams.get("scope")),
    search: searchParams.get("q") ?? "",
    tags: parseTags(searchParams.get("tags") ?? searchParams.get("tag")),
    sort: parseSort(searchParams.get("sort")),
    needsReview: searchParams.get("review") === "1",
  };

  const patchParams = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams);
      mut(params);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setView = useCallback(
    (next: "list" | "graph") => {
      patchParams((p) => {
        if (next === "graph") p.set("view", "graph");
        else p.delete("view");
      });
    },
    [patchParams],
  );

  const setFilter = useCallback(
    (patch: Partial<FilterState>) => {
      patchParams((p) => {
        if ("scope" in patch) {
          if (patch.scope && patch.scope !== "all") p.set("scope", patch.scope);
          else p.delete("scope");
        }
        if ("search" in patch) {
          if (patch.search) p.set("q", patch.search);
          else p.delete("q");
        }
        if ("tags" in patch) {
          // Drop the legacy single-tag param so the URL stays clean
          // when migrating between visits or when the user clears the
          // last tag back to the empty state.
          p.delete("tag");
          if (patch.tags && patch.tags.length > 0) p.set("tags", serializeTags(patch.tags));
          else p.delete("tags");
        }
        if ("sort" in patch) {
          if (patch.sort && patch.sort !== "tag") p.set("sort", patch.sort);
          else p.delete("sort");
        }
        if ("needsReview" in patch) {
          if (patch.needsReview) p.set("review", "1");
          else p.delete("review");
        }
      });
    },
    [patchParams],
  );

  const { data: ideas = NO_IDEAS } = useAgentIdeas(agentId);

  // Apply scope + search + tag to the agent's ideas. The graph view
  // filters its own nodes against this same universe so the two views
  // answer the same question through different lenses.
  const scoped = useMemo(() => {
    const q = filter.search.trim().toLowerCase();
    return ideas.filter((idea) => {
      // scope filtering
      const sc = filter.scope;
      if (sc !== "all") {
        if (sc === "inherited") {
          // cross-cut: visible but anchored on another agent
          if (idea.agent_id == null || idea.agent_id === agentId) return false;
        } else {
          // match idea.scope if present, else fallback heuristics
          if (idea.scope != null) {
            if (idea.scope !== sc) return false;
          } else if (sc === "self" && idea.agent_id !== agentId) {
            return false;
          } else if (sc === "global" && idea.agent_id != null) {
            return false;
          } else if (sc !== "self" && sc !== "global") {
            // siblings/children/branch — no scope field, can't match
            return false;
          }
        }
      }
      if (filter.needsReview) {
        const t = idea.tags ?? [];
        const isCandidate =
          t.includes("skill") &&
          t.includes("candidate") &&
          !t.includes("promoted") &&
          !t.includes("rejected");
        if (!isCandidate) return false;
      }
      if (q) {
        const inName = idea.name.toLowerCase().includes(q);
        const inContent = idea.content.toLowerCase().includes(q);
        if (!inName && !inContent) return false;
      }
      return true;
    });
  }, [ideas, filter.search, filter.scope, filter.needsReview, agentId]);

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const idea of scoped) {
      for (const t of idea.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [scoped]);

  // Multi-tag filtering — OR semantics. Picking #skill and #candidate shows
  // ideas tagged with EITHER, so adding a tag broadens the visible set.
  // (AND would tighten it; users typically expect "I selected more, I see
  // more" for additive chip selection.)
  const filtered = useMemo(() => {
    if (filter.tags.length === 0) return scoped;
    const wanted = new Set(filter.tags);
    return scoped.filter((idea) => (idea.tags || []).some((t) => wanted.has(t)));
  }, [scoped, filter.tags]);

  const scopeCounts = useMemo(() => {
    const counts = Object.fromEntries(IDEA_FILTER_VALUES.map((f) => [f, 0])) as Record<
      IdeasFilter,
      number
    >;
    for (const idea of ideas) {
      counts.all += 1;
      // inherited cross-cut
      if (idea.agent_id != null && idea.agent_id !== agentId) counts.inherited += 1;
      // scope-based
      if (idea.scope != null && IDEA_SCOPE_VALUES.includes(idea.scope)) {
        counts[idea.scope] += 1;
      } else if (idea.agent_id === agentId) {
        counts.self += 1;
      } else if (idea.agent_id == null) {
        counts.global += 1;
      }
    }
    return counts;
  }, [ideas, agentId]);

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

  // Cross-view filter projection — the list already honors scope + tag +
  // search against the full `ideas` store; the graph view receives the
  // same predicate as an id-set, then prunes its nodes and edges so the
  // dots on screen match the rows the user just filtered.
  const filteredGraph = useMemo(() => {
    if (filter.scope === "all" && filter.tags.length === 0 && !filter.search.trim())
      return graphData;
    const allowed = new Set(filtered.map((i) => i.id));
    const nodes = graphData.nodes.filter((n) => allowed.has(n.id));
    const allowedNodeIds = new Set(nodes.map((n) => n.id));
    const edges = graphData.edges.filter(
      (e) => allowedNodeIds.has(e.source) && allowedNodeIds.has(e.target),
    );
    return { nodes, edges };
  }, [graphData, filtered, filter.scope, filter.tags, filter.search]);

  // Graph → detail: push a new history entry so browser-back returns to
  // the graph view. Using `replace: true` here stranded the user on the
  // list view after drilling into a node — hitting back wiped the graph
  // mode entirely.
  const handleGraphSelect = (node: GraphNode | null) => {
    if (!node) return;
    goEntity(entityId, "ideas", node.id);
  };

  // "+ New idea" — compose mode is an explicit search param so the default
  // no-itemId state stays on the inline picker. Optional `name` survives
  // the navigate so a create-from-query click lands on a pre-filled canvas.
  useEffect(() => {
    const handler = (e: Event) => {
      const name = (e as CustomEvent<{ name?: string }>).detail?.name;
      goEntity(entityId, "ideas", undefined, { replace: true });
      requestAnimationFrame(() => {
        const next = new URLSearchParams(window.location.search);
        next.set("compose", "1");
        if (name) next.set("name", name);
        else next.delete("name");
        setSearchParams(next, { replace: true });
      });
    };
    window.addEventListener("aeqi:new-idea", handler);
    return () => window.removeEventListener("aeqi:new-idea", handler);
  }, [entityId, goEntity, setSearchParams]);

  const fireNewIdea = (name?: string) =>
    window.dispatchEvent(new CustomEvent("aeqi:new-idea", { detail: name ? { name } : {} }));

  // Graph-mode keyboard: `n` / `l` while the canvas is focused so the user
  // never has to grab the mouse to flip back. Gated so it never fires
  // from inside any editable surface.
  useEffect(() => {
    if (view !== "graph") return;
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      const inInput =
        tgt?.tagName === "INPUT" || tgt?.tagName === "TEXTAREA" || tgt?.isContentEditable;
      if (inInput) return;
      if (e.key === "n") {
        e.preventDefault();
        e.stopImmediatePropagation();
        fireNewIdea();
      } else if (e.key === "l") {
        e.preventDefault();
        e.stopImmediatePropagation();
        setView("list");
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [view, setView]);

  if (view === "graph") {
    return (
      <IdeasGraphView
        agentId={agentId}
        graphData={graphData}
        filteredGraph={filteredGraph}
        graphLoading={graphLoading}
        filter={filter}
        scopeCounts={scopeCounts}
        selectedId={selectedId}
        view={view}
        onViewChange={setView}
        onNew={() => fireNewIdea()}
        onSelect={handleGraphSelect}
        onFilterChange={setFilter}
      />
    );
  }

  const selected = selectedId ? ideas.find((i) => i.id === selectedId) : undefined;

  if (selected || composing) {
    const presetName = composing ? (searchParams.get("name") ?? "") : "";
    return (
      <IdeasCanvasView
        agentId={agentId}
        idea={selected}
        presetName={presetName}
        onBack={() => goEntity(entityId, "ideas")}
        onNew={() => fireNewIdea()}
      />
    );
  }

  return (
    <IdeasListView
      agentId={agentId}
      ideas={ideas}
      scoped={scoped}
      filtered={filtered}
      tagCounts={tagCounts}
      scopeCounts={scopeCounts}
      filter={filter}
      onFilter={setFilter}
      view={view}
      onViewChange={setView}
    />
  );
}
