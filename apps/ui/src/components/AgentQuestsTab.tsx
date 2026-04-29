import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { Button, Popover } from "./ui";
import QuestCanvas from "./QuestCanvas";
import type { Quest, QuestStatus, QuestPriority, ScopeValue, User } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import QuestsViewPopover, { type QuestsView } from "./quests/QuestsViewPopover";
import QuestsSortPopover, { QUEST_SORT_MODES, type QuestSort } from "./quests/QuestsSortPopover";
import PriorityIcon from "./quests/PriorityIcon";
import AssigneeAvatar from "./quests/AssigneeAvatar";
import AssigneePicker from "./quests/AssigneePicker";
import { findAgentByAnyId } from "@/lib/entityLookup";

const PRIORITY_RANK: Record<QuestPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
};

const byUpdatedDesc = (a: Quest, b: Quest) =>
  (b.updated_at || "").localeCompare(a.updated_at || "");

function sortQuests(arr: Quest[], mode: QuestSort): Quest[] {
  const sorted = [...arr];
  switch (mode) {
    case "updated":
      return sorted.sort(byUpdatedDesc);
    case "created":
      return sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    case "priority":
      return sorted.sort(
        (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || byUpdatedDesc(a, b),
      );
    case "subject":
      return sorted.sort(
        (a, b) => (a.idea?.name ?? "").localeCompare(b.idea?.name ?? "") || byUpdatedDesc(a, b),
      );
  }
}

function parseQuestSort(raw: string | null): QuestSort {
  return QUEST_SORT_MODES.includes(raw as QuestSort) ? (raw as QuestSort) : "updated";
}

const QUEST_SCOPE_VALUES: ScopeValue[] = ["self", "siblings", "children", "branch", "global"];
type QuestFilter = "all" | ScopeValue | "inherited";
const QUEST_FILTER_VALUES: QuestFilter[] = [
  "all",
  "self",
  "siblings",
  "children",
  "branch",
  "global",
  "inherited",
];

function isQuestInherited(q: Quest, agentId: string): boolean {
  return q.agent_id != null && q.agent_id !== agentId;
}

function matchesQuestFilter(q: Quest, filter: QuestFilter, agentId: string): boolean {
  if (filter === "all") return true;
  if (filter === "inherited") return isQuestInherited(q, agentId);
  if (q.scope != null) return q.scope === filter;
  if (filter === "self") return q.agent_id === agentId;
  if (filter === "global") return q.agent_id == null;
  return false;
}

function QuestScopeChip({ scope }: { scope: ScopeValue }) {
  if (scope === "self") return null;
  return <span className={`scope-chip scope-chip--${scope}`}>{scope}</span>;
}

/**
 * Single Filter button + popover. Mirrors IdeasFilterPopover so Quests
 * reads as visually parallel to Ideas in the toolbar. Counts move
 * inside the popover rows; the trigger gets a dot when a non-default
 * scope is active.
 */
function QuestsFilterPopover({
  agentId,
  quests,
  filter,
  onChange,
}: {
  agentId: string;
  quests: Quest[];
  filter: QuestFilter;
  onChange: (next: QuestFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const counts = useMemo(() => {
    const c = Object.fromEntries(QUEST_FILTER_VALUES.map((f) => [f, 0])) as Record<
      QuestFilter,
      number
    >;
    for (const q of quests) {
      c.all += 1;
      if (isQuestInherited(q, agentId)) c.inherited += 1;
      if (q.scope != null && QUEST_SCOPE_VALUES.includes(q.scope)) {
        c[q.scope] += 1;
      } else if (q.agent_id === agentId) {
        c.self += 1;
      } else if (q.agent_id == null) {
        c.global += 1;
      }
    }
    return c;
  }, [quests, agentId]);

  const active = filter !== "all";

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={`ideas-toolbar-btn${active ? " active" : ""}${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          title={active ? `Filter — ${filter}` : "Filter"}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M2 3.25h9M3.5 6.5h6M5 9.75h3" />
          </svg>
          {active && <span className="ideas-toolbar-btn-dot" aria-hidden />}
        </button>
      }
    >
      <div id={popoverId} className="ideas-filter-popover" role="dialog" aria-label="Filter quests">
        <section className="ideas-filter-popover-section">
          <header className="ideas-filter-popover-head">
            <span className="ideas-filter-popover-label">scope</span>
            {filter !== "all" && (
              <button
                type="button"
                className="ideas-filter-popover-reset"
                onClick={() => onChange("all")}
              >
                reset
              </button>
            )}
          </header>
          <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Scope">
            {QUEST_FILTER_VALUES.map((s) => {
              const count = counts[s] ?? 0;
              const isActive = filter === s;
              const isEmpty = count === 0 && s !== "all";
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className={`ideas-filter-row${isActive ? " active" : ""}${isEmpty ? " empty" : ""}`}
                  onClick={() => {
                    onChange(s);
                    setOpen(false);
                  }}
                >
                  <span className="ideas-filter-row-mark" aria-hidden>
                    {isActive && (
                      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                        <path
                          d="M2 5.2 L4.2 7.4 L8 3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="ideas-filter-row-label">{s}</span>
                  <span className="ideas-filter-row-count">{count}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Popover>
  );
}

function StatusDot({ status }: { status: QuestStatus }) {
  return <span className={`quest-status-dot quest-status-dot--${status}`} />;
}

export default function AgentQuestsTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  // `/<agentId>/quests/new` is the dedicated compose surface; any other
  // `:itemId` is a quest id to look up. The literal `"new"` slug is
  // reserved — quest ids carry a numeric `prefix-NNN` shape so there's
  // no collision risk.
  const composing = itemId === "new";
  const selectedId = !composing && itemId ? itemId : null;
  const [questFilter, setQuestFilter] = useState<QuestFilter>("all");

  // View + sort persist in URL (mirrors AgentIdeasTab idiom). The
  // compose page also accepts `?fromIdea=<id>` to pre-pin Flow B.
  const [searchParams, setSearchParams] = useSearchParams();
  const view: QuestsView = searchParams.get("view") === "list" ? "list" : "board";
  const sort: QuestSort = parseQuestSort(searchParams.get("sort"));

  const openCompose = useCallback(
    (opts?: { fromIdea?: string; status?: QuestStatus }) => {
      const search: Record<string, string> = {};
      if (opts?.fromIdea) search.fromIdea = opts.fromIdea;
      if (opts?.status) search.status = opts.status;
      goAgent(agentId, "quests", "new", {
        replace: false,
        search: Object.keys(search).length > 0 ? search : undefined,
      });
    },
    [agentId, goAgent],
  );

  const setView = useCallback(
    (next: QuestsView) => {
      setSearchParams(
        (p) => {
          const np = new URLSearchParams(p);
          if (next === "list") np.set("view", "list");
          else np.delete("view");
          return np;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setSort = useCallback(
    (next: QuestSort) => {
      setSearchParams(
        (p) => {
          const np = new URLSearchParams(p);
          if (next !== "updated") np.set("sort", next);
          else np.delete("sort");
          return np;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const fetchQuests = useDaemonStore((s) => s.fetchQuests);
  const currentUser = useAuthStore((s) => s.user);
  // Candidate humans for the assignee picker. Today this is just the
  // authenticated user — every quest is reassignable to "me." A future
  // ship adds collaborators via a `GET /agents/:id/users` endpoint
  // backed by the platform's `user_access` junction.
  const assigneeUsers = useMemo<Pick<User, "id" | "name" | "email" | "avatar_url">[]>(() => {
    if (!currentUser) return [];
    return [
      {
        id: currentUser.id,
        name: currentUser.name,
        email: currentUser.email,
        avatar_url: currentUser.avatar_url,
      },
    ];
  }, [currentUser]);

  const agent = findAgentByAnyId(agents, agentId);
  const listQuest = selectedId ? quests.find((q) => q.id === selectedId) : undefined;

  // Detail view fetches the joined `{ quest, idea }` shape from
  // `GET /quests/:id` so the body renders the linked idea via `<IdeaCanvas>`.
  // The list payload is the fallback while the detail is in flight.
  const [questDetail, setQuestDetail] = useState<Quest | undefined>(undefined);
  useEffect(() => {
    if (!selectedId) {
      setQuestDetail(undefined);
      return;
    }
    let cancelled = false;
    api
      .getQuest(selectedId)
      .then((res) => {
        if (cancelled || !res?.quest) return;
        // Splice the top-level `idea` and the joined fields back onto the
        // quest so consumers can read `quest.idea?.content` uniformly.
        setQuestDetail({ ...res.quest, idea: res.idea ?? res.quest.idea });
      })
      .catch(() => {
        if (!cancelled) setQuestDetail(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, listQuest?.updated_at]);

  const quest = questDetail ?? listQuest;

  // Rail's create button → navigate to the dedicated compose page.
  useEffect(() => {
    const handler = () => openCompose();
    window.addEventListener("aeqi:create", handler);
    return () => window.removeEventListener("aeqi:create", handler);
  }, [openCompose]);

  // Compose and view land on the same `<QuestCanvas>` — same toolbar,
  // same affordances, the only difference is whether Save mints a new
  // quest or persists changes to the linked idea / lifecycle fields.
  // Idea-detail "+ Track as quest" pre-pins Flow B via `?fromIdea=<id>`.
  if (composing) {
    return <QuestCanvas kind="compose" agentId={agentId} resolvedAgentId={agent?.id || agentId} />;
  }

  if (!quest) {
    // agent.id match + cross-agent quests surfaced by the API.
    const visibleQuests = quests.filter((q) => q.agent_id === agent?.id || q.agent_id == null);
    const filteredQuests =
      questFilter === "all"
        ? visibleQuests
        : visibleQuests.filter((q) => matchesQuestFilter(q, questFilter, agent?.id ?? agentId));
    return (
      <QuestBoard
        agentId={agentId}
        resolvedAgentId={agent?.id || agentId}
        quests={filteredQuests}
        allQuests={visibleQuests}
        scopeFilter={questFilter}
        onScopeChange={setQuestFilter}
        onCreated={fetchQuests}
        onPick={(id) => goAgent(agentId, "quests", id)}
        onCompose={(status) => openCompose(status ? { status } : undefined)}
        view={view}
        onViewChange={setView}
        sort={sort}
        onSortChange={setSort}
        agents={agents}
        users={assigneeUsers}
      />
    );
  }

  return (
    <QuestCanvas
      kind="view"
      agentId={agentId}
      resolvedAgentId={agent?.id || agentId}
      quest={quest}
    />
  );
}

/**
 * Board view shown when no quest is selected.
 *
 * Toolbar — search + filter popover + plus button (navigates to the
 * `QuestCanvas` at `/<agentId>/quests/new`). Below: four kanban columns
 * (Todo / In Progress / Blocked / Done). Done is capped to 10
 * most-recent to keep the column from blowing out after months of work.
 */
function QuestBoard({
  agentId: _agentId,
  resolvedAgentId,
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
}: {
  agentId: string;
  resolvedAgentId: string;
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
}) {
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

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

  // Drag-and-drop state. `dragging` is the quest id being dragged so cards can
  // dim themselves; `dropTarget` is the column that'll receive the drop so its
  // frame can light up. `optimistic` overrides a quest's displayed status until
  // the server roundtrip lands — the UI feels instant, and a failed patch
  // simply reverts when we clear the entry.
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<QuestStatus | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, QuestStatus>>({});
  // Keyboard-navigation focus. Separate from DOM focus so j/k can traverse
  // cards even when the board root has programmatic focus — and so Esc can
  // clear the outline without blurring anything visible.
  const [focusId, setFocusId] = useState<string | null>(null);

  const handleDrop = useCallback(
    async (questId: string, next: QuestStatus) => {
      const q = quests.find((x) => x.id === questId);
      if (!q) return;
      const current = optimistic[questId] ?? q.status;
      if (current === next) return;
      setOptimistic((s) => ({ ...s, [questId]: next }));
      try {
        await api.updateQuest(questId, { status: next });
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
    [quests, optimistic, onCreated],
  );

  // v5.2: five-status Linear ladder. Backlog (parked) → Todo (ready) →
  // In progress → Done | Cancelled. Reading order left-to-right on the
  // board, top-to-bottom in the list view.
  const columns: Array<{ status: QuestStatus; label: string }> = [
    { status: "backlog", label: "Backlog" },
    { status: "todo", label: "Todo" },
    { status: "in_progress", label: "In progress" },
    { status: "done", label: "Done" },
    { status: "cancelled", label: "Cancelled" },
  ];

  // Bucket the already-sorted source by displayed status. Stable sort
  // means within-column order honors the active sort mode without a
  // secondary pass. Done + Cancelled are capped at the 10 MOST-RECENT
  // regardless of sort mode (terminal columns are recency archives, not
  // leaderboards); the chosen sort then orders that 10 for display.
  const grouped: Record<QuestStatus, Quest[]> = useMemo(() => {
    const buckets: Record<QuestStatus, Quest[]> = {
      backlog: [],
      todo: [],
      in_progress: [],
      done: [],
      cancelled: [],
    };
    for (const q of sortedVisibleQuests) {
      const s = optimistic[q.id] ?? q.status;
      buckets[s]?.push(q);
    }
    for (const terminal of ["done", "cancelled"] as const) {
      if (buckets[terminal].length > 10) {
        const recent = [...buckets[terminal]].sort(byUpdatedDesc).slice(0, 10);
        buckets[terminal] = sortQuests(recent, sort);
      }
    }
    return buckets;
  }, [sortedVisibleQuests, optimistic, sort]);

  // Flat traversal order used by j/k. In Board view: column-major over
  // backlog → todo → in_progress → done → cancelled. In List view:
  // the flat-sorted order.
  const flatOrderKey = useMemo(() => {
    if (view === "list") {
      return sortedVisibleQuests.map((q) => q.id).join("|");
    }
    const order: QuestStatus[] = ["backlog", "todo", "in_progress", "done", "cancelled"];
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
          <Button variant="primary" size="sm" onClick={() => onCompose()} title="New quest (N)">
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
      {err && <div className="quest-board-error">{err}</div>}

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
          search={search}
          agents={agents}
          users={users}
        />
      ) : (
        <div className="quest-board-columns">
          {columns.map((col) => {
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
                  </button>
                </header>
                <div className="quest-col-body">
                  {list.length === 0 ? (
                    <div className="quest-col-empty">{isTarget ? "Drop here" : "Nothing here"}</div>
                  ) : (
                    list.map((q) => (
                      <article
                        key={q.id}
                        className="quest-card"
                        data-priority={q.priority}
                        data-dragging={dragging === q.id || undefined}
                        data-focused={focusId === q.id || undefined}
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = "move";
                          e.dataTransfer.setData("text/plain", q.id);
                          setDragging(q.id);
                        }}
                        onDragEnd={() => {
                          setDragging(null);
                          setDropTarget(null);
                        }}
                        onClick={() => onPick(q.id)}
                      >
                        <div className="quest-card-head">
                          <StatusDot status={optimistic[q.id] ?? q.status} />
                          <span className="quest-card-subject">{q.idea?.name ?? q.id}</span>
                        </div>
                        <div className="quest-card-meta">
                          <PriorityIcon priority={q.priority} />
                          {q.scope && q.scope !== "self" && <QuestScopeChip scope={q.scope} />}
                          <span
                            className="quest-card-assignee"
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                          >
                            <AssigneePicker
                              assignee={q.assignee}
                              agents={agents}
                              users={users}
                              onChange={async (next) => {
                                try {
                                  await api.updateQuest(q.id, { assignee: next });
                                  onCreated();
                                } catch (e) {
                                  setErr(e instanceof Error ? e.message : "Failed to reassign");
                                }
                              }}
                              renderTrigger={({ open }) => (
                                <button
                                  type="button"
                                  className={`quest-row-assignee${open ? " open" : ""}`}
                                  aria-haspopup="dialog"
                                  aria-expanded={open}
                                  aria-label={
                                    q.assignee
                                      ? `Assigned: ${q.assignee}. Click to reassign.`
                                      : "Unassigned. Click to assign."
                                  }
                                >
                                  <AssigneeAvatar
                                    assignee={q.assignee}
                                    agents={agents}
                                    users={users}
                                    size={18}
                                  />
                                </button>
                              )}
                            />
                          </span>
                          {q.updated_at && (
                            <span className="quest-card-time">{timeAgo(q.updated_at)}</span>
                          )}
                        </div>
                      </article>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * List view — flat sortable rows. Reuses Ideas list-row chrome
 * (`.ideas-list-row`, `.ideas-list-row-head`, `.ideas-list-row-name`,
 * `.ideas-list-row-time`) so a future generalization of those classes
 * lifts both surfaces at once. Status dot is inline left of the name;
 * priority renders as a quiet text label (critical pops via the
 * `--critical` modifier). Empty + no-match states use the canonical
 * `.empty-state-hero` markup that IdeasListView uses.
 */
function QuestList({
  groups,
  optimistic,
  focusId,
  totalCount,
  onPick,
  onNew,
  onCompose,
  onAssigneeChange,
  search,
  agents,
  users,
}: {
  groups: Array<{ status: QuestStatus; label: string; quests: Quest[] }>;
  optimistic: Record<string, QuestStatus>;
  focusId: string | null;
  totalCount: number;
  onPick: (id: string) => void;
  onNew: () => void;
  onCompose: (status?: QuestStatus) => void;
  onAssigneeChange: (questId: string, next: string | null) => void;
  search: string;
  agents: { id: string; name: string }[];
  users: Pick<User, "id" | "name" | "email" | "avatar_url">[];
}) {
  // Per-group collapsed state. Empty groups stay hidden entirely; the
  // four canonical statuses (todo / in progress / blocked / done) all
  // render their headers when non-empty so the list mirrors the board's
  // left-to-right reading order.
  const [collapsed, setCollapsed] = useState<Partial<Record<QuestStatus, boolean>>>({});
  const toggle = useCallback((s: QuestStatus) => {
    setCollapsed((prev) => ({ ...prev, [s]: !prev[s] }));
  }, []);

  if (totalCount === 0) {
    const hasSearch = search.trim().length > 0;
    return (
      <div className="ideas-list-body">
        <div className="empty-state-hero">
          <h3 className="empty-state-hero-title">
            {hasSearch ? "No quests match." : "No quests yet."}
          </h3>
          <p className="empty-state-hero-body">
            {hasSearch
              ? "Try a different search, or start a new quest."
              : "Create the first quest to populate this board."}
          </p>
          <button type="button" className="ideas-toolbar-btn primary" onClick={onNew}>
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden
            >
              <path d="M6.5 2.5v8M2.5 6.5h8" />
            </svg>
            <span>New quest</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ideas-list-body">
      {groups.map((group) => {
        if (group.quests.length === 0) return null;
        const isCollapsed = !!collapsed[group.status];
        return (
          <section key={group.status} className="ideas-list-group">
            <div className="ideas-list-group-head">
              <button
                type="button"
                className="ideas-list-group-toggle"
                aria-expanded={!isCollapsed}
                onClick={() => toggle(group.status)}
              >
                <svg
                  className={`ideas-list-group-chevron${isCollapsed ? "" : " is-open"}`}
                  width="10"
                  height="10"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <path d="M4.5 3 L7.5 6 L4.5 9" />
                </svg>
                <StatusDot status={group.status} />
                <span className="ideas-list-group-label">{group.label}</span>
                <span className="ideas-list-group-count">{group.quests.length}</span>
              </button>
              <button
                type="button"
                className="ideas-list-group-add"
                onClick={() => onCompose(group.status)}
                aria-label={`New ${group.label.toLowerCase()} quest`}
                title={`New quest in ${group.label}`}
              >
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
              </button>
            </div>
            {!isCollapsed && (
              <div className="ideas-list-group-body">
                {group.quests.map((q) => {
                  const status = optimistic[q.id] ?? q.status;
                  const isFocused = focusId === q.id;
                  return (
                    <div
                      key={q.id}
                      className={`ideas-list-row${isFocused ? " focus" : ""}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => onPick(q.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onPick(q.id);
                        }
                      }}
                    >
                      <div className="ideas-list-row-head">
                        <StatusDot status={status} />
                        <span className="ideas-list-row-name">{q.idea?.name ?? q.id}</span>
                        {q.scope && q.scope !== "self" && <QuestScopeChip scope={q.scope} />}
                        <PriorityIcon priority={q.priority} />
                        <span
                          className="ideas-list-row-assignee"
                          onClick={(e) => e.stopPropagation()}
                          onMouseDown={(e) => e.stopPropagation()}
                        >
                          <AssigneePicker
                            assignee={q.assignee}
                            agents={agents}
                            users={users}
                            onChange={(next) => onAssigneeChange(q.id, next)}
                            renderTrigger={({ open }) => (
                              <button
                                type="button"
                                className={`quest-row-assignee${open ? " open" : ""}`}
                                aria-haspopup="dialog"
                                aria-expanded={open}
                                aria-label={
                                  q.assignee
                                    ? `Assigned: ${q.assignee}. Click to reassign.`
                                    : "Unassigned. Click to assign."
                                }
                              >
                                <AssigneeAvatar
                                  assignee={q.assignee}
                                  agents={agents}
                                  users={users}
                                  size={18}
                                />
                              </button>
                            )}
                          />
                        </span>
                        {q.updated_at && (
                          <span className="ideas-list-row-time">{timeAgo(q.updated_at)}</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
