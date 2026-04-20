import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { Button } from "./ui";
import type { Quest, QuestStatus, QuestPriority } from "@/lib/types";
import { timeAgo } from "@/lib/format";

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
 * via `/:agentId/quests/:itemId`. When no quest is selected, shows the compose
 * state (create a new one or pick from the right rail).
 */
export default function AgentQuestsTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;

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

  // No quest selected → show the board: inline composer + kanban columns.
  if (!quest) {
    const agentQuests = quests.filter((q) => q.agent_id === agent?.id);
    return (
      <QuestBoard
        agentId={agentId}
        resolvedAgentId={agent?.id || agentId}
        quests={agentQuests}
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
    <div className="asv-main" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header bar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 20px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
          minHeight: 40,
        }}
      >
        <StatusDot status={quest.status} />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-2xs)",
            color: "var(--text-muted)",
          }}
        >
          {quest.id}
        </span>
        {saveIndicator && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: "var(--font-size-2xs)",
              color:
                saveState === "error"
                  ? "var(--error)"
                  : saveState === "saved"
                    ? "var(--success)"
                    : "var(--text-muted)",
            }}
          >
            {saveIndicator}
          </span>
        )}
        {quest.updated_at && !saveIndicator && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: "var(--font-size-2xs)",
              color: "var(--text-muted)",
            }}
          >
            {timeAgo(quest.updated_at)}
          </span>
        )}
      </div>

      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px", minHeight: 0 }}>
        {error && (
          <div
            style={{
              marginBottom: 12,
              padding: "6px 10px",
              borderRadius: 4,
              background: "rgba(239,68,68,0.08)",
              color: "var(--error)",
              fontSize: "var(--font-size-xs)",
            }}
          >
            {error}
          </div>
        )}

        {/* Title (read-only) */}
        <h2
          style={{
            fontSize: "var(--font-size-lg)",
            fontWeight: 600,
            color: "var(--text-primary)",
            margin: "0 0 16px",
            lineHeight: 1.3,
          }}
        >
          {quest.subject}
        </h2>

        {/* Meta row: status + priority selectors */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginBottom: 20,
            flexWrap: "wrap",
          }}
        >
          <FieldRow label="Status">
            <select
              value={status}
              onChange={(e) => handleStatusChange(e.target.value as QuestStatus)}
              style={selectStyle}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </FieldRow>

          <FieldRow label="Priority">
            <select
              value={priority}
              onChange={(e) => handlePriorityChange(e.target.value as QuestPriority)}
              style={selectStyle}
            >
              {priorities.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </FieldRow>
        </div>

        {/* Description edit */}
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: 600,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              marginBottom: 6,
            }}
          >
            Description
          </div>
          <textarea
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
            style={{
              width: "100%",
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-primary)",
              fontFamily: "var(--font-sans)",
              fontSize: "var(--font-size-sm)",
              lineHeight: 1.6,
              padding: "8px 12px",
              outline: "none",
              resize: "vertical",
              transition: "border-color var(--transition-fast)",
              boxSizing: "border-box",
            }}
            onFocus={(e) => {
              (e.target as HTMLTextAreaElement).style.borderColor = "var(--border-hover)";
            }}
            onBlurCapture={(e) => {
              (e.target as HTMLTextAreaElement).style.borderColor = "var(--border)";
            }}
          />
        </div>

        {/* Acceptance criteria (read-only if set) */}
        {quest.acceptance_criteria && (
          <div style={{ marginBottom: 20 }}>
            <div style={sectionLabel}>Acceptance Criteria</div>
            <div
              style={{
                fontSize: "var(--font-size-sm)",
                color: "var(--text-secondary)",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {quest.acceptance_criteria}
            </div>
          </div>
        )}

        {/* Worktree path */}
        {quest.worktree_path && (
          <div style={{ marginBottom: 20 }}>
            <div style={sectionLabel}>Worktree Path</div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--font-size-xs)",
                color: "var(--text-secondary)",
                background: "var(--bg-elevated)",
                padding: "6px 10px",
                borderRadius: "var(--radius-md)",
                wordBreak: "break-all",
              }}
            >
              {quest.worktree_path}
            </div>
            {quest.worktree_branch && (
              <div
                style={{
                  marginTop: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--font-size-xs)",
                  color: "var(--text-muted)",
                }}
              >
                branch: {quest.worktree_branch}
              </div>
            )}
          </div>
        )}

        {/* Labels */}
        {quest.labels && quest.labels.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={sectionLabel}>Labels</div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
              {quest.labels.map((l) => (
                <span
                  key={l}
                  style={{
                    fontFamily: "var(--font-sans)",
                    fontSize: "var(--font-size-2xs)",
                    padding: "2px 8px",
                    borderRadius: "var(--radius-full)",
                    background: "var(--bg-elevated)",
                    color: "var(--text-secondary)",
                    border: "1px solid var(--border)",
                  }}
                >
                  {l}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Cost + checkpoints */}
        {(quest.cost_usd > 0 || (quest.checkpoints && quest.checkpoints.length > 0)) && (
          <div style={{ marginBottom: 20 }}>
            <div style={sectionLabel}>Execution</div>
            {quest.cost_usd > 0 && (
              <div
                style={{
                  fontSize: "var(--font-size-xs)",
                  color: "var(--text-secondary)",
                  marginBottom: 6,
                }}
              >
                Cost:{" "}
                <span style={{ fontFamily: "var(--font-mono)" }}>${quest.cost_usd.toFixed(4)}</span>
              </div>
            )}
            {quest.checkpoints && quest.checkpoints.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                {quest.checkpoints.map((cp, i) => (
                  <div
                    key={i}
                    style={{
                      padding: "6px 10px",
                      borderRadius: "var(--radius-md)",
                      background: "var(--bg-elevated)",
                      fontSize: "var(--font-size-xs)",
                      color: "var(--text-secondary)",
                      borderLeft: "2px solid var(--border)",
                    }}
                  >
                    <div style={{ color: "var(--text-primary)", marginBottom: 2 }}>
                      {cp.progress}
                    </div>
                    <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                      {timeAgo(cp.timestamp)} · {cp.steps_used} steps · ${cp.cost_usd.toFixed(4)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Outcome */}
        {quest.outcome && (
          <div style={{ marginBottom: 20 }}>
            <div style={sectionLabel}>Outcome</div>
            <div
              style={{
                padding: "8px 12px",
                borderRadius: "var(--radius-md)",
                background: "var(--bg-elevated)",
                fontSize: "var(--font-size-sm)",
                color: "var(--text-secondary)",
                lineHeight: 1.6,
              }}
            >
              <span
                style={{
                  display: "inline-block",
                  marginRight: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--font-size-xs)",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                }}
              >
                {quest.outcome.kind}
              </span>
              {quest.outcome.summary}
            </div>
          </div>
        )}

        {/* Danger zone — close/cancel */}
        {quest.status !== "done" && quest.status !== "cancelled" && (
          <div
            style={{
              marginTop: 32,
              paddingTop: 16,
              borderTop: "1px solid var(--border)",
              display: "flex",
              gap: 8,
            }}
          >
            <CloseButton questId={quest.id} onDone={fetchQuests} />
          </div>
        )}
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span
        style={{
          fontSize: "var(--font-size-xs)",
          color: "var(--text-muted)",
          minWidth: 52,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  padding: "3px 8px",
  background: "var(--bg-elevated)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--text-primary)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--font-size-xs)",
  outline: "none",
  cursor: "pointer",
};

const sectionLabel: React.CSSProperties = {
  fontSize: "var(--font-size-xs)",
  fontWeight: 600,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginBottom: 6,
};

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
  onCreated,
  onPick,
}: {
  agentId: string;
  resolvedAgentId: string;
  quests: Quest[];
  onCreated: () => void;
  onPick: (id: string) => void;
}) {
  const [subject, setSubject] = useState("");
  const [priority, setPriority] = useState<QuestPriority>("normal");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
        agent_id: resolvedAgentId,
      });
      setSubject("");
      setPriority("normal");
      onCreated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create quest");
    } finally {
      setBusy(false);
    }
  }, [subject, priority, busy, resolvedAgentId, onCreated]);

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
  for (const q of quests) grouped[q.status]?.push(q);
  // Sort each column: most recent updated_at first.
  for (const k of Object.keys(grouped) as QuestStatus[]) {
    grouped[k].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  }
  // Cap Done at 10 to keep visual weight balanced.
  grouped.done = grouped.done.slice(0, 10);

  return (
    <div className="quest-board">
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
        <Button variant="primary" size="sm" onClick={submit} disabled={!subject.trim() || busy}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
      {err && <div className="quest-board-error">{err}</div>}

      <div className="quest-board-columns">
        {columns.map((col) => {
          const list = grouped[col.status] || [];
          return (
            <section key={col.status} className="quest-col" data-status={col.status}>
              <header className="quest-col-header">
                <span className="quest-col-label">{col.label}</span>
                <span className="quest-col-count">{list.length}</span>
              </header>
              <div className="quest-col-body">
                {list.length === 0 ? (
                  <div className="quest-col-empty">Nothing here</div>
                ) : (
                  list.map((q) => (
                    <article
                      key={q.id}
                      className="quest-card"
                      data-priority={q.priority}
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
