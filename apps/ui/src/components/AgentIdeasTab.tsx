import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentDataStore } from "@/store/agentData";
import { Button, EmptyState, Spinner } from "./ui";
import IdeaGraph, { type GraphNode, type GraphEdge } from "./IdeaGraph";
import IdeaCanvas from "./IdeaCanvas";
import type { Idea, ScopeValue } from "@/lib/types";

function ScopeChip({ scope }: { scope: ScopeValue }) {
  if (scope === "self") return null;
  return <span className={`scope-chip scope-chip--${scope}`}>{scope}</span>;
}

const NO_IDEAS: Idea[] = [];

const IDEA_SCOPE_VALUES: ScopeValue[] = ["self", "siblings", "children", "branch", "global"];
type IdeasFilter = "all" | ScopeValue | "inherited";
const IDEA_FILTER_VALUES: IdeasFilter[] = [
  "all",
  "self",
  "siblings",
  "children",
  "branch",
  "global",
  "inherited",
];

type FilterState = {
  scope: IdeasFilter;
  search: string;
  tag: string | null;
};

function queryTerms(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
}

function snippetFor(text: string, query: string, length = 120): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (!query) return flat.slice(0, length);
  const words = queryTerms(query);
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

// Split `text` by every occurrence of any query term, wrapping matches
// in <mark> so the active search token is visible at a glance. Case-
// insensitive; runs over plain (already-flattened) snippet strings.
function highlightMatches(text: string, query: string): ReactNode {
  const terms = queryTerms(query);
  if (!terms.length) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const splitter = new RegExp(`(${escaped.join("|")})`, "gi");
  const termSet = new Set(terms);
  return text.split(splitter).map((part, i) =>
    termSet.has(part.toLowerCase()) ? (
      <mark key={i} className="ideas-list-row-match">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

// Match rank — lower = more relevant. Hoists exact-name matches to the
// top so "Thinking → Enter" always opens the most obvious target, then
// name-prefix, then name-contains, then content-only. When nothing is
// typed every idea is equal and the caller's grouping order takes over.
function matchRank(idea: Idea, query: string): number {
  if (!query) return 3;
  const q = query.trim().toLowerCase();
  if (!q) return 3;
  const name = idea.name.toLowerCase();
  if (name === q) return 0;
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  if (idea.content.toLowerCase().includes(q)) return 3;
  return 4;
}

function parseScope(raw: string | null): IdeasFilter {
  return IDEA_FILTER_VALUES.includes(raw as IdeasFilter) ? (raw as IdeasFilter) : "all";
}

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
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;
  const [searchParams, setSearchParams] = useSearchParams();
  const view: "list" | "graph" = searchParams.get("view") === "graph" ? "graph" : "list";
  const composing = searchParams.get("compose") === "1";

  const filter: FilterState = {
    scope: parseScope(searchParams.get("scope")),
    search: searchParams.get("q") ?? "",
    tag: searchParams.get("tag"),
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
        if ("tag" in patch) {
          if (patch.tag) p.set("tag", patch.tag);
          else p.delete("tag");
        }
      });
    },
    [patchParams],
  );

  const ideas = useAgentDataStore((s) => s.ideasByAgent[agentId] ?? NO_IDEAS);
  const loadIdeas = useAgentDataStore((s) => s.loadIdeas);

  useEffect(() => {
    loadIdeas(agentId);
  }, [agentId, loadIdeas]);

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
      if (q) {
        const inName = idea.name.toLowerCase().includes(q);
        const inContent = idea.content.toLowerCase().includes(q);
        if (!inName && !inContent) return false;
      }
      return true;
    });
  }, [ideas, filter.search, filter.scope, agentId]);

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const idea of scoped) {
      for (const t of idea.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [scoped]);

  const filtered = useMemo(() => {
    if (!filter.tag) return scoped;
    return scoped.filter((idea) => (idea.tags || []).includes(filter.tag!));
  }, [scoped, filter.tag]);

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
    if (filter.scope === "all" && !filter.tag && !filter.search.trim()) return graphData;
    const allowed = new Set(filtered.map((i) => i.id));
    const nodes = graphData.nodes.filter((n) => allowed.has(n.id));
    const allowedNodeIds = new Set(nodes.map((n) => n.id));
    const edges = graphData.edges.filter(
      (e) => allowedNodeIds.has(e.source) && allowedNodeIds.has(e.target),
    );
    return { nodes, edges };
  }, [graphData, filtered, filter.scope, filter.tag, filter.search]);

  // Graph → detail: push a new history entry so browser-back returns to
  // the graph view. Using `replace: true` here stranded the user on the
  // list view after drilling into a node — hitting back wiped the graph
  // mode entirely.
  const handleGraphSelect = (node: GraphNode | null) => {
    if (!node) return;
    goAgent(agentId, "ideas", node.id);
  };

  // "+ New idea" — compose mode is an explicit search param so the default
  // no-itemId state stays on the inline picker. Optional `name` survives
  // the navigate so a create-from-query click lands on a pre-filled canvas.
  useEffect(() => {
    const handler = (e: Event) => {
      const name = (e as CustomEvent<{ name?: string }>).detail?.name;
      goAgent(agentId, "ideas", undefined, { replace: true });
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
  }, [agentId, goAgent, setSearchParams]);

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
    const hasFilter = filter.scope !== "all" || filter.tag !== null || filter.search.trim() !== "";
    const nodeCount = filteredGraph.nodes.length;
    const edgeCount = filteredGraph.edges.length;
    const countLabel = graphLoading
      ? "…"
      : `${nodeCount}${hasFilter && nodeCount !== graphData.nodes.length ? `/${graphData.nodes.length}` : ""} · ${edgeCount} links`;
    return (
      <div className="ideas-graph">
        <IdeasPrimitiveHead
          countLabel={countLabel}
          view="graph"
          onViewChange={setView}
          onNew={() => fireNewIdea()}
          scopeControl={
            <IdeasScopeTabs
              scope={filter.scope}
              scopes={IDEA_FILTER_VALUES}
              counts={scopeCounts}
              onChange={(next) => setFilter({ scope: next })}
            />
          }
        />
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
                    onClick={() => setFilter({ scope: "all", tag: null, search: "" })}
                  >
                    Reset filters
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => fireNewIdea()}>
                    New idea
                  </Button>
                )
              }
            />
          ) : (
            <IdeaGraph
              nodes={filteredGraph.nodes}
              edges={filteredGraph.edges}
              onSelect={handleGraphSelect}
              selectedId={selectedId}
            />
          )}
        </div>
      </div>
    );
  }

  const selected = selectedId ? ideas.find((i) => i.id === selectedId) : undefined;

  if (selected || composing) {
    const presetName = composing ? (searchParams.get("name") ?? "") : "";
    // Keying on the id resets internal canvas state when switching ideas —
    // cheaper than threading reset logic through refs.
    return (
      <div className="ideas-detail-wrap">
        <IdeasDetailBackBar
          onBack={() => goAgent(agentId, "ideas")}
          onNew={() => fireNewIdea()}
          showNew={!composing}
        />
        <IdeaCanvas
          key={selected?.id ?? "compose"}
          agentId={agentId}
          idea={selected}
          initialName={presetName}
        />
      </div>
    );
  }

  return (
    <IdeasPicker
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

function ViewToggle({
  view,
  onChange,
}: {
  view: "list" | "graph";
  onChange: (next: "list" | "graph") => void;
}) {
  return (
    <div className="primitive-view-toggle" role="tablist" aria-label="View mode">
      <button
        type="button"
        role="tab"
        aria-selected={view === "list"}
        className={`primitive-view-toggle-btn${view === "list" ? " active" : ""}`}
        onClick={() => onChange("list")}
        title="List view (L)"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2 3h8M2 6h8M2 9h8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        list
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "graph"}
        className={`primitive-view-toggle-btn${view === "graph" ? " active" : ""}`}
        onClick={() => onChange("graph")}
        title="Graph view (G)"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          aria-hidden
        >
          <circle cx="3" cy="3" r="1.3" />
          <circle cx="9" cy="3" r="1.3" />
          <circle cx="6" cy="9" r="1.3" />
          <path d="M3 3 L9 3 M3 3 L6 9 M9 3 L6 9" strokeLinecap="round" />
        </svg>
        graph
      </button>
    </div>
  );
}

/**
 * Shared primitive-head for the Ideas surface. Exo 2 "Ideas" title
 * (becomes a back-link to the list when an item is open) + scope
 * tabs on the left; count + view toggle + `+ new idea` on the right.
 * Lives above both list and graph views so switching between them
 * doesn't feel like leaving the primitive.
 */
function IdeasPrimitiveHead({
  countLabel,
  view,
  onViewChange,
  onNew,
  scopeControl,
  onBack,
}: {
  countLabel?: string;
  view: "list" | "graph";
  onViewChange: (next: "list" | "graph") => void;
  onNew: () => void;
  scopeControl?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="primitive-head">
      <div className="primitive-head-lead">
        {onBack ? (
          <h2 className="primitive-head-heading">
            <button
              type="button"
              className="primitive-head-heading-back"
              onClick={onBack}
              title="Back to ideas"
              aria-label="Back to ideas"
            >
              <span className="primitive-head-heading-back-chevron" aria-hidden>
                ←
              </span>
              Ideas
            </button>
          </h2>
        ) : (
          <h2 className="primitive-head-heading">Ideas</h2>
        )}
        {scopeControl}
      </div>
      <div className="primitive-head-actions">
        {countLabel && <span className="primitive-head-meta">{countLabel}</span>}
        <ViewToggle view={view} onChange={onViewChange} />
        <button type="button" className="primitive-head-new" onClick={onNew} title="New idea (N)">
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
  );
}

/**
 * Slim detail back-bar — the primitive-head's younger sibling. Mounted
 * above IdeaCanvas so the user always has a one-click return to the
 * list. Uses the same 52px band + Exo 2 treatment so switching
 * between list and detail feels continuous; drops the scope tabs and
 * view toggle because they have no meaning inside a single idea.
 */
function IdeasDetailBackBar({
  onBack,
  onNew,
  showNew,
}: {
  onBack: () => void;
  onNew: () => void;
  showNew: boolean;
}) {
  return (
    <div className="primitive-head primitive-head--detail">
      <div className="primitive-head-lead">
        <h2 className="primitive-head-heading">
          <button
            type="button"
            className="primitive-head-heading-back"
            onClick={onBack}
            title="Back to ideas"
            aria-label="Back to ideas"
          >
            <span className="primitive-head-heading-back-chevron" aria-hidden>
              ←
            </span>
            Ideas
          </button>
        </h2>
      </div>
      {showNew && (
        <div className="primitive-head-actions">
          <button type="button" className="primitive-head-new" onClick={onNew} title="New idea (N)">
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
      )}
    </div>
  );
}

function IdeasScopeTabs({
  scope,
  scopes,
  counts,
  onChange,
}: {
  scope: IdeasFilter;
  scopes: IdeasFilter[];
  counts: Record<IdeasFilter, number>;
  onChange: (next: IdeasFilter) => void;
}) {
  return (
    <div className="primitive-scope-tabs" role="tablist" aria-label="Scope">
      {scopes.map((s) => {
        const isActive = scope === s;
        const isEmpty = counts[s] === 0;
        return (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={isActive}
            className={`primitive-scope-tab${isActive ? " active" : ""}${isEmpty && !isActive ? " empty" : ""}`}
            onClick={() => onChange(s)}
          >
            {s}
            <span className="primitive-scope-tab-count">{counts[s]}</span>
          </button>
        );
      })}
    </div>
  );
}

function IdeasPicker({
  agentId,
  ideas,
  scoped,
  filtered,
  tagCounts,
  scopeCounts,
  filter,
  onFilter,
  view,
  onViewChange,
}: {
  agentId: string;
  ideas: Idea[];
  scoped: Idea[];
  filtered: Idea[];
  tagCounts: [string, number][];
  scopeCounts: Record<IdeasFilter, number>;
  filter: FilterState;
  onFilter: (patch: Partial<FilterState>) => void;
  view: "list" | "graph";
  onViewChange: (next: "list" | "graph") => void;
}) {
  const { goAgent } = useNav();
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const searchActive = filter.search.trim() !== "";

  // Ranked order. Without a query this is a stable pass-through (every
  // row scores 3 and preserves input order). With a query, rows land in
  // rank buckets 0..4 — exact name first, then name-prefix, then name-
  // contains, then content-only — so ↓-then-Enter always lands on the
  // most obvious hit.
  const ranked = useMemo(() => {
    if (!searchActive) return filtered;
    return filtered
      .map((idea, i) => ({ idea, i, rank: matchRank(idea, filter.search) }))
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .map((r) => r.idea);
  }, [filtered, filter.search, searchActive]);

  // Group ideas by primary tag for Notion-style section headings when
  // the user is browsing. Flatten to a single ranked list under search
  // so relevance isn't hidden behind category dividers.
  const grouped = useMemo(() => {
    if (searchActive) return [["results", ranked] as [string, Idea[]]];
    const byTag = new Map<string, Idea[]>();
    for (const idea of ranked) {
      const primary = idea.tags?.[0] ?? "untagged";
      const list = byTag.get(primary) ?? [];
      list.push(idea);
      byTag.set(primary, list);
    }
    const entries = Array.from(byTag.entries()).sort((a, b) => {
      if (a[0] === "untagged") return 1;
      if (b[0] === "untagged") return -1;
      return b[1].length - a[1].length;
    });
    return entries;
  }, [ranked, searchActive]);

  const isFiltered = searchActive || filter.scope !== "all" || filter.tag !== null;
  const fireNew = (name?: string) =>
    window.dispatchEvent(new CustomEvent("aeqi:new-idea", { detail: name ? { name } : {} }));
  const clearAll = () => onFilter({ search: "", scope: "all", tag: null });

  // Shortcuts: "/" focuses search, Esc clears it when focused, "n" creates
  // a new idea, "l" / "g" flip between list and graph views — all gated so
  // they don't fire while the user is typing in an input. Capture phase +
  // stopImmediatePropagation — otherwise AppLayout's global "/" (palette)
  // and "n" (spawn sub-agent) handlers also fire and clobber.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      const inInput =
        tgt?.tagName === "INPUT" || tgt?.tagName === "TEXTAREA" || tgt?.isContentEditable;
      if (inInput) return;
      if (e.key === "/") {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "n") {
        e.preventDefault();
        e.stopImmediatePropagation();
        fireNew();
      } else if (e.key === "g" && view !== "graph") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onViewChange("graph");
      } else if (e.key === "l" && view !== "list") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onViewChange("list");
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [view, onViewChange]);

  const noMatchTrimmed = filter.search.trim();
  const totalInScope = scoped.length;

  return (
    <div className="ideas-list">
      <IdeasPrimitiveHead
        view={view}
        onViewChange={onViewChange}
        onNew={() => fireNew()}
        scopeControl={
          <IdeasScopeTabs
            scope={filter.scope}
            scopes={IDEA_FILTER_VALUES}
            counts={scopeCounts}
            onChange={(next) => onFilter({ scope: next })}
          />
        }
      />
      <div className="ideas-list-head">
        <div className="ideas-list-search-row">
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
              ref={searchRef}
              className="ideas-list-search"
              type="text"
              placeholder="Search ideas"
              value={filter.search}
              onChange={(e) => onFilter({ search: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (filter.search) {
                    onFilter({ search: "" });
                  } else {
                    (e.target as HTMLInputElement).blur();
                  }
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (filtered.length > 0) {
                    goAgent(agentId, "ideas", ranked[0].id);
                  } else if (noMatchTrimmed) {
                    // Enter-to-create when the query matches nothing —
                    // zero-cost capture for the most obvious next move.
                    fireNew(noMatchTrimmed);
                  }
                } else if (e.key === "ArrowDown" && filtered.length > 0) {
                  e.preventDefault();
                  rowRefs.current[0]?.focus();
                }
              }}
            />
            {!filter.search && (
              <kbd className="ideas-list-search-kbd" aria-hidden>
                /
              </kbd>
            )}
            {filter.search && (
              <button
                type="button"
                className="ideas-list-search-clear"
                onClick={() => onFilter({ search: "" })}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </span>
        </div>
        {tagCounts.length > 0 && (
          <div className="ideas-list-tags">
            {tagCounts.slice(0, 24).map(([t, n]) => (
              <button
                key={t}
                type="button"
                className={`ideas-list-tag${filter.tag === t ? " active" : ""}`}
                onClick={() => onFilter({ tag: filter.tag === t ? null : t })}
              >
                {t} <span className="ideas-list-tag-count">{n}</span>
              </button>
            ))}
          </div>
        )}
        {isFiltered && (
          <div className="ideas-list-filter-indicator" aria-live="polite">
            <span>
              <strong>{filtered.length}</strong>
              {" of "}
              <strong>{ideas.length}</strong>
              {filtered.length === 1 ? " idea" : " ideas"}
            </span>
            <button type="button" className="ideas-list-filter-reset" onClick={clearAll}>
              reset
            </button>
          </div>
        )}
      </div>

      <div className="ideas-list-body">
        {filtered.length === 0 ? (
          ideas.length === 0 ? (
            <div className="ideas-list-empty-hero">
              <div className="ideas-list-empty-title">Nothing thought yet.</div>
              <div className="ideas-list-empty-body">
                Ideas are the agent&rsquo;s memory — instructions, decisions, reference. Write one
                to start.
              </div>
              <div className="ideas-list-empty-actions">
                <Button variant="primary" size="sm" onClick={() => fireNew()}>
                  New idea
                </Button>
                <span className="ideas-list-empty-kbd" aria-hidden>
                  or press <kbd>N</kbd>
                </span>
              </div>
              <dl className="ideas-list-empty-syntax" aria-label="Writing syntax">
                <div>
                  <dt>
                    <code>#tag</code>
                  </dt>
                  <dd>categorize</dd>
                </div>
                <div>
                  <dt>
                    <code>[[name]]</code>
                  </dt>
                  <dd>link another idea</dd>
                </div>
                <div>
                  <dt>
                    <code>![[name]]</code>
                  </dt>
                  <dd>embed another idea</dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="ideas-list-empty-hero muted">
              <div className="ideas-list-empty-title">
                {noMatchTrimmed ? (
                  <>
                    No match for <span className="ideas-list-empty-query">{noMatchTrimmed}</span>.
                  </>
                ) : (
                  <>No matches.</>
                )}
              </div>
              <div className="ideas-list-empty-body">
                {noMatchTrimmed
                  ? `Capture it as a new idea, or widen the filter — ${totalInScope} in scope.`
                  : "Nothing found for the current filters."}
              </div>
              <div className="ideas-list-empty-actions">
                {noMatchTrimmed && (
                  <Button variant="primary" size="sm" onClick={() => fireNew(noMatchTrimmed)}>
                    Create &ldquo;{noMatchTrimmed}&rdquo;
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Reset filters
                </Button>
                {noMatchTrimmed && (
                  <span className="ideas-list-empty-kbd" aria-hidden>
                    or press <kbd>↵</kbd>
                  </span>
                )}
              </div>
            </div>
          )
        ) : (
          (() => {
            // Reset the row-ref registry for this render so ↑/↓ walk the
            // current filtered order; row indices are assigned flat across
            // group boundaries so keyboard traversal ignores grouping.
            rowRefs.current = [];
            let flatIndex = -1;
            return grouped.map(([groupTag, items]) => (
              <section key={groupTag} className="ideas-list-group">
                {!searchActive && (
                  <div className="inline-picker-group">
                    <span className="inline-picker-group-label">{groupTag}</span>
                    <span className="inline-picker-group-rule" />
                    <span className="inline-picker-group-count">{items.length}</span>
                  </div>
                )}
                {items.map((idea) => {
                  const snippet = snippetFor(idea.content, filter.search);
                  const wordCount = idea.content.trim().split(/\s+/).filter(Boolean).length;
                  const tags = idea.tags ?? [];
                  const isCandidate =
                    tags.includes("skill") &&
                    tags.includes("candidate") &&
                    !tags.includes("promoted") &&
                    !tags.includes("rejected");
                  const extraTags = Math.max(0, tags.length - 1);
                  // Show scope chip when the scope isn't the default "self".
                  // Suppress the chip when the filter tab already communicates it.
                  const resolvedScope: ScopeValue | null =
                    idea.scope ??
                    (idea.agent_id == null ? "global" : idea.agent_id === agentId ? "self" : null);
                  const showScopeChip =
                    resolvedScope != null &&
                    resolvedScope !== "self" &&
                    filter.scope !== resolvedScope;
                  const isInheritedRow = idea.agent_id != null && idea.agent_id !== agentId;
                  flatIndex += 1;
                  const myIndex = flatIndex;
                  return (
                    <button
                      key={idea.id}
                      ref={(el) => {
                        rowRefs.current[myIndex] = el;
                      }}
                      type="button"
                      className="ideas-list-row"
                      onClick={() => goAgent(agentId, "ideas", idea.id)}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          const next = rowRefs.current[myIndex + 1];
                          if (next) next.focus();
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          if (myIndex === 0) {
                            searchRef.current?.focus();
                          } else {
                            rowRefs.current[myIndex - 1]?.focus();
                          }
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          searchRef.current?.focus();
                        }
                      }}
                    >
                      <div className="ideas-list-row-head">
                        <span className="ideas-list-row-name">
                          {isInheritedRow && idea.agent_id && (
                            <span className="scope-inherited-prefix">
                              from @{idea.agent_id.slice(0, 8)}
                            </span>
                          )}
                          {highlightMatches(idea.name, filter.search)}
                        </span>
                        {isCandidate && (
                          <span
                            className="ideas-list-row-candidate"
                            title="Candidate skill — needs review"
                          >
                            needs review
                          </span>
                        )}
                        {showScopeChip && resolvedScope && <ScopeChip scope={resolvedScope} />}
                        {extraTags > 0 && <span className="ideas-list-row-more">+{extraTags}</span>}
                        {wordCount > 0 && (
                          <span className="ideas-list-row-words" aria-hidden>
                            {wordCount}w
                          </span>
                        )}
                      </div>
                      {snippet && (
                        <div className="ideas-list-row-snippet">
                          {highlightMatches(snippet, filter.search)}
                        </div>
                      )}
                    </button>
                  );
                })}
              </section>
            ));
          })()
        )}
      </div>
    </div>
  );
}
