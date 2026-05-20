import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Icon } from "../ui";
import { ImportMenu } from "../blueprints/ImportMenu";
import type { Quest, QuestStatus, User } from "@/lib/types";
import { formatAssignee } from "@/lib/assignee";
import { useRelativeNow } from "@/hooks/useRelativeNow";
import QuestsViewPopover, { type QuestsView } from "./QuestsViewPopover";
import QuestsSortPopover, { type QuestSort } from "./QuestsSortPopover";
import QuestsFilterPopover from "./QuestsFilterPopover";
import StatusDot from "./StatusDot";
import QuestList from "./QuestList";
import QuestActiveCard from "./QuestActiveCard";
import QuestArchiveStrips from "./QuestArchiveStrips";
import QuestBoardNoMatches from "./QuestBoardNoMatches";
import QuestColumnEmptyState, { COLLAPSIBLE_STATUSES } from "./QuestColumnEmptyState";
import QuestBoardScope from "./QuestBoardScope";
import QuestStatusSummary from "./QuestStatusSummary";
import {
  importQuestFromMarkdown,
  isDirectChildOf,
  questParentId,
  sortQuests,
  type QuestFilter,
} from "./agentQuestsHelpers";

/**
 * Board view shown when no quest is selected.
 *
 * Toolbar — search + filter popover + plus button (navigates to the
 * `QuestCanvas` at `/<agentId>/quests/new`). Below: four kanban columns
 * (Todo / In Progress / Blocked / Done). Done is capped to 10
 * most-recent to keep the column from blowing out after months of work.
 */
export default function QuestBoard({
  agentId: _agentId,
  resolvedAgentId,
  trustId,
  quests,
  allQuests,
  scopeFilter,
  onScopeChange,
  onCreated,
  onPick,
  onCompose,
  view,
  onViewChange,
  sort,
  onSortChange,
  agents,
  users,
  boardScopeId,
  boardScopeQuest,
  boardScopeAncestors = [],
  childCounts,
  onBoardScopeChange,
  onOpenQuest,
  onOpenParent: _onOpenParent,
  splitLayout = false,
}: {
  agentId: string;
  resolvedAgentId: string;
  trustId: string;
  quests: Quest[];
  allQuests: Quest[];
  scopeFilter: QuestFilter;
  onScopeChange: (next: QuestFilter) => void;
  onCreated: () => void;
  onPick: (id: string) => void;
  /** Navigates to the dedicated quest-compose page. Optional `status`
   *  pre-selects the column the new quest lands in. */
  onCompose: (status?: QuestStatus) => void;
  view: QuestsView;
  onViewChange: (next: QuestsView) => void;
  sort: QuestSort;
  onSortChange: (next: QuestSort) => void;
  agents: { id: string; name: string }[];
  users: Pick<User, "id" | "name" | "email" | "avatar_url">[];
  boardScopeId?: string | null;
  boardScopeQuest?: Quest;
  boardScopeAncestors?: Quest[];
  childCounts: Map<string, number>;
  onBoardScopeChange: (next: string | null) => void;
  onOpenQuest: (id: string) => void;
  onOpenParent: (id: string) => void;
  /** When true, the main board renders only the four ACTIVE columns
   *  (Todo · In Progress · In Review · Done) and demotes Backlog and
   *  Cancelled into horizontal strips below the board. Used by the
   *  standalone TRUST-scope Quests app at `/trust/<addr>/quests`. */
  splitLayout?: boolean;
}) {
  // Backlog and Cancelled are demoted into below-board strips when
  // `splitLayout` is on. The drag/drop layer still recognises them as
  // drop targets — promote / demote flows survive the split. Strip
  // open/close state lives inside `QuestArchiveStrips`.
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Tick "X ago" labels on the cards once a minute so they don't
  // freeze when the board is left open.
  useRelativeNow();

  // Search narrows what's displayed in the columns. Scope filtering
  // happens upstream (parent AgentQuestsTab) and feeds us `quests`; we
  // narrow further by subject / description / id substring match.
  // `allQuests` (unfiltered) stays the source for the scope-tab counts
  // so the counts don't flicker as the user types.
  const visibleQuests = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return quests;
    return quests.filter(
      (x) =>
        (x.idea?.name ?? "").toLowerCase().includes(q) ||
        (x.idea?.content ?? "").toLowerCase().includes(q) ||
        x.id.toLowerCase().includes(q),
    );
  }, [quests, search]);

  // Single sorted source feeding both Board grouping and List rendering.
  // Stable sort means within-bucket order in Board reflects the chosen
  // mode without a secondary sort pass.
  const sortedVisibleQuests = useMemo(() => sortQuests(visibleQuests, sort), [visibleQuests, sort]);
  const scopeParentId = boardScopeId ? questParentId(boardScopeId) : null;
  const scopeOptions = useMemo(
    () =>
      sortQuests(
        allQuests.filter(
          (q) => isDirectChildOf(q, scopeParentId) && (childCounts.get(q.id) ?? 0) > 0,
        ),
        "updated",
      ),
    [allQuests, childCounts, scopeParentId],
  );

  // Drag-and-drop state. `dragging` is the quest id being dragged so cards can
  // dim themselves; `dropTarget` is the column that'll receive the drop so its
  // frame can light up. `optimistic` overrides a quest's displayed status until
  // the server roundtrip lands — the UI feels instant, and a failed patch
  // simply reverts when we clear the entry.
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<QuestStatus | null>(null);
  const [scopeDropActive, setScopeDropActive] = useState(false);
  const [optimistic, setOptimistic] = useState<Record<string, QuestStatus>>({});
  // Backlog + Cancelled collapse to header-only by default; user can
  // toggle each one via the chevron in the column header. Backlog
  // tends to be huge (every unstarted seed) and Cancelled is archive
  // noise; collapsed by default keeps the active board scannable.
  const [collapsedCols, setCollapsedCols] = useState<Record<string, boolean>>({
    backlog: true,
    cancelled: true,
  });
  const toggleColumn = useCallback((status: QuestStatus) => {
    setCollapsedCols((prev) => ({ ...prev, [status]: !prev[status] }));
  }, []);
  // Keyboard-navigation focus. Separate from DOM focus so j/k can traverse
  // cards even when the board root has programmatic focus — and so Esc can
  // clear the outline without blurring anything visible.
  const [focusId, setFocusId] = useState<string | null>(null);

  const defaultAssignee = useMemo(
    () =>
      users[0]?.id
        ? formatAssignee("user", users[0].id)
        : resolvedAgentId
          ? formatAssignee("agent", resolvedAgentId)
          : null,
    [resolvedAgentId, users],
  );

  const handleDrop = useCallback(
    async (questId: string, next: QuestStatus) => {
      const q = quests.find((x) => x.id === questId);
      if (!q) return;
      const current = optimistic[questId] ?? q.status;
      if (current === next) return;
      setOptimistic((s) => ({ ...s, [questId]: next }));
      try {
        await api.updateQuest(questId, {
          status: next,
          assignee: next === "in_progress" && !q.assignee ? defaultAssignee : undefined,
        });
        onCreated();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to move quest");
      } finally {
        setOptimistic((s) => {
          const copy = { ...s };
          delete copy[questId];
          return copy;
        });
      }
    },
    [quests, optimistic, defaultAssignee, onCreated],
  );

  const handleTake = useCallback(
    async (questId: string) => {
      const q = quests.find((x) => x.id === questId);
      if (!q) return;
      setOptimistic((s) => ({ ...s, [questId]: "in_progress" }));
      try {
        await api.updateQuest(questId, {
          status: "in_progress",
          assignee: q.assignee ?? defaultAssignee,
        });
        onCreated();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to take quest");
      } finally {
        setOptimistic((s) => {
          const copy = { ...s };
          delete copy[questId];
          return copy;
        });
      }
    },
    [quests, defaultAssignee, onCreated],
  );

  // v5.3: six-status Linear ladder. Backlog (parked) → Todo (ready) →
  // In progress → In review → Done | Cancelled. Reading order left-to-right
  // on the board, top-to-bottom in the list view.
  // When `splitLayout` is on, Backlog and Cancelled get demoted into
  // collapsible strips below the main board — see the JSX below the grid.
  const columns: Array<{ status: QuestStatus; label: string }> = splitLayout
    ? [
        { status: "todo", label: "Todo" },
        { status: "in_progress", label: "In progress" },
        { status: "in_review", label: "In review" },
        { status: "done", label: "Done" },
      ]
    : [
        { status: "backlog", label: "Backlog" },
        { status: "todo", label: "Todo" },
        { status: "in_progress", label: "In progress" },
        { status: "in_review", label: "In review" },
        { status: "done", label: "Done" },
        { status: "cancelled", label: "Cancelled" },
      ];

  // Bucket the already-sorted source by displayed status. Stable sort
  // means within-column order honors the active sort mode without a
  // secondary pass. Terminal columns deliberately show the full matching
  // set: hiding old completed quests made the board disagree with the
  // ledger and turned reconciliation into guesswork.
  const grouped: Record<QuestStatus, Quest[]> = useMemo(() => {
    const buckets: Record<QuestStatus, Quest[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      in_review: [],
      done: [],
      cancelled: [],
    };
    for (const q of sortedVisibleQuests) {
      const s = optimistic[q.id] ?? q.status;
      buckets[s]?.push(q);
    }
    return buckets;
  }, [sortedVisibleQuests, optimistic]);

  // Flat traversal order used by j/k. In Board view: column-major over
  // backlog → todo → in_progress → in_review → done → cancelled. In List
  // view: the flat-sorted order.
  const flatOrderKey = useMemo(() => {
    if (view === "list") {
      return sortedVisibleQuests.map((q) => q.id).join("|");
    }
    const order: QuestStatus[] = [
      "backlog",
      "todo",
      "in_progress",
      "in_review",
      "done",
      "cancelled",
    ];
    const ids: string[] = [];
    for (const s of order) for (const q of grouped[s] ?? []) ids.push(q.id);
    return ids.join("|");
  }, [view, sortedVisibleQuests, grouped]);
  const flatOrderRef = useRef<string[]>([]);
  flatOrderRef.current = flatOrderKey ? flatOrderKey.split("|") : [];

  // If the focused card vanishes (status change, cap, refresh) drop the focus.
  useEffect(() => {
    if (focusId && !flatOrderRef.current.includes(focusId)) setFocusId(null);
  }, [flatOrderKey, focusId]);

  // j/k/Enter/Escape navigation. Mirrors the `?` shortcut idiom in AppLayout:
  // skip when focus is inside an INPUT / TEXTAREA / contenteditable, and stay
  // inert when any modifier is held so we don't collide with browser chords.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if (isEditable) return;

      // "/" focuses the search input (Ideas-page idiom). Stop propagation
      // so AppLayout's global "/" (palette) handler doesn't also fire.
      if (e.key === "/") {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }

      // b / l toggle Board / List view (mirrors Ideas g/l idiom).
      if (e.key === "b" && view !== "board") {
        e.preventDefault();
        onViewChange("board");
        return;
      }
      if (e.key === "l" && view !== "list") {
        e.preventDefault();
        onViewChange("list");
        return;
      }

      const order = flatOrderRef.current;
      if (order.length === 0) return;

      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const dir = e.key === "j" ? 1 : -1;
        const idx = focusId ? order.indexOf(focusId) : -1;
        let next: number;
        if (idx === -1) next = dir === 1 ? 0 : order.length - 1;
        else next = (idx + dir + order.length) % order.length;
        setFocusId(order[next]);
        return;
      }
      if (e.key === "Enter" && focusId) {
        e.preventDefault();
        onPick(focusId);
        return;
      }
      if (e.key === "Escape" && focusId) {
        e.preventDefault();
        setFocusId(null);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [focusId, onPick, view, onViewChange]);

  return (
    <div className="quest-board">
      {/* Page header — matches the Roles-page pattern: title on the
         left, primary actions on the right. Toolbar (search + sort +
         filter + view) lives in the row beneath. */}
      <header className="quest-board-header">
        <h1 className="quest-board-title">Quests</h1>
        <div className="quest-board-header-actions">
          <ImportMenu
            size="md"
            trustId={trustId}
            parts={["quests"]}
            blueprintTitle="Import quests from a Blueprint"
            onMarkdownPicked={async (files) => {
              setErr(null);
              const failures: string[] = [];
              for (const file of Array.from(files)) {
                try {
                  await importQuestFromMarkdown(file, resolvedAgentId);
                } catch (e) {
                  failures.push(
                    `${file.name}: ${e instanceof Error ? e.message : "import failed"}`,
                  );
                }
              }
              onCreated();
              if (failures.length > 0) setErr(failures.join("; "));
            }}
            onBlueprintSpawned={onCreated}
          />
          <Button
            variant="primary"
            size="md"
            onClick={() => onCompose()}
            title={boardScopeId ? "New subquest in this scope (N)" : "New quest (N)"}
            leadingIcon={<Icon icon={Plus} size="sm" />}
          >
            {boardScopeId ? "New subquest" : "New"}
          </Button>
        </div>
      </header>
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
              placeholder="Search quests"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (search) {
                    setSearch("");
                  } else {
                    (e.target as HTMLInputElement).blur();
                  }
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
          <QuestsSortPopover sort={sort} onChange={onSortChange} />
          <QuestsFilterPopover
            agentId={resolvedAgentId}
            quests={allQuests}
            filter={scopeFilter}
            onChange={onScopeChange}
          />
          <QuestsViewPopover view={view} onChange={onViewChange} />
        </div>
      </div>
      <QuestStatusSummary columns={columns} grouped={grouped} />
      <QuestBoardScope
        scope={boardScopeQuest}
        childCount={
          boardScopeQuest ? (childCounts.get(boardScopeQuest.id) ?? 0) : scopeOptions.length
        }
        parentScopeId={
          boardScopeAncestors.length > 0
            ? boardScopeAncestors[boardScopeAncestors.length - 1].id
            : null
        }
        projectCount={scopeOptions.length}
        dragging={dragging}
        dropActive={scopeDropActive}
        onDropActiveChange={setScopeDropActive}
        onDrop={(id) => {
          onBoardScopeChange(id);
          setDragging(null);
          setDropTarget(null);
        }}
        onUp={() =>
          onBoardScopeChange(
            boardScopeAncestors.length > 0
              ? boardScopeAncestors[boardScopeAncestors.length - 1].id
              : null,
          )
        }
        onClear={() => onBoardScopeChange(null)}
        onOpen={() => {
          if (boardScopeQuest) onOpenQuest(boardScopeQuest.id);
        }}
        optimistic={optimistic}
        focusId={focusId}
        setDragging={setDragging}
        setDropTarget={setDropTarget}
        onTake={handleTake}
        onCreated={onCreated}
        onError={setErr}
        agents={agents}
        users={users}
      />
      {err && (
        <div className="quest-board-error" role="alert">
          {err}
        </div>
      )}

      {view === "list" ? (
        <QuestList
          groups={columns.map((col) => ({
            status: col.status,
            label: col.label,
            quests: grouped[col.status] || [],
          }))}
          optimistic={optimistic}
          focusId={focusId}
          totalCount={sortedVisibleQuests.length}
          onPick={onPick}
          onNew={() => onCompose()}
          onCompose={onCompose}
          onAssigneeChange={async (id, next) => {
            try {
              await api.updateQuest(id, { assignee: next });
              onCreated();
            } catch (e) {
              setErr(e instanceof Error ? e.message : "Failed to reassign");
            }
          }}
          onTake={handleTake}
          search={search}
          onClearSearch={() => setSearch("")}
          agents={agents}
          users={users}
          childCounts={childCounts}
        />
      ) : search.trim().length > 0 && sortedVisibleQuests.length === 0 ? (
        <QuestBoardNoMatches onClear={() => setSearch("")} onCompose={() => onCompose()} />
      ) : (
        <div className="quest-board-grid">
          {[
            // Two independent sub-grids so collapsing Backlog doesn't
            // affect Cancelled's row height (each block's bottom row
            // sizes to its own archive column only).
            { id: "left" as const, statuses: ["todo", "in_progress", "backlog"] as QuestStatus[] },
            {
              id: "right" as const,
              statuses: ["in_review", "done", "cancelled"] as QuestStatus[],
            },
          ].map((block) => (
            <div
              key={block.id}
              className="quest-board-block"
              data-block={block.id}
              data-archive-collapsed={
                collapsedCols[block.id === "left" ? "backlog" : "cancelled"] || undefined
              }
            >
              {columns
                .filter((col) => block.statuses.includes(col.status))
                .map((col) => {
                  const list = grouped[col.status] || [];
                  const isTarget = dropTarget === col.status;
                  return (
                    <section
                      key={col.status}
                      className="quest-col"
                      data-status={col.status}
                      data-drop-target={isTarget || undefined}
                      onDragOver={(e) => {
                        if (!dragging) return;
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dropTarget !== col.status) setDropTarget(col.status);
                      }}
                      onDragLeave={(e) => {
                        // Only clear the highlight when the pointer actually leaves
                        // the column's own rectangle — not when it crosses onto a
                        // child card (relatedTarget would still be inside us).
                        const related = e.relatedTarget as Node | null;
                        if (related && e.currentTarget.contains(related)) return;
                        if (dropTarget === col.status) setDropTarget(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const id = e.dataTransfer.getData("text/plain") || dragging;
                        if (id) void handleDrop(id, col.status);
                        setDragging(null);
                        setDropTarget(null);
                      }}
                    >
                      {COLLAPSIBLE_STATUSES.has(col.status) ? (
                        <button
                          type="button"
                          className="quest-col-header quest-col-header--toggle"
                          onClick={() => toggleColumn(col.status)}
                          aria-expanded={!collapsedCols[col.status]}
                          aria-label={
                            collapsedCols[col.status] ? "Expand column" : "Collapse column"
                          }
                        >
                          <StatusDot status={col.status} />
                          <span className="quest-col-label">{col.label}</span>
                          <span className="quest-col-count">{list.length}</span>
                          <span className="quest-col-collapse" aria-hidden>
                            {collapsedCols[col.status] ? (
                              <ChevronRight size={14} strokeWidth={1.8} />
                            ) : (
                              <ChevronDown size={14} strokeWidth={1.8} />
                            )}
                          </span>
                        </button>
                      ) : (
                        <header className="quest-col-header">
                          <StatusDot status={col.status} />
                          <span className="quest-col-label">{col.label}</span>
                          <span className="quest-col-count">{list.length}</span>
                          <button
                            type="button"
                            className="quest-col-add"
                            onClick={() => onCompose(col.status)}
                            aria-label={`New ${col.label.toLowerCase()} quest`}
                            title={`New quest in ${col.label}`}
                          >
                            <Icon icon={Plus} size="xs" />
                          </button>
                        </header>
                      )}
                      {!collapsedCols[col.status] && (
                        <div className="quest-col-body">
                          {list.length === 0 ? (
                            <QuestColumnEmptyState status={col.status} isDropTarget={isTarget} />
                          ) : (
                            list.map((q) => (
                              <QuestActiveCard
                                key={q.id}
                                q={q}
                                optimistic={optimistic}
                                dragging={dragging}
                                focusId={focusId}
                                setDragging={setDragging}
                                setDropTarget={setDropTarget}
                                onPick={q.id === boardScopeId ? () => onOpenQuest(q.id) : onPick}
                                onTake={handleTake}
                                onCreated={onCreated}
                                onError={setErr}
                                agents={agents}
                                users={users}
                                childCount={childCounts.get(q.id) ?? 0}
                                isScope={q.id === boardScopeId}
                              />
                            ))
                          )}
                        </div>
                      )}
                    </section>
                  );
                })}
            </div>
          ))}
        </div>
      )}
      {view !== "list" && splitLayout && (
        <QuestArchiveStrips
          grouped={grouped}
          dragging={dragging}
          setDragging={setDragging}
          dropTarget={dropTarget}
          setDropTarget={setDropTarget}
          onDrop={handleDrop}
          optimistic={optimistic}
          focusId={focusId}
          onPick={onPick}
          onTake={handleTake}
          onCreated={onCreated}
          onError={setErr}
          agents={agents}
          users={users}
        />
      )}
    </div>
  );
}
