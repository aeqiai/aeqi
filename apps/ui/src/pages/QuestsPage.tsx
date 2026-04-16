import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useDaemonStore } from "@/store/daemon";
import { useChatStore } from "@/store/chat";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Quest, QuestStatus, QuestPriority } from "@/lib/types";
import styles from "./QuestsPage.module.css";

/* ── Icons ───────────────────────────────────────────── */

const STATUS_STYLE: Record<QuestStatus, string> = {
  pending: styles.statusPending,
  in_progress: styles.statusInProgress,
  blocked: styles.statusBlocked,
  done: styles.statusDone,
  cancelled: styles.statusCancelled,
};

function StatusDot({ status }: { status: QuestStatus }) {
  return <span className={STATUS_STYLE[status] || styles.statusDot} />;
}

const PRIORITY_STYLE: Record<QuestPriority, string> = {
  critical: styles.priorityCritical,
  high: styles.priorityHigh,
  normal: styles.priorityNormal,
  low: styles.priorityLow,
};

function PriorityIcon({ priority }: { priority: QuestPriority }) {
  const cls = PRIORITY_STYLE[priority] || styles.priorityIcon;
  if (priority === "critical")
    return (
      <svg className={cls} viewBox="0 0 16 16" fill="none">
        <path d="M8 3v6M8 11.5v1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  if (priority === "high")
    return (
      <svg className={cls} viewBox="0 0 16 16" fill="none">
        <path
          d="M4 10l4-4 4 4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  if (priority === "low")
    return (
      <svg className={cls} viewBox="0 0 16 16" fill="none">
        <path
          d="M4 6l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  // normal — horizontal bars
  return (
    <svg className={cls} viewBox="0 0 16 16" fill="none">
      <path d="M4 6h8M4 10h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/* ── Helpers ──────────────────────────────────────────── */

const STATUS_ORDER: QuestStatus[] = ["in_progress", "pending", "blocked", "done", "cancelled"];

const STATUS_LABELS: Record<QuestStatus, string> = {
  in_progress: "In Progress",
  pending: "Pending",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

interface QuestGroup {
  status: QuestStatus;
  label: string;
  quests: Quest[];
}

/* ── Create Quest Modal ───────────────────────────────── */

interface CreateModalProps {
  open: boolean;
  onClose: () => void;
}

function CreateQuestModal({ open, onClose }: CreateModalProps) {
  const agents = useDaemonStore((s) => s.agents);
  const fetchQuests = useDaemonStore((s) => s.fetchQuests);
  const selectedAgent = useChatStore((s) => s.selectedAgent);

  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<QuestPriority>("normal");
  const [agentName, setAgentName] = useState(selectedAgent?.name || "");
  const [acceptance, setAcceptance] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const subjectRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setSubject("");
      setDescription("");
      setPriority("normal");
      setAgentName(selectedAgent?.name || "");
      setAcceptance("");
      setSubmitting(false);
      setTimeout(() => subjectRef.current?.focus(), 50);
    }
  }, [open, selectedAgent]);

  const handleCreate = async () => {
    if (!subject.trim() || submitting) return;
    setSubmitting(true);
    try {
      await api.createQuest({
        root: agentName || selectedAgent?.name || "default",
        subject: subject.trim(),
        description: description.trim() || undefined,
        priority,
        acceptance_criteria: acceptance.trim() || undefined,
        assignee: agentName || undefined,
      });
      await fetchQuests();
      onClose();
    } catch {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleCreate();
    }
  };

  if (!open) return null;

  const priorities: QuestPriority[] = ["critical", "high", "normal", "low"];

  return (
    <div
      className={styles.modalBackdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={styles.modal} onKeyDown={handleKeyDown}>
        <div className={styles.modalHeader}>New Quest</div>

        <div className={styles.modalBody}>
          <input
            ref={subjectRef}
            className={styles.modalTitleInput}
            placeholder="Quest title"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />

          <textarea
            className={styles.modalDescInput}
            placeholder="Add description..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
          />

          <div className={styles.modalFields}>
            <div className={styles.modalField}>
              <span className={styles.modalFieldLabel}>Priority</span>
              <div className={styles.modalPriorityGroup}>
                {priorities.map((p) => {
                  let btnCls = styles.modalPriorityBtn;
                  if (priority === p) {
                    if (p === "critical") btnCls = styles.modalPriorityBtnActiveCritical;
                    else if (p === "high") btnCls = styles.modalPriorityBtnActiveHigh;
                    else btnCls = styles.modalPriorityBtnActive;
                  }
                  return (
                    <button key={p} className={btnCls} onClick={() => setPriority(p)} type="button">
                      <PriorityIcon priority={p} />
                      <span>{p}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={styles.modalField}>
              <span className={styles.modalFieldLabel}>Assignee</span>
              <select
                className={styles.modalSelect}
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
              >
                <option value="">Unassigned</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.display_name || a.name}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.modalField}>
              <span className={styles.modalFieldLabel}>Acceptance criteria</span>
              <textarea
                className={styles.modalFieldDescInput}
                placeholder="Define what done looks like..."
                value={acceptance}
                onChange={(e) => setAcceptance(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.btnGhost} onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className={styles.btnPrimary}
            onClick={handleCreate}
            disabled={!subject.trim() || submitting}
            type="button"
          >
            {submitting ? "Creating..." : "Create quest"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Quest Row ───────────────────────────────────────── */

function QuestRow({ quest }: { quest: Quest }) {
  const isClosed = quest.status === "done" || quest.status === "cancelled";

  return (
    <div className={isClosed ? styles.rowClosed : styles.row}>
      <div className={styles.rowStatus}>
        <StatusDot status={quest.status} />
      </div>
      <div className={styles.rowPriority}>
        <PriorityIcon priority={quest.priority} />
      </div>
      <div className={styles.rowId}>{quest.id}</div>
      <div className={styles.rowSubject}>
        <span
          className={
            quest.status === "cancelled" ? `${styles.rowTitle} ${styles.struck}` : styles.rowTitle
          }
        >
          {quest.subject}
        </span>
      </div>
      {quest.labels && quest.labels.length > 0 && (
        <div className={styles.rowLabels}>
          {quest.labels.map((l) => (
            <span key={l} className={styles.label}>
              {l}
            </span>
          ))}
        </div>
      )}
      <div className={styles.rowSpacer} />
      {quest.agent_id && <div className={styles.rowAssignee}>{quest.agent_id}</div>}
      <div className={styles.rowTime}>{timeAgo(quest.updated_at || quest.created_at)}</div>
    </div>
  );
}

/* ── Collapsible Group ───────────────────────────────── */

function QuestGroupSection({ group, defaultOpen }: { group: QuestGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  if (group.quests.length === 0) return null;

  return (
    <div className={styles.group}>
      <button className={styles.groupHeader} onClick={() => setOpen((v) => !v)} type="button">
        <svg
          className={open ? styles.groupChevronOpen : styles.groupChevron}
          viewBox="0 0 16 16"
          fill="none"
        >
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <StatusDot status={group.status} />
        <span className={styles.groupLabel}>{group.label}</span>
        <span className={styles.groupCount}>{group.quests.length}</span>
      </button>
      {open && (
        <div className={styles.groupBody}>
          {group.quests.map((q) => (
            <QuestRow key={q.id} quest={q} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Filter Bar ──────────────────────────────────────── */

type ViewFilter = "all" | "active" | "closed";

/* ── Main Page ────────────────────────────────────────── */

export default function QuestsPage() {
  const quests = useDaemonStore((s) => s.quests);
  const agents = useDaemonStore((s) => s.agents);
  const selectedAgent = useChatStore((s) => s.selectedAgent);

  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("active");
  const [modalOpen, setModalOpen] = useState(false);

  // Open modal from aeqi:create event
  useEffect(() => {
    const handler = () => setModalOpen(true);
    window.addEventListener("aeqi:create", handler);
    return () => window.removeEventListener("aeqi:create", handler);
  }, []);

  // Keyboard shortcut: c or Cmd+N
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.key === "c" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setModalOpen(true);
        return;
      }
      if (e.key === "n" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setModalOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Filter
  const filtered = useMemo(() => {
    let result = quests as unknown as Quest[];

    const effectiveAgent = agentFilter || (selectedAgent ? selectedAgent.name : "");
    if (effectiveAgent) {
      result = result.filter((q) => q.agent_id === effectiveAgent);
    }

    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(
        (q) => q.subject?.toLowerCase().includes(term) || q.id?.toLowerCase().includes(term),
      );
    }

    if (viewFilter === "active") {
      result = result.filter((q) => q.status !== "done" && q.status !== "cancelled");
    } else if (viewFilter === "closed") {
      result = result.filter((q) => q.status === "done" || q.status === "cancelled");
    }

    return result;
  }, [quests, agentFilter, selectedAgent, search, viewFilter]);

  // Group by status
  const groups: QuestGroup[] = useMemo(() => {
    const map = new Map<QuestStatus, Quest[]>();
    for (const s of STATUS_ORDER) map.set(s, []);

    for (const q of filtered) {
      const list = map.get(q.status);
      if (list) list.push(q);
      else map.get("pending")!.push(q);
    }

    // Sort within groups: priority desc, then created_at desc
    const priorityWeight: Record<string, number> = { critical: 3, high: 2, normal: 1, low: 0 };
    for (const [, list] of map) {
      list.sort((a, b) => {
        const pw = (priorityWeight[b.priority] ?? 1) - (priorityWeight[a.priority] ?? 1);
        if (pw !== 0) return pw;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    }

    // Limit done/cancelled
    const done = map.get("done")!;
    if (done.length > 20) map.set("done", done.slice(0, 20));
    const cancelled = map.get("cancelled")!;
    if (cancelled.length > 10) map.set("cancelled", cancelled.slice(0, 10));

    return STATUS_ORDER.map((s) => ({
      status: s,
      label: STATUS_LABELS[s],
      quests: map.get(s) || [],
    })).filter((g) => g.quests.length > 0);
  }, [filtered]);

  const totalActive = useMemo(
    () =>
      (quests as unknown as Quest[]).filter((q) => q.status !== "done" && q.status !== "cancelled")
        .length,
    [quests],
  );

  // Stats
  const stats = useMemo(() => {
    const all = quests as unknown as Quest[];
    const inProgress = all.filter((q) => q.status === "in_progress").length;
    const pending = all.filter((q) => q.status === "pending").length;
    const blocked = all.filter((q) => q.status === "blocked").length;
    const completed = all.filter((q) => q.status === "done").length;
    return { total: all.length, inProgress, pending, blocked, completed };
  }, [quests]);

  const openModal = useCallback(() => setModalOpen(true), []);

  const viewFilters: { key: ViewFilter; label: string }[] = [
    { key: "active", label: "Active" },
    { key: "all", label: "All" },
    { key: "closed", label: "Closed" },
  ];

  return (
    <div className={`page-content ${styles.page}`}>
      {/* Actions moved to ContentTopBar — no hero needed */}

      {stats.total > 0 && (
        <>
          {/* Stats */}
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.inProgress}</span>
              <span className={styles.statLabel}>In Progress</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={styles.statValue}>{stats.pending}</span>
              <span className={styles.statLabel}>Pending</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={`${styles.statValue} ${styles.statWarning}`}>{stats.blocked}</span>
              <span className={styles.statLabel}>Blocked</span>
            </div>
            <div className={styles.statDivider} />
            <div className={styles.stat}>
              <span className={`${styles.statValue} ${styles.statSuccess}`}>{stats.completed}</span>
              <span className={styles.statLabel}>Completed</span>
            </div>
          </div>

          {/* Toolbar */}
          <div className={styles.toolbar}>
            <div className={styles.filterTabs}>
              {viewFilters.map((f) => (
                <button
                  key={f.key}
                  className={viewFilter === f.key ? styles.filterTabActive : styles.filterTab}
                  onClick={() => setViewFilter(f.key)}
                  type="button"
                >
                  {f.label}
                  {f.key === "active" && totalActive > 0 && (
                    <span className={styles.filterTabCount}>{totalActive}</span>
                  )}
                </button>
              ))}
            </div>

            <div className={styles.toolbarRight}>
              <div className={styles.searchWrap}>
                <svg className={styles.searchIcon} viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                  <path
                    d="M10.5 10.5L14 14"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
                <input
                  className={styles.search}
                  placeholder="Filter..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              <select
                className={styles.agentFilter}
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
              >
                <option value="">All agents</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.name}>
                    {a.display_name || a.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}

      {/* List */}
      <div className={styles.list}>
        {groups.length === 0 && stats.total === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptyHero}>
              <svg
                width="48"
                height="48"
                viewBox="0 0 48 48"
                fill="none"
                stroke="rgba(0,0,0,0.15)"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <rect x="8" y="8" width="32" height="32" rx="4" />
                <path d="M16 20h16M16 26h10M16 32h6" />
                <path d="M34 18l-6 6-3-3" strokeWidth="2" stroke="rgba(0,0,0,0.3)" />
              </svg>
              <h2
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  color: "rgba(0,0,0,0.85)",
                  margin: "16px 0 6px",
                }}
              >
                No quests yet
              </h2>
              <p
                style={{
                  fontSize: 13,
                  color: "rgba(0,0,0,0.35)",
                  margin: "0 0 20px",
                  maxWidth: 300,
                }}
              >
                Quests are units of work you assign to agents. Create one to get started.
              </p>
              <button
                className={styles.btnPrimary}
                onClick={openModal}
                style={{ padding: "10px 24px" }}
              >
                Create your first quest
              </button>
              <p style={{ fontSize: 11, color: "rgba(0,0,0,0.2)", marginTop: 12 }}>
                or press{" "}
                <kbd
                  style={{
                    fontFamily: "var(--font-mono)",
                    padding: "1px 5px",
                    background: "rgba(0,0,0,0.05)",
                    borderRadius: 4,
                  }}
                >
                  C
                </kbd>
              </p>
            </div>
          </div>
        )}
        {groups.length === 0 && stats.total > 0 && (
          <div className={styles.empty}>
            <span className={styles.emptyText}>No quests</span>
          </div>
        )}
        {groups.map((g) => (
          <QuestGroupSection
            key={g.status}
            group={g}
            defaultOpen={g.status !== "done" && g.status !== "cancelled"}
          />
        ))}
      </div>

      <CreateQuestModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
