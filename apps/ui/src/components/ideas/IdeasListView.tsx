import { useEffect, useMemo, useRef } from "react";
import { useNav } from "@/hooks/useNav";
import { Button } from "../ui";
import type { Idea, ScopeValue } from "@/lib/types";
import { IdeasPrimitiveHead, IdeasScopeTabs } from "./IdeasPrimitiveHead";
import {
  type FilterState,
  type IdeasFilter,
  IDEA_FILTER_VALUES,
  matchRank,
  snippetFor,
  highlightMatches,
} from "./types";

function ScopeChip({ scope }: { scope: ScopeValue }) {
  if (scope === "self") return null;
  return <span className={`scope-chip scope-chip--${scope}`}>{scope}</span>;
}

export interface IdeasListViewProps {
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
}

export default function IdeasListView({
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
}: IdeasListViewProps) {
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
