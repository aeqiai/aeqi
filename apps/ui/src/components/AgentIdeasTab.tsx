import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

  const setView = (next: "list" | "graph") => {
    const params = new URLSearchParams(searchParams);
    if (next === "graph") params.set("view", "graph");
    else params.delete("view");
    setSearchParams(params, { replace: true });
  };

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

  // Graph → detail: push a new history entry so browser-back returns to
  // the graph view. Using `replace: true` here stranded the user on the
  // list view after drilling into a node — hitting back wiped the graph
  // mode entirely.
  const handleGraphSelect = (node: GraphNode | null) => {
    if (!node) return;
    goAgent(agentId, "ideas", node.id);
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

  const fireNewIdea = () => window.dispatchEvent(new CustomEvent("aeqi:new-idea"));

  if (view === "graph") {
    return (
      <div className="ideas-graph">
        <IdeasPrimitiveHead
          countLabel={
            graphLoading ? "…" : `${graphData.nodes.length} · ${graphData.edges.length} links`
          }
          view="graph"
          onViewChange={setView}
          onNew={fireNewIdea}
        />
        <div className="ideas-graph-canvas">
          {graphLoading ? (
            <div className="ideas-graph-loading">
              <Spinner size="sm" />
              <span>Loading graph…</span>
            </div>
          ) : graphData.nodes.length === 0 ? (
            <EmptyState
              title="No ideas to graph"
              description="Create ideas to see them connected here."
              action={
                <Button variant="primary" onClick={fireNewIdea}>
                  New idea
                </Button>
              }
            />
          ) : (
            <IdeaGraph
              nodes={graphData.nodes}
              edges={graphData.edges}
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
    // Keying on the id resets internal canvas state when switching ideas —
    // cheaper than threading reset logic through refs.
    return (
      <div className="ideas-detail-wrap">
        <IdeasDetailBackBar
          onBack={() => goAgent(agentId, "ideas")}
          onNew={fireNewIdea}
          showNew={!composing}
        />
        <IdeaCanvas key={selected?.id ?? "compose"} agentId={agentId} idea={selected} />
      </div>
    );
  }

  return <IdeasPicker agentId={agentId} ideas={ideas} view={view} onViewChange={setView} />;
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
  scope: IdeasScope;
  scopes: IdeasScope[];
  counts: Record<IdeasScope, number>;
  onChange: (next: IdeasScope) => void;
}) {
  return (
    <div className="primitive-scope-tabs" role="tablist" aria-label="Scope">
      {scopes.map((s) => (
        <button
          key={s}
          type="button"
          role="tab"
          aria-selected={scope === s}
          className={`primitive-scope-tab${scope === s ? " active" : ""}`}
          onClick={() => onChange(s)}
        >
          {s}
          <span className="primitive-scope-tab-count">{counts[s]}</span>
        </button>
      ))}
    </div>
  );
}

function IdeasPicker({
  agentId,
  ideas,
  view,
  onViewChange,
}: {
  agentId: string;
  ideas: Idea[];
  view: "list" | "graph";
  onViewChange: (next: "list" | "graph") => void;
}) {
  const { goAgent } = useNav();
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<IdeasScope>("all");
  const [tag, setTag] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const scopeCounts = useMemo(() => {
    let mine = 0;
    let global = 0;
    let inherited = 0;
    for (const idea of ideas) {
      if (idea.agent_id == null) global++;
      else if (idea.agent_id === agentId) mine++;
      else inherited++;
    }
    return { all: ideas.length, mine, global, inherited };
  }, [ideas, agentId]);

  // Ideas that survive every filter except `tag` — the universe the tag
  // chip row is offering refinement *within*. Computing tag counts from
  // the post-scope / post-search universe keeps the counts honest: select
  // "mine" and the chips say "7" where the user actually has 7, not 42.
  const scoped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ideas.filter((idea) => {
      if (scope === "mine" && idea.agent_id !== agentId) return false;
      if (scope === "global" && idea.agent_id != null) return false;
      if (scope === "inherited" && (idea.agent_id == null || idea.agent_id === agentId))
        return false;
      if (q) {
        const inName = idea.name.toLowerCase().includes(q);
        const inContent = idea.content.toLowerCase().includes(q);
        if (!inName && !inContent) return false;
      }
      return true;
    });
  }, [ideas, search, scope, agentId]);

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const idea of scoped) {
      for (const t of idea.tags || []) counts[t] = (counts[t] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [scoped]);

  const filtered = useMemo(() => {
    if (!tag) return scoped;
    return scoped.filter((idea) => (idea.tags || []).includes(tag));
  }, [scoped, tag]);

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
  const clearAll = () => {
    setSearch("");
    setScope("all");
    setTag(null);
  };

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

  return (
    <div className="ideas-list">
      <IdeasPrimitiveHead
        view={view}
        onViewChange={onViewChange}
        onNew={fireNew}
        scopeControl={
          <IdeasScopeTabs
            scope={scope}
            scopes={["all", "mine", "global", "inherited"]}
            counts={scopeCounts}
            onChange={setScope}
          />
        }
      />
      <div className="ideas-list-head">
        <div className="ideas-list-search-row">
          <span className="ideas-list-search-field">
            <input
              ref={searchRef}
              className="ideas-list-search"
              type="text"
              placeholder="Search ideas"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (search) {
                    setSearch("");
                  } else {
                    (e.target as HTMLInputElement).blur();
                  }
                } else if (e.key === "Enter" && filtered.length > 0) {
                  e.preventDefault();
                  goAgent(agentId, "ideas", filtered[0].id);
                } else if (e.key === "ArrowDown" && filtered.length > 0) {
                  // Hand off to the first row so ↓ walks the list without
                  // the user having to reach for the mouse.
                  e.preventDefault();
                  rowRefs.current[0]?.focus();
                }
              }}
            />
            {!search && (
              <kbd className="ideas-list-search-kbd" aria-hidden>
                /
              </kbd>
            )}
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
                <Button variant="primary" size="sm" onClick={fireNew}>
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
              <div className="ideas-list-empty-title">No matches.</div>
              <div className="ideas-list-empty-body">Nothing found for the current filters.</div>
              <div className="ideas-list-empty-actions">
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Reset filters
                </Button>
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
                <div className="inline-picker-group">
                  <span className="inline-picker-group-label">{groupTag}</span>
                  <span className="inline-picker-group-rule" />
                  <span className="inline-picker-group-count">{items.length}</span>
                </div>
                {items.map((idea) => {
                  const snippet = snippetFor(idea.content, search);
                  const wordCount = idea.content.trim().split(/\s+/).filter(Boolean).length;
                  const extraTags = (idea.tags?.length ?? 0) - 1;
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
                          {highlightMatches(idea.name, search)}
                        </span>
                        {idea.agent_id == null && (
                          <span className="ideas-list-row-scope">Global</span>
                        )}
                        {extraTags > 0 && <span className="ideas-list-row-more">+{extraTags}</span>}
                        {wordCount > 0 && (
                          <span className="ideas-list-row-words" aria-hidden>
                            {wordCount}w
                          </span>
                        )}
                      </div>
                      {snippet && (
                        <div className="ideas-list-row-snippet">
                          {highlightMatches(snippet, search)}
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
