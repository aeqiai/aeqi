import { useEffect, useMemo, useRef, useState } from "react";
import { useNav } from "@/hooks/useNav";
import { Button } from "../ui";
import type { Idea, ScopeValue } from "@/lib/types";
import IdeasFilterPopover from "./IdeasFilterPopover";
import IdeasSortPopover from "./IdeasSortPopover";
import IdeasViewPopover from "./IdeasViewPopover";
import {
  type FilterState,
  type IdeasFilter,
  type Epoch,
  EPOCH_LABELS,
  EPOCH_ORDER,
  matchRank,
  snippetFor,
  highlightMatches,
  relativeTime,
  epochOf,
} from "./types";

const TAG_CHIP_LIMIT = 8;

const SCOPE_LABELS: Record<IdeasFilter, string> = {
  all: "all",
  self: "self",
  siblings: "siblings",
  children: "children",
  branch: "branch",
  global: "global",
  inherited: "inherited",
};

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

  // Ranked / sorted order. With a query, rows land in rank buckets 0..4
  // (exact name → prefix → contains → content) so ↓-then-Enter always
  // hits the most obvious target — sort mode is suppressed under search
  // because relevance trumps shelf order. Without a query, sort mode
  // controls the input order: `tag` keeps insertion order (groups handle
  // it later), `recent` walks created_at desc, `alpha` walks name asc.
  const ranked = useMemo(() => {
    if (searchActive) {
      return filtered
        .map((idea, i) => ({ idea, i, rank: matchRank(idea, filter.search) }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i)
        .map((r) => r.idea);
    }
    if (filter.sort === "recent") {
      return [...filtered].sort((a, b) => {
        const ta = a.created_at ? Date.parse(a.created_at) : 0;
        const tb = b.created_at ? Date.parse(b.created_at) : 0;
        return tb - ta;
      });
    }
    if (filter.sort === "alpha") {
      return [...filtered].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    }
    return filtered;
  }, [filtered, filter.search, filter.sort, searchActive]);

  // Sectioning. `tag` groups by primary tag for Notion-style headings;
  // `recent` groups by recency epoch (today / this-week / this-month /
  // this-year / older) so the index reads like a journal; `alpha` is a
  // flat run. Search collapses to a single "results" section regardless
  // of sort because relevance trumps shelf order.
  const grouped = useMemo<[string, Idea[]][]>(() => {
    if (searchActive) return [["results", ranked]];
    if (filter.sort === "alpha") return [["", ranked]];
    if (filter.sort === "recent") {
      const now = Date.now();
      const byEpoch: Record<Epoch, Idea[]> = {
        today: [],
        "this-week": [],
        "this-month": [],
        "this-year": [],
        older: [],
      };
      for (const idea of ranked) byEpoch[epochOf(idea.created_at, now)].push(idea);
      return EPOCH_ORDER.filter((e) => byEpoch[e].length > 0).map((e) => [
        EPOCH_LABELS[e],
        byEpoch[e],
      ]);
    }
    const byTag = new Map<string, Idea[]>();
    for (const idea of ranked) {
      const primary = idea.tags?.[0] ?? "untagged";
      const list = byTag.get(primary) ?? [];
      list.push(idea);
      byTag.set(primary, list);
    }
    return Array.from(byTag.entries()).sort((a, b) => {
      if (a[0] === "untagged") return 1;
      if (b[0] === "untagged") return -1;
      return b[1].length - a[1].length;
    });
  }, [ranked, searchActive, filter.sort]);

  const showGroupHeadings = !searchActive && filter.sort !== "alpha";
  const [tagsExpanded, setTagsExpanded] = useState(false);
  const visibleTagCount = tagsExpanded
    ? tagCounts.length
    : Math.min(TAG_CHIP_LIMIT, tagCounts.length);
  const hiddenTagCount = Math.max(0, tagCounts.length - visibleTagCount);

  const fireNew = (name?: string) =>
    window.dispatchEvent(new CustomEvent("aeqi:new-idea", { detail: name ? { name } : {} }));
  const clearAll = () => onFilter({ search: "", scope: "all", tags: [], needsReview: false });
  const toggleTag = (tag: string) => {
    const next = filter.tags.includes(tag)
      ? filter.tags.filter((t) => t !== tag)
      : [...filter.tags, tag];
    onFilter({ tags: next });
  };

  // Pre-compute "needs review" count for the popover badge, scoped to the
  // agent's full idea set so the toggle communicates real volume even when
  // the user has already narrowed via tag or scope.
  const needsReviewCount = useMemo(
    () =>
      ideas.filter((i) => {
        const t = i.tags ?? [];
        return (
          t.includes("skill") &&
          t.includes("candidate") &&
          !t.includes("promoted") &&
          !t.includes("rejected")
        );
      }).length,
    [ideas],
  );

  // Active-filter chips strip — surfaces every non-resting filter as a
  // dismissable token under the search field. The popover sets these; the
  // chip strip is the only place the user sees what's *actually* in play
  // without re-opening the popover.
  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (filter.scope !== "all")
    activeChips.push({
      key: "scope",
      label: SCOPE_LABELS[filter.scope] ?? filter.scope,
      onRemove: () => onFilter({ scope: "all" }),
    });
  for (const t of filter.tags) {
    activeChips.push({
      key: `tag:${t}`,
      label: `#${t}`,
      onRemove: () => onFilter({ tags: filter.tags.filter((x) => x !== t) }),
    });
  }
  if (filter.needsReview)
    activeChips.push({
      key: "review",
      label: "needs review",
      onRemove: () => onFilter({ needsReview: false }),
    });

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
          <IdeasSortPopover
            sort={filter.sort}
            disabled={searchActive}
            onChange={(next) => onFilter({ sort: next })}
          />
          <IdeasFilterPopover
            filter={filter}
            scopeCounts={scopeCounts}
            needsReviewCount={needsReviewCount}
            onChange={onFilter}
          />
          <IdeasViewPopover view={view} onChange={onViewChange} />
          <Button variant="primary" size="sm" onClick={() => fireNew()} title="New idea (N)">
            <svg
              width="11"
              height="11"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6.5 2.5v8M2.5 6.5h8" />
            </svg>
            New
          </Button>
        </div>
      </div>
      {(activeChips.length > 0 || tagCounts.length > 0) && (
        <div className="ideas-tags-strip">
          {activeChips.length > 0 && (
            <div className="ideas-list-chips" role="list" aria-label="Active filters">
              {activeChips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="listitem"
                  className="ideas-list-chip"
                  onClick={c.onRemove}
                  title={`Remove ${c.label}`}
                >
                  <span className="ideas-list-chip-label">{c.label}</span>
                  <span className="ideas-list-chip-x" aria-hidden>
                    ×
                  </span>
                </button>
              ))}
              <button type="button" className="ideas-list-chip-clear" onClick={clearAll}>
                clear all
              </button>
            </div>
          )}
          {tagCounts.length > 0 && (
            <div className="ideas-list-tags">
              {tagCounts.slice(0, visibleTagCount).map(([t, n]) => {
                const isActive = filter.tags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={isActive}
                    className={`ideas-tag-chip${isActive ? " active" : ""}`}
                    onClick={() => toggleTag(t)}
                  >
                    #{t}
                    <span className="ideas-tag-chip-count">{n}</span>
                  </button>
                );
              })}
              {hiddenTagCount > 0 && (
                <button
                  type="button"
                  className="ideas-list-tag-more"
                  onClick={() => setTagsExpanded(true)}
                  aria-label={`Show ${hiddenTagCount} more tags`}
                >
                  +{hiddenTagCount} more
                </button>
              )}
              {tagsExpanded && tagCounts.length > TAG_CHIP_LIMIT && (
                <button
                  type="button"
                  className="ideas-list-tag-more"
                  onClick={() => setTagsExpanded(false)}
                >
                  show less
                </button>
              )}
            </div>
          )}
        </div>
      )}

      <div className="ideas-list-body">
        {filtered.length === 0 ? (
          ideas.length === 0 ? (
            <div className="empty-state-hero">
              <span className="empty-state-hero-eyebrow">a blank notebook</span>
              <h3 className="empty-state-hero-title">nothing thought yet.</h3>
              <p className="empty-state-hero-body">
                Ideas are how this agent remembers — instructions, decisions, references. The first
                idea seeds the next thousand.
              </p>
              <div className="empty-state-hero-actions">
                <Button variant="primary" size="sm" onClick={() => fireNew()}>
                  Write the first idea
                </Button>
                <span className="empty-state-hero-kbd" aria-hidden>
                  or press <kbd>N</kbd>
                </span>
              </div>
              <dl className="empty-state-hero-syntax" aria-label="Writing syntax">
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
            <div className="empty-state-hero muted">
              <span className="empty-state-hero-eyebrow">
                {noMatchTrimmed ? "no match" : "no rows"}
                <span className="empty-state-hero-eyebrow-sep" aria-hidden>
                  ·
                </span>
                <span className="empty-state-hero-eyebrow-count">{totalInScope} in scope</span>
              </span>
              <h3 className="empty-state-hero-title">
                {noMatchTrimmed ? (
                  <>
                    nothing for <span className="empty-state-hero-query">{noMatchTrimmed}</span>
                  </>
                ) : (
                  <>no ideas match these filters.</>
                )}
              </h3>
              <p className="empty-state-hero-body">
                {noMatchTrimmed
                  ? "Capture it as a new idea, or widen the filter."
                  : "Drop a chip, widen the scope, or clear all filters to bring rows back."}
              </p>
              <div className="empty-state-hero-actions">
                {noMatchTrimmed && (
                  <Button variant="primary" size="sm" onClick={() => fireNew(noMatchTrimmed)}>
                    Create &ldquo;{noMatchTrimmed}&rdquo;
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={clearAll}>
                  Reset filters
                </Button>
                {noMatchTrimmed && (
                  <span className="empty-state-hero-kbd" aria-hidden>
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
              <section key={groupTag || "all"} className="ideas-list-group">
                {showGroupHeadings && (
                  <div className="inline-picker-group">
                    <span className="inline-picker-group-label">{groupTag}</span>
                    <span className="inline-picker-group-rule" />
                    <span className="inline-picker-group-count">{items.length}</span>
                  </div>
                )}
                {items.map((idea) => {
                  const snippet = snippetFor(idea.content, filter.search);
                  const wordCount = idea.content.trim().split(/\s+/).filter(Boolean).length;
                  const ago = relativeTime(idea.created_at);
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
                        {ago ? (
                          <span
                            className="ideas-list-row-time"
                            title={
                              idea.created_at
                                ? new Date(idea.created_at).toLocaleString()
                                : undefined
                            }
                          >
                            {ago}
                          </span>
                        ) : wordCount > 0 ? (
                          <span className="ideas-list-row-words" aria-hidden>
                            {wordCount}w
                          </span>
                        ) : null}
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
