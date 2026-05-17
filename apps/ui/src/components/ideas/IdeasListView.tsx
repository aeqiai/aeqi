import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useNav } from "@/hooks/useNav";
import { Button, Icon, IconButton } from "../ui";
import type { Idea, ScopeValue } from "@/lib/types";
import { storeIdea } from "@/api/ideas";
import { asStringArray, parseFrontmatter } from "@/lib/frontmatter";
import { formatDateTime } from "@/lib/i18n";
import { useAgentIdeasCache } from "@/queries/ideas";
import { blockTreeToPlainText } from "@/components/editor/blockEditorContent";
import { ImportMenu } from "@/components/blueprints/ImportMenu";
import IdeasToolbar from "./IdeasToolbar";
import IdeasListFilterChips from "./IdeasListFilterChips";
import {
  type FilterState,
  type IdeasFilter,
  SCOPE_LABEL,
  matchRank,
  snippetFor,
  highlightMatches,
  relativeTime,
} from "./types";

const TAG_CHIP_LIMIT = 8;

function ScopeChip({ scope }: { scope: ScopeValue }) {
  if (scope === "self") return null;
  return <span className={`scope-chip scope-chip--${scope}`}>{scope}</span>;
}

interface IdeaTreeNode {
  idea: Idea;
  children: IdeaTreeNode[];
}

interface IdeaTreeRow {
  node: IdeaTreeNode;
  depth: number;
}

function buildIdeaTree(ideas: Idea[]): IdeaTreeNode[] {
  const byParent = new Map<string | null, Idea[]>();
  const idSet = new Set(ideas.map((idea) => idea.id));
  const order = new Map(ideas.map((idea, index) => [idea.id, index]));

  for (const idea of ideas) {
    const parent =
      idea.parent_idea_id && idSet.has(idea.parent_idea_id) ? idea.parent_idea_id : null;
    const siblings = byParent.get(parent) ?? [];
    siblings.push(idea);
    byParent.set(parent, siblings);
  }

  const sortByCurrentOrder = (a: Idea, b: Idea) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0);
  const build = (parentId: string | null): IdeaTreeNode[] =>
    (byParent.get(parentId) ?? []).sort(sortByCurrentOrder).map((idea) => ({
      idea,
      children: build(idea.id),
    }));

  return build(null);
}

function flattenIdeaTree(
  nodes: IdeaTreeNode[],
  expanded: Record<string, boolean>,
  depth = 0,
): IdeaTreeRow[] {
  const rows: IdeaTreeRow[] = [];
  for (const node of nodes) {
    rows.push({ node, depth });
    const defaultExpanded = depth === 0;
    const isExpanded = expanded[node.idea.id] ?? defaultExpanded;
    if (node.children.length > 0 && isExpanded) {
      rows.push(...flattenIdeaTree(node.children, expanded, depth + 1));
    }
  }
  return rows;
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
  view: import("./IdeasViewPopover").IdeasView;
  onViewChange: (next: import("./IdeasViewPopover").IdeasView) => void;
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
  const { goEntity, entityPath, entityId } = useNav();
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLAnchorElement | null)[]>([]);
  const searchActive = filter.search.trim() !== "";

  // Ranked / sorted order. With a query, rows land in rank buckets 0..4
  // (exact name → prefix → contains → content) so ↓-then-Enter always
  // hits the most obvious target — sort mode is suppressed under search
  // because relevance trumps shelf order. Without a query, sort mode
  // controls the input order: the legacy `tag` mode keeps insertion order
  // for the nested outline, `recent` walks created_at desc, `alpha` walks
  // name asc.
  const ranked = useMemo(() => {
    if (searchActive) {
      return filtered
        .map((idea, i) => ({
          idea,
          i,
          rank: matchRank(
            { name: idea.name, content: blockTreeToPlainText(idea.content) },
            filter.search,
          ),
        }))
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

  const [tagsExpanded, setTagsExpanded] = useState(false);
  const [expandedIdeas, setExpandedIdeas] = useState<Record<string, boolean>>({});
  const toggleIdea = (id: string, defaultExpanded: boolean) =>
    setExpandedIdeas((prev) => ({ ...prev, [id]: !(prev[id] ?? defaultExpanded) }));
  const visibleTagCount = tagsExpanded
    ? tagCounts.length
    : Math.min(TAG_CHIP_LIMIT, tagCounts.length);
  const hiddenTagCount = Math.max(0, tagCounts.length - visibleTagCount);

  const fireNew = (name?: string) =>
    window.dispatchEvent(new CustomEvent("aeqi:new-idea", { detail: name ? { name } : {} }));
  const clearAll = () => onFilter({ search: "", scope: "all", tags: [], needsReview: false });

  const { invalidateIdeas } = useAgentIdeasCache(agentId);
  const [importError, setImportError] = useState<string | null>(null);

  const handleMarkdownImport = async (files: FileList) => {
    setImportError(null);
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const raw = await file.text();
        const { body, data } = parseFrontmatter(raw);
        // Strip `.md` / `.markdown` from the filename — kept case-sensitive
        // since OS filesystems are; the user can rename if it matters.
        const name =
          (typeof data.title === "string" && data.title) ||
          file.name.replace(/\.(md|markdown)$/i, "") ||
          "Untitled";
        const tags = asStringArray(data.tags);
        const summary = typeof data.summary === "string" ? data.summary.trim() : "";
        // Stash summary as a leading paragraph if present and not already
        // duplicated in the body — the Idea schema has no `summary` field.
        const content =
          summary && !body.startsWith(summary) ? `${summary}\n\n${body.trim()}` : body.trim();
        await storeIdea({
          name,
          content,
          tags,
          agent_id: agentId,
        });
      } catch (e) {
        failures.push(`${file.name}: ${e instanceof Error ? e.message : "import failed"}`);
      }
    }
    await invalidateIdeas();
    if (failures.length > 0) {
      setImportError(failures.join("; "));
    }
  };
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
      label: SCOPE_LABEL[filter.scope] ?? filter.scope,
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

  const treeRows = useMemo(
    () => flattenIdeaTree(buildIdeaTree(ranked), expandedIdeas),
    [ranked, expandedIdeas],
  );
  const rankedFirstId = treeRows[0]?.node.idea.id ?? ranked[0]?.id ?? null;
  const filteredCount = filtered.length;

  return (
    <div className="ideas-list">
      <IdeasToolbar
        filter={filter}
        scopeCounts={scopeCounts}
        needsReviewCount={needsReviewCount}
        onFilter={onFilter}
        view={view}
        onViewChange={onViewChange}
        onNew={() => fireNew()}
        searchInputRef={searchRef}
        showKbdHint
        onSearchKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (filteredCount > 0 && rankedFirstId) {
              goEntity(entityId, "ideas", rankedFirstId);
            } else if (noMatchTrimmed) {
              fireNew(noMatchTrimmed);
            }
          } else if (e.key === "ArrowDown" && filteredCount > 0) {
            e.preventDefault();
            rowRefs.current?.[0]?.focus();
          }
        }}
        importMenu={
          <ImportMenu
            entityId={entityId}
            parts={["ideas"]}
            blueprintTitle="Import ideas from a Blueprint"
            onMarkdownPicked={(files) => void handleMarkdownImport(files)}
            onBlueprintSpawned={() => void invalidateIdeas()}
          />
        }
      />
      {importError && (
        <div className="bp-error" role="alert">
          {importError}
        </div>
      )}
      {(activeChips.length > 0 || tagCounts.length > 0) && (
        <IdeasListFilterChips
          activeChips={activeChips}
          clearAll={clearAll}
          tagCounts={tagCounts}
          visibleTagCount={visibleTagCount}
          hiddenTagCount={hiddenTagCount}
          tagsExpanded={tagsExpanded}
          setTagsExpanded={setTagsExpanded}
          filter={filter}
          toggleTag={toggleTag}
          tagChipLimit={TAG_CHIP_LIMIT}
        />
      )}

      <div className="ideas-list-body">
        {filtered.length === 0 ? (
          ideas.length === 0 ? (
            <div className="empty-state-hero">
              <span className="empty-state-hero-eyebrow">a blank notebook</span>
              <h3 className="empty-state-hero-title">Nothing thought yet.</h3>
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
                    Nothing for <span className="empty-state-hero-query">{noMatchTrimmed}</span>
                  </>
                ) : (
                  <>No ideas match these filters.</>
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
            // parent/child boundaries so keyboard traversal follows the
            // visible nested order.
            rowRefs.current = [];
            return (
              <section className="ideas-list-group ideas-list-group--nested">
                {treeRows.map(({ node, depth }, myIndex) => {
                  const idea = node.idea;
                  const flatContent = blockTreeToPlainText(idea.content);
                  const snippet = snippetFor(flatContent, filter.search);
                  const wordCount = flatContent.trim().split(/\s+/).filter(Boolean).length;
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
                  const hasChildren = node.children.length > 0;
                  const depthClass = `ideas-list-row-depth-${Math.min(depth, 6)}`;
                  const defaultExpanded = depth === 0;
                  const isExpanded = expandedIdeas[idea.id] ?? defaultExpanded;
                  return (
                    <div
                      key={idea.id}
                      className={`ideas-list-row-wrap ${depthClass}`}
                      data-has-children={hasChildren ? "true" : "false"}
                    >
                      {hasChildren ? (
                        <IconButton
                          size="xs"
                          className={`ideas-list-row-disclosure${isExpanded ? " is-open" : ""}`}
                          aria-label={isExpanded ? "Collapse child ideas" : "Expand child ideas"}
                          aria-expanded={isExpanded}
                          onClick={() => toggleIdea(idea.id, defaultExpanded)}
                        >
                          <Icon icon={ChevronRight} size="xs" />
                        </IconButton>
                      ) : (
                        <span className="ideas-list-row-disclosure-spacer" aria-hidden />
                      )}
                      <Link
                        ref={(el) => {
                          rowRefs.current[myIndex] = el;
                        }}
                        to={entityPath(entityId, "ideas", idea.id)}
                        className="ideas-list-row"
                        data-testid="idea-row"
                        data-idea-id={idea.id}
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
                          } else if (e.key === "ArrowRight" && hasChildren && !isExpanded) {
                            e.preventDefault();
                            toggleIdea(idea.id, defaultExpanded);
                          } else if (e.key === "ArrowLeft" && hasChildren && isExpanded) {
                            e.preventDefault();
                            toggleIdea(idea.id, defaultExpanded);
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
                          {hasChildren && (
                            <span
                              className="ideas-list-row-child-count"
                              aria-label={`${node.children.length} child ideas`}
                            >
                              {node.children.length}
                            </span>
                          )}
                          {isCandidate && (
                            <span
                              className="ideas-list-row-candidate"
                              title="Candidate skill — needs review"
                            >
                              needs review
                            </span>
                          )}
                          {showScopeChip && resolvedScope && <ScopeChip scope={resolvedScope} />}
                          {extraTags > 0 && (
                            <span className="ideas-list-row-more">+{extraTags}</span>
                          )}
                          {ago ? (
                            <span
                              className="ideas-list-row-time"
                              title={idea.created_at ? formatDateTime(idea.created_at) : undefined}
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
                      </Link>
                    </div>
                  );
                })}
              </section>
            );
          })()
        )}
      </div>
    </div>
  );
}
