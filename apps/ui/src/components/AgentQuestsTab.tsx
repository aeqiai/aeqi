import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { Button } from "./ui";
import type { Quest, QuestStatus, QuestPriority, ScopeValue } from "@/lib/types";
import { timeAgo } from "@/lib/format";

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

function QuestScopeFilterBar({
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

  return (
    <div className="primitive-scope-tabs" role="tablist" aria-label="Scope">
      {QUEST_FILTER_VALUES.map((s) => {
        const isEmpty = counts[s] === 0;
        return (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={filter === s}
            className={`primitive-scope-tab${filter === s ? " active" : ""}${isEmpty && filter !== s ? " empty" : ""}`}
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

type SaveState = "idle" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 700;
const SAVED_FLASH_MS = 1400;

const STATUS_LABELS: Record<QuestStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

const STATUS_COLOR: Record<QuestStatus, string> = {
  pending: "var(--text-muted)",
  in_progress: "var(--info)",
  blocked: "var(--warning)",
  done: "var(--success)",
  cancelled: "var(--text-muted)",
};

const PRIORITY_LABELS: Record<QuestPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

function StatusDot({ status }: { status: QuestStatus }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: status === "pending" ? "transparent" : STATUS_COLOR[status],
        border: status === "pending" ? `1.5px solid var(--text-muted)` : "none",
        flexShrink: 0,
      }}
    />
  );
}

/**
 * Quest detail canvas. Shown in the `.asv-main` region when a quest is selected
 * via `/:agentId/quests/:itemId`. When no quest is selected, shows the kanban
 * board (`QuestBoard`) with an inline composer and the full column grid.
 */
export default function AgentQuestsTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;
  const [questFilter, setQuestFilter] = useState<QuestFilter>("all");

  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const fetchQuests = useDaemonStore((s) => s.fetchQuests);

  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const quest = selectedId ? quests.find((q) => q.id === selectedId) : undefined;

  const [description, setDescription] = useState(quest?.description ?? "");
  const [status, setStatus] = useState<QuestStatus>(quest?.status ?? "pending");
  const [priority, setPriority] = useState<QuestPriority>(quest?.priority ?? "normal");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<number | null>(null);
  const flashRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const latestRef = useRef({ description, status, priority });
  latestRef.current = { description, status, priority };

  // Reset state when quest selection changes.
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
      setSaveState("saved");
      dirtyRef.current = false;
      if (flashRef.current) clearTimeout(flashRef.current);
      flashRef.current = window.setTimeout(() => setSaveState("idle"), SAVED_FLASH_MS);
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

  // "New quest" rail action: focus the inline composer when the rail's
  // create button fires. Navigating away from any selection takes us to the
  // board view where the composer lives.
  useEffect(() => {
    const handler = () => {
      goAgent(agentId, "quests", undefined, { replace: true });
      requestAnimationFrame(() => {
        document.querySelector<HTMLInputElement>("[data-quest-compose-subject]")?.focus();
      });
    };
    window.addEventListener("aeqi:create", handler);
    return () => window.removeEventListener("aeqi:create", handler);
  }, [agentId, goAgent]);

  // No quest selected → show the board: scope filter + inline composer + kanban columns.
  if (!quest) {
    // All quests visible to this agent (agent's own + any cross-agent ones surfaced by API).
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
      />
    );
  }

  const saveIndicator =
    saveState === "saving"
      ? "Saving…"
      : saveState === "saved"
        ? "Saved"
        : saveState === "error"
          ? "Error"
          : null;

  const statuses: QuestStatus[] = ["pending", "in_progress", "blocked", "done", "cancelled"];
  const priorities: QuestPriority[] = ["critical", "high", "normal", "low"];

  return (
    <div className="asv-main quest-detail">
      <div className="quest-detail-topbar">
        <StatusDot status={quest.status} />
        <span className="quest-detail-id">{quest.id}</span>
        {saveIndicator && (
          <span className={`quest-detail-save state-${saveState}`}>{saveIndicator}</span>
        )}
        {quest.updated_at && !saveIndicator && (
          <span className="quest-detail-updated">{timeAgo(quest.updated_at)}</span>
        )}
      </div>

      <div className="quest-detail-scroll">
        <div className="quest-detail-col">
          {error && <div className="quest-detail-error">{error}</div>}

          <div className="quest-detail-eyebrow">
            <span className="quest-detail-eyebrow-kind">Quest</span>
            <span className="quest-detail-eyebrow-sep" aria-hidden>
              ·
            </span>
            <span className="quest-detail-eyebrow-status">{STATUS_LABELS[quest.status]}</span>
          </div>

          <h2 className="quest-detail-title">{quest.subject}</h2>

          <div className="quest-detail-meta">
            <label className="quest-detail-meta-field">
              <span className="quest-detail-meta-label">Status</span>
              <select
                className="quest-detail-select"
                value={status}
                onChange={(e) => handleStatusChange(e.target.value as QuestStatus)}
              >
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="quest-detail-meta-field">
              <span className="quest-detail-meta-label">Priority</span>
              <select
                className="quest-detail-select"
                value={priority}
                onChange={(e) => handlePriorityChange(e.target.value as QuestPriority)}
              >
                {priorities.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </label>
          </div>

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
 * Top: inline composer — subject + priority + create. Submit POSTs the
 * quest and refreshes the daemon store. Below: four kanban columns
 * (Todo / In Progress / Blocked / Done). Done is capped to 10 most-recent
 * to keep the column from blowing out after months of work.
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
}: {
  agentId: string;
  resolvedAgentId: string;
  quests: Quest[];
  allQuests: Quest[];
  scopeFilter: QuestFilter;
  onScopeChange: (next: QuestFilter) => void;
  onCreated: () => void;
  onPick: (id: string) => void;
}) {
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<QuestPriority>("normal");
  const [composeScope, setComposeScope] = useState<ScopeValue>("self");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
        scope: composeScope,
        agent_id: resolvedAgentId,
      });
      setSubject("");
      setPriority("normal");
      setComposeScope("self");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create quest");
    } finally {
      setBusy(false);
    }
  }, [subject, priority, composeScope, busy, resolvedAgentId, onCreated]);

  const columns: Array<{ status: QuestStatus; label: string }> = [
    { status: "pending", label: "Todo" },
    { status: "in_progress", label: "In progress" },
    { status: "blocked", label: "Blocked" },
    { status: "done", label: "Done" },
  ];

  const grouped: Record<QuestStatus, Quest[]> = {
    pending: [],
    in_progress: [],
    blocked: [],
    done: [],
    cancelled: [],
  };
  for (const q of quests) {
    const status = optimistic[q.id] ?? q.status;
    grouped[status]?.push(q);
  }
  // Sort each column: most recent updated_at first.
  for (const k of Object.keys(grouped) as QuestStatus[]) {
    grouped[k].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  }
  // Cap Done at 10 to keep visual weight balanced.
  grouped.done = grouped.done.slice(0, 10);

  // Flat traversal order used by j/k — column-major, top-to-bottom within a
  // column, left-to-right across columns. Matches the visual reading order so
  // j always moves "down then right" and k always moves "up then left".
  // Memoized on the raw inputs (not on `grouped`, which is a fresh reference
  // every render) so the effect below only re-runs when membership actually
  // changes.
  const flatOrderKey = useMemo(() => {
    const order: QuestStatus[] = ["pending", "in_progress", "blocked", "done"];
    const buckets: Record<QuestStatus, Quest[]> = {
      pending: [],
      in_progress: [],
      blocked: [],
      done: [],
      cancelled: [],
    };
    for (const q of quests) {
      const s = optimistic[q.id] ?? q.status;
      buckets[s]?.push(q);
    }
    for (const s of order) {
      buckets[s].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    }
    buckets.done = buckets.done.slice(0, 10);
    const ids: string[] = [];
    for (const s of order) for (const q of buckets[s]) ids.push(q.id);
    return ids.join("|");
  }, [quests, optimistic]);
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
  }, [focusId, onPick]);

  return (
    <div className="quest-board">
      <div className="quest-board-head">
        <QuestScopeFilterBar
          agentId={resolvedAgentId}
          quests={allQuests}
          filter={scopeFilter}
          onChange={onScopeChange}
        />
      </div>
      <div className="quest-board-compose">
        <input
          data-quest-compose-subject
          className="quest-board-compose-input"
          placeholder="New quest — what needs to happen?"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={busy}
        />
        <select
          className="quest-board-compose-priority"
          value={priority}
          onChange={(e) => setPriority(e.target.value as QuestPriority)}
          disabled={busy}
        >
          {(["critical", "high", "normal", "low"] as QuestPriority[]).map((p) => (
            <option key={p} value={p}>
              {PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
        <select
          className="scope-select"
          value={composeScope}
          onChange={(e) => setComposeScope(e.target.value as ScopeValue)}
          disabled={busy}
          aria-label="Scope"
          title="Scope"
        >
          {QUEST_SCOPE_VALUES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <Button variant="primary" size="sm" onClick={submit} disabled={!subject.trim() || busy}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
      {err && <div className="quest-board-error">{err}</div>}

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
    </div>
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
