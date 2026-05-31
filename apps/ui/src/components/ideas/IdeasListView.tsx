import { type DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { useNav } from "@/hooks/useNav";
import { Button, Icon, PrimitivePageHeader, Tooltip } from "../ui";
import type { Idea } from "@/lib/types";
import { storeIdea, uploadFileToIdea } from "@/api/ideas";
import { asStringArray, parseFrontmatter } from "@/lib/frontmatter";
import { useAgentIdeasCache } from "@/queries/ideas";
import { blockTreeToPlainText } from "@/components/editor/blockEditorContent";
import { ImportMenu } from "@/components/blueprints/ImportMenu";
import IdeasToolbar from "./IdeasToolbar";
import IdeasListFilterChips from "./IdeasListFilterChips";
import IdeasFolderScopeBar from "./IdeasFolderScopeBar";
import IdeasListRow from "./IdeasListRow";
import IdeasMemoryScan from "./IdeasMemoryScan";
import { importIdeaProperties, importIdeaScope, isMarkdownFile } from "./ideaImport";
import { buildIdeaTree, flattenIdeaTree } from "./ideaTree";
import { type FilterState, type IdeasFilter, SCOPE_LABEL, matchRank } from "./types";

const TAG_CHIP_LIMIT = 8;

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
  folderId?: string | null;
  folderIdea?: Idea | null;
  folderAncestors?: Idea[];
  childCounts?: Map<string, number>;
  onFolderChange?: (ideaId: string | null) => void;
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
  folderId = null,
  folderIdea = null,
  folderAncestors = [],
  childCounts = new Map(),
  onFolderChange,
}: IdeasListViewProps) {
  const { goEntity, entityPath, companyId } = useNav();
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

  const fireNew = useCallback(
    (name?: string) =>
      window.dispatchEvent(
        new CustomEvent("aeqi:new-idea", {
          detail: { ...(name ? { name } : {}), ...(folderId ? { parentIdeaId: folderId } : {}) },
        }),
      ),
    [folderId],
  );
  const clearAll = () => onFilter({ search: "", scope: "all", tags: [], needsReview: false });

  const { invalidateIdeas } = useAgentIdeasCache(agentId, companyId);
  const [importError, setImportError] = useState<string | null>(null);

  const handleFileImport = async (files: FileList | File[], parentIdeaId?: string | null) => {
    setImportError(null);
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        if (isMarkdownFile(file)) {
          const raw = await file.text();
          const { body, data } = parseFrontmatter(raw);
          // Strip `.md` / `.markdown` from the filename — kept case-sensitive
          // since OS filesystems are; the user can rename if it matters.
          const name =
            (typeof data.title === "string" && data.title) ||
            file.name.replace(/\.(md|markdown)$/i, "") ||
            "Untitled";
          const tags = asStringArray(data.tags);
          const scope = importIdeaScope(data);
          const summary = typeof data.summary === "string" ? data.summary.trim() : "";
          // Stash summary as a leading paragraph if present and not already
          // duplicated in the body — the Idea schema has no `summary` field.
          const content =
            summary && !body.startsWith(summary) ? `${summary}\n\n${body.trim()}` : body.trim();
          await storeIdea(
            {
              name,
              content,
              tags,
              agent_id: agentId,
              scope,
              parent_idea_id: parentIdeaId ?? undefined,
              properties: importIdeaProperties(data, file.name),
            },
            companyId,
          );
        } else {
          const upload = await uploadFileToIdea(
            {
              agentId,
              file,
              parentIdeaId,
            },
            companyId,
          );
          if (!upload.ok) throw new Error(upload.error || "upload failed");
        }
      } catch (e) {
        failures.push(`${file.name}: ${e instanceof Error ? e.message : "import failed"}`);
      }
    }
    await invalidateIdeas();
    if (failures.length > 0) {
      setImportError(failures.join("; "));
    }
  };
  const handleDropFiles = (event: DragEvent, parentIdeaId?: string | null) => {
    if (event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void handleFileImport(event.dataTransfer.files, parentIdeaId);
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
  }, [view, onViewChange, fireNew]);

  const noMatchTrimmed = filter.search.trim();
  const totalInScope = scoped.length;

  const treeRows = useMemo(
    () => flattenIdeaTree(buildIdeaTree(ranked), expandedIdeas),
    [ranked, expandedIdeas],
  );
  const rankedFirstId = treeRows[0]?.node.idea.id ?? ranked[0]?.id ?? null;
  const filteredCount = filtered.length;
  const folderSearch = folderId ? { folder: folderId } : undefined;
  const folderHref = (ideaId: string) => {
    const path = entityPath(companyId, "ideas", ideaId);
    if (!folderId) return path;
    const params = new URLSearchParams({ folder: folderId });
    return `${path}?${params.toString()}`;
  };

  return (
    <div className="ideas-list">
      <PrimitivePageHeader
        title="Ideas"
        children={
          <IdeasToolbar
            inline
            filter={filter}
            scopeCounts={scopeCounts}
            needsReviewCount={needsReviewCount}
            onFilter={onFilter}
            view={view}
            onViewChange={onViewChange}
            searchInputRef={searchRef}
            showKbdHint
            onSearchKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (filteredCount > 0 && rankedFirstId) {
                  goEntity(companyId, "ideas", rankedFirstId, { search: folderSearch });
                } else if (noMatchTrimmed) {
                  fireNew(noMatchTrimmed);
                }
              } else if (e.key === "ArrowDown" && filteredCount > 0) {
                e.preventDefault();
                rowRefs.current?.[0]?.focus();
              }
            }}
          />
        }
        actions={
          <>
            <ImportMenu
              size="md"
              companyId={companyId}
              parts={["ideas"]}
              blueprintTitle="Import ideas from a template"
              accept="*/*"
              fileLabel="From files"
              onMarkdownPicked={(files) => void handleFileImport(files, folderId)}
              onBlueprintSpawned={() => void invalidateIdeas()}
            />
            <Tooltip content="New idea (N)">
              <Button
                variant="primary"
                size="md"
                onClick={() => fireNew()}
                leadingIcon={<Icon icon={Plus} size="sm" />}
              >
                Idea
              </Button>
            </Tooltip>
          </>
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

      <IdeasFolderScopeBar
        folderIdea={folderIdea}
        folderAncestors={folderAncestors}
        childCounts={childCounts}
        onFolderChange={onFolderChange}
      />
      <IdeasMemoryScan
        agentId={agentId}
        childCounts={childCounts}
        filterScope={filter.scope}
        folderHref={folderHref}
        treeRows={treeRows}
      />

      <div
        className="ideas-list-body"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => handleDropFiles(event, folderId)}
      >
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
                  const defaultExpanded = depth === 0;
                  return (
                    <IdeasListRow
                      key={idea.id}
                      agentId={agentId}
                      childCounts={childCounts}
                      defaultExpanded={defaultExpanded}
                      depth={depth}
                      filter={filter}
                      focusNext={() => rowRefs.current[myIndex + 1]?.focus()}
                      focusPrevious={() => rowRefs.current[myIndex - 1]?.focus()}
                      focusSearch={() => searchRef.current?.focus()}
                      folderHref={folderHref}
                      idea={idea}
                      index={myIndex}
                      isExpanded={expandedIdeas[idea.id] ?? defaultExpanded}
                      nestedChildCount={node.children.length}
                      onDropFiles={handleDropFiles}
                      onFolderChange={onFolderChange}
                      rowRef={(el) => {
                        rowRefs.current[myIndex] = el;
                      }}
                      toggleIdea={toggleIdea}
                    />
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
