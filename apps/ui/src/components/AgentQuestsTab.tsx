import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { Button, Input, Modal, Popover, Select, Spinner } from "./ui";
import type { Quest, QuestStatus, QuestPriority, ScopeValue } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import QuestsViewPopover, { type QuestsView } from "./quests/QuestsViewPopover";
import QuestsSortPopover, { QUEST_SORT_MODES, type QuestSort } from "./quests/QuestsSortPopover";
import QuestStatusPopover from "./quests/QuestStatusPopover";
import QuestPriorityPopover from "./quests/QuestPriorityPopover";

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
      return sorted.sort((a, b) => a.subject.localeCompare(b.subject) || byUpdatedDesc(a, b));
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

type SaveState = "idle" | "saving" | "error";

const SAVE_DEBOUNCE_MS = 700;

const PRIORITY_LABELS: Record<QuestPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

function StatusDot({ status }: { status: QuestStatus }) {
  return <span className={`quest-status-dot quest-status-dot--${status}`} />;
}

export default function AgentQuestsTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;
  const [questFilter, setQuestFilter] = useState<QuestFilter>("all");
  const [newOpen, setNewOpen] = useState(false);

  // View + sort persist in URL (mirrors AgentIdeasTab idiom). Defaults
  // are board view + recent (updated_at desc) sort, written to the URL
  // only when non-default so clean links stay clean.
  const [searchParams, setSearchParams] = useSearchParams();
  const view: QuestsView = searchParams.get("view") === "list" ? "list" : "board";
  const sort: QuestSort = parseQuestSort(searchParams.get("sort"));

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

  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
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

  const [description, setDescription] = useState(quest?.description ?? "");
  const [status, setStatus] = useState<QuestStatus>(quest?.status ?? "pending");
  const [priority, setPriority] = useState<QuestPriority>(quest?.priority ?? "normal");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const latestRef = useRef({ description, status, priority });
  latestRef.current = { description, status, priority };

  useEffect(() => {
    setDescription(quest?.description ?? "");
    setStatus(quest?.status ?? "pending");
    setPriority(quest?.priority ?? "normal");
    setSaveState("idle");
    setError(null);
    dirtyRef.current = false;
  }, [quest?.id, quest?.description, quest?.status, quest?.priority]);

  const save = useCallback(async () => {
    if (!selectedId) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveState("saving");
    setError(null);
    try {
      const { description: d, status: s, priority: p } = latestRef.current;
      await api.updateQuest(selectedId, { description: d, status: s, priority: p });
      await fetchQuests();
      setSaveState("idle");
      dirtyRef.current = false;
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }, [selectedId, fetchQuests]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("idle");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(save, SAVE_DEBOUNCE_MS);
  }, [save]);

  const handleStatusChange = useCallback(
    (next: QuestStatus) => {
      setStatus(next);
      dirtyRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(save, 200);
    },
    [save],
  );

  const handlePriorityChange = useCallback(
    (next: QuestPriority) => {
      setPriority(next);
      dirtyRef.current = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(save, 200);
    },
    [save],
  );

  // Rail's create button — navigate to the board (where the modal lives)
  // and open it. Modal is rendered inside QuestBoard but driven by state
  // hoisted to this level so the open intent survives the navigation.
  useEffect(() => {
    const handler = () => {
      goAgent(agentId, "quests", undefined, { replace: true });
      setNewOpen(true);
    };
    window.addEventListener("aeqi:create", handler);
    return () => window.removeEventListener("aeqi:create", handler);
  }, [agentId, goAgent]);

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
        newOpen={newOpen}
        onNewOpenChange={setNewOpen}
        view={view}
        onViewChange={setView}
        sort={sort}
        onSortChange={setSort}
      />
    );
  }

  return (
    <div className="asv-main quest-detail">
      <div className="ideas-list-head">
        <div className="ideas-toolbar">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => goAgent(agentId, "quests", undefined, { replace: true })}
            title="Back to quests"
          >
            <svg
              width="11"
              height="11"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M8 3 L4.5 6.5 L8 10" />
            </svg>
            Quests
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              goAgent(agentId, "quests", undefined, { replace: true });
              setNewOpen(true);
            }}
            title="New quest (N)"
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
            New
          </Button>
          <QuestStatusPopover status={status} onChange={handleStatusChange} />
          <QuestPriorityPopover priority={priority} onChange={handlePriorityChange} />
          {quest.scope && <QuestScopeChip scope={quest.scope} />}
          <div className="ideas-toolbar-spacer" aria-hidden />
          {saveState === "saving" ? (
            <span className="quest-detail-savestate">
              <Spinner size="sm" /> Saving
            </span>
          ) : quest.updated_at ? (
            <span className="quest-detail-savestate quest-detail-savestate--saved">
              Saved · {timeAgo(quest.updated_at)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="quest-detail-scroll">
        <div className="quest-detail-col">
          {error && <div className="quest-detail-error">{error}</div>}

          <div className="quest-detail-eyebrow">
            <StatusDot status={quest.status} />
            <span className="quest-detail-eyebrow-kind">Quest</span>
            <span className="quest-detail-eyebrow-sep" aria-hidden>
              ·
            </span>
            <span className="quest-detail-eyebrow-id">{quest.id.slice(0, 8)}</span>
          </div>

          <h2 className="quest-detail-title">{quest.subject}</h2>

          <div className="quest-detail-section">
            <div className="quest-detail-section-label">Description</div>
            <textarea
              className="quest-detail-textarea"
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                scheduleSave();
              }}
              onBlur={() => {
                if (dirtyRef.current) save();
              }}
              placeholder="Add a description…"
              rows={6}
            />
          </div>

          {quest.acceptance_criteria && (
            <div className="quest-detail-section">
              <div className="quest-detail-section-label">Acceptance criteria</div>
              <div className="quest-detail-prose">{quest.acceptance_criteria}</div>
            </div>
          )}

          {quest.worktree_path && (
            <div className="quest-detail-section">
              <div className="quest-detail-section-label">Worktree</div>
              <div className="quest-detail-worktree">
                <code className="quest-detail-code">{quest.worktree_path}</code>
                {quest.worktree_branch && (
                  <span className="quest-detail-branch">branch · {quest.worktree_branch}</span>
                )}
              </div>
            </div>
          )}

          {quest.labels && quest.labels.length > 0 && (
            <div className="quest-detail-section">
              <div className="quest-detail-section-label">Labels</div>
              <div className="quest-detail-labels">
                {quest.labels.map((l) => (
                  <span key={l} className="quest-detail-label-chip">
                    {l}
                  </span>
                ))}
              </div>
            </div>
          )}

          {(quest.cost_usd > 0 || (quest.checkpoints && quest.checkpoints.length > 0)) && (
            <div className="quest-detail-section">
              <div className="quest-detail-section-label">Execution</div>
              {quest.cost_usd > 0 && (
                <div className="quest-detail-cost">
                  Cost · <span className="quest-detail-cost-n">${quest.cost_usd.toFixed(4)}</span>
                </div>
              )}
              {quest.checkpoints && quest.checkpoints.length > 0 && (
                <ol className="quest-detail-checkpoints">
                  {quest.checkpoints.map((cp, i) => (
                    <li key={i} className="quest-detail-checkpoint">
                      <div className="quest-detail-checkpoint-progress">{cp.progress}</div>
                      <div className="quest-detail-checkpoint-meta">
                        {timeAgo(cp.timestamp)} · {cp.steps_used} steps · ${cp.cost_usd.toFixed(4)}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}

          {quest.outcome && (
            <div className="quest-detail-section">
              <div className="quest-detail-section-label">Outcome</div>
              <div className="quest-detail-outcome">
                <span className="quest-detail-outcome-kind">{quest.outcome.kind}</span>
                <span className="quest-detail-outcome-summary">{quest.outcome.summary}</span>
              </div>
            </div>
          )}

          {quest.status !== "done" && quest.status !== "cancelled" && (
            <div className="quest-detail-footer">
              <CloseButton questId={quest.id} onDone={fetchQuests} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Board view shown when no quest is selected.
 *
 * Toolbar — search + filter popover + plus button (opens NewQuestModal).
 * Below: four kanban columns (Todo / In Progress / Blocked / Done).
 * Done is capped to 10 most-recent to keep the column from blowing out
 * after months of work.
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
  newOpen,
  onNewOpenChange,
  view,
  onViewChange,
  sort,
  onSortChange,
}: {
  agentId: string;
  resolvedAgentId: string;
  quests: Quest[];
  allQuests: Quest[];
  scopeFilter: QuestFilter;
  onScopeChange: (next: QuestFilter) => void;
  onCreated: () => void;
  onPick: (id: string) => void;
  newOpen: boolean;
  onNewOpenChange: (next: boolean) => void;
  view: QuestsView;
  onViewChange: (next: QuestsView) => void;
  sort: QuestSort;
  onSortChange: (next: QuestSort) => void;
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
        x.subject.toLowerCase().includes(q) ||
        (x.description ?? "").toLowerCase().includes(q) ||
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

  const columns: Array<{ status: QuestStatus; label: string }> = [
    { status: "pending", label: "Todo" },
    { status: "in_progress", label: "In progress" },
    { status: "blocked", label: "Blocked" },
    { status: "done", label: "Done" },
  ];

  // Bucket the already-sorted source by displayed status. Stable sort
  // means within-column order honors the active sort mode without a
  // secondary pass. Done is capped at the 10 MOST-RECENT regardless of
  // sort mode (Done is a recency archive, not a leaderboard); the chosen
  // sort then orders that 10 for display.
  const grouped: Record<QuestStatus, Quest[]> = useMemo(() => {
    const buckets: Record<QuestStatus, Quest[]> = {
      pending: [],
      in_progress: [],
      blocked: [],
      done: [],
      cancelled: [],
    };
    for (const q of sortedVisibleQuests) {
      const s = optimistic[q.id] ?? q.status;
      buckets[s]?.push(q);
    }
    if (buckets.done.length > 10) {
      const recent = [...buckets.done].sort(byUpdatedDesc).slice(0, 10);
      buckets.done = sortQuests(recent, sort);
    }
    return buckets;
  }, [sortedVisibleQuests, optimistic, sort]);

  // Flat traversal order used by j/k. In Board view: column-major over
  // pending → in_progress → blocked → done (matches reading order).
  // In List view: the flat-sorted order.
  const flatOrderKey = useMemo(() => {
    if (view === "list") {
      return sortedVisibleQuests.map((q) => q.id).join("|");
    }
    const order: QuestStatus[] = ["pending", "in_progress", "blocked", "done"];
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
          <Button
            variant="primary"
            size="sm"
            onClick={() => onNewOpenChange(true)}
            title="New quest (N)"
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
            New
          </Button>
        </div>
      </div>
      {err && <div className="quest-board-error">{err}</div>}

      {view === "list" ? (
        <QuestList
          quests={sortedVisibleQuests}
          optimistic={optimistic}
          focusId={focusId}
          onPick={onPick}
          onNew={() => onNewOpenChange(true)}
          search={search}
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
                  <span className="quest-col-label">{col.label}</span>
                  <span className="quest-col-count">{list.length}</span>
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
                        <div className="quest-card-subject">{q.subject}</div>
                        <div className="quest-card-meta">
                          {q.priority !== "normal" && (
                            <span
                              className={`quest-card-priority quest-card-priority--${q.priority}`}
                            >
                              {PRIORITY_LABELS[q.priority]}
                            </span>
                          )}
                          {q.scope && q.scope !== "self" && <QuestScopeChip scope={q.scope} />}
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
      <NewQuestModal
        open={newOpen}
        resolvedAgentId={resolvedAgentId}
        onClose={() => onNewOpenChange(false)}
        onCreated={onCreated}
      />
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
  quests,
  optimistic,
  focusId,
  onPick,
  onNew,
  search,
}: {
  quests: Quest[];
  optimistic: Record<string, QuestStatus>;
  focusId: string | null;
  onPick: (id: string) => void;
  onNew: () => void;
  search: string;
}) {
  if (quests.length === 0) {
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
      {quests.map((q) => {
        const status = optimistic[q.id] ?? q.status;
        const isFocused = focusId === q.id;
        return (
          <button
            key={q.id}
            type="button"
            className={`ideas-list-row${isFocused ? " focus" : ""}`}
            onClick={() => onPick(q.id)}
          >
            <div className="ideas-list-row-head">
              <StatusDot status={status} />
              <span className="ideas-list-row-name">{q.subject}</span>
              {q.scope && q.scope !== "self" && <QuestScopeChip scope={q.scope} />}
              {q.priority !== "normal" && (
                <span className={`quest-list-row-prio quest-list-row-prio--${q.priority}`}>
                  {PRIORITY_LABELS[q.priority]}
                </span>
              )}
              {q.updated_at && <span className="ideas-list-row-time">{timeAgo(q.updated_at)}</span>}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function NewQuestModal({
  open,
  resolvedAgentId,
  onClose,
  onCreated,
}: {
  open: boolean;
  resolvedAgentId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<QuestPriority>("normal");
  const [scope, setScope] = useState<ScopeValue>("self");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset the form every time the modal opens — so the second creation
  // doesn't inherit the first's subject / priority / scope.
  useEffect(() => {
    if (open) {
      setSubject("");
      setPriority("normal");
      setScope("self");
      setBusy(false);
      setErr(null);
    }
  }, [open]);

  const submit = useCallback(async () => {
    const s = subject.trim();
    if (!s || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await api.createQuest({
        project: resolvedAgentId,
        subject: s,
        priority,
        scope,
        agent_id: resolvedAgentId,
      });
      onCreated();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create quest");
    } finally {
      setBusy(false);
    }
  }, [subject, priority, scope, busy, resolvedAgentId, onCreated, onClose]);

  return (
    <Modal open={open} onClose={onClose} title="New quest">
      <div className="quest-new-form">
        <Input
          label="Subject"
          placeholder="What needs to happen?"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={busy}
          autoFocus
          error={err ?? undefined}
        />
        <div className="quest-new-fields">
          <Select
            value={priority}
            onChange={(v) => setPriority(v as QuestPriority)}
            options={(["critical", "high", "normal", "low"] as QuestPriority[]).map((p) => ({
              value: p,
              label: PRIORITY_LABELS[p],
            }))}
            disabled={busy}
            aria-label="Priority"
          />
          <Select
            value={scope}
            onChange={(v) => setScope(v as ScopeValue)}
            options={QUEST_SCOPE_VALUES.map((s) => ({ value: s, label: s }))}
            disabled={busy}
            aria-label="Scope"
          />
        </div>
        <div className="quest-new-actions">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!subject.trim()} loading={busy}>
            Create
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function CloseButton({ questId, onDone }: { questId: string; onDone: () => void }) {
  const [closing, setClosing] = useState(false);

  const handleClose = async () => {
    setClosing(true);
    try {
      await api.closeQuest(questId);
      onDone();
    } finally {
      setClosing(false);
    }
  };

  return (
    <Button variant="ghost" onClick={handleClose} loading={closing} type="button">
      Mark done
    </Button>
  );
}
