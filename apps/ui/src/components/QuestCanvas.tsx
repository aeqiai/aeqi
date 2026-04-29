import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useNav } from "@/hooks/useNav";
import { useAgentIdeas } from "@/queries/ideas";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import type { Idea, Quest, QuestPriority, QuestStatus, ScopeValue, User } from "@/lib/types";
import { Button, CardTrigger, Popover, Spinner, Tooltip } from "./ui";
import { Events, useTrack } from "@/lib/analytics";
import IdeaCanvas, { type IdeaCanvasHandle } from "./IdeaCanvas";
import QuestStatusPopover from "./quests/QuestStatusPopover";
import QuestPriorityPopover from "./quests/QuestPriorityPopover";
import IdeasScopePopover from "./ideas/IdeasScopePopover";
import AssigneeAvatar from "./quests/AssigneeAvatar";
import AssigneePicker from "./quests/AssigneePicker";

const QUEST_STATUS_VALUES: QuestStatus[] = ["backlog", "todo", "in_progress", "done", "cancelled"];

function parseQuestStatus(raw: string | null): QuestStatus | null {
  return raw && QUEST_STATUS_VALUES.includes(raw as QuestStatus) ? (raw as QuestStatus) : null;
}

/**
 * Single canonical surface for a quest — used for both `/<agentId>/quests/new`
 * (compose) and `/<agentId>/quests/<id>` (view + edit). Same toolbar in
 * both modes: status / priority / assignee / scope are always present and
 * always editable, mirroring the idea-canvas model where the create and
 * edit surfaces are the same component.
 *
 * Persistence:
 * - **compose** — every field stays client-side until Save. Save calls
 *   `canvas.commit()` to mint / update the linked idea, creates the quest,
 *   then patches lifecycle fields (since the IPC create path uses defaults)
 *   in one round-trip and navigates to the resulting `/quests/:id`.
 * - **view** — body changes go through the explicit Save button (Idea
 *   commit). Lifecycle popovers (status / priority / assignee / scope)
 *   auto-save through `api.updateQuest` with a debounced batch so the
 *   user gets instant feedback without a Save click.
 */
type QuestCanvasMode =
  | { kind: "compose"; agentId: string; resolvedAgentId: string }
  | { kind: "view"; agentId: string; resolvedAgentId: string; quest: Quest };

export default function QuestCanvas(props: QuestCanvasMode) {
  return props.kind === "compose" ? <ComposeCanvas {...props} /> : <ViewCanvas {...props} />;
}

// ─────────────────────────────────────────────────────────────────────
//  Shared toolbar — same chrome, same affordances, same field order in
//  both modes. Only the buttons that don't apply to the mode (linked-
//  idea picker, save-state spinner) get hidden.
// ─────────────────────────────────────────────────────────────────────
function QuestToolbar({
  agentId,
  agents,
  users,
  status,
  priority,
  assignee,
  scope,
  saving,
  cancelLabel,
  cancelTitle,
  saveLabel,
  saveTitle,
  saveDisabled,
  showCancelSave,
  onStatusChange,
  onPriorityChange,
  onAssigneeChange,
  onScopeChange,
  onBack,
  onNew,
  onCancel,
  onSave,
  linkedIdeaSlot,
  trailingSlot,
}: {
  agentId: string;
  agents: { id: string; name: string }[];
  users: Pick<User, "id" | "name" | "email" | "avatar_url">[];
  status: QuestStatus;
  priority: QuestPriority;
  assignee: string | null;
  scope: ScopeValue;
  saving: boolean;
  cancelLabel: string;
  cancelTitle: string;
  saveLabel: string;
  saveTitle: string;
  saveDisabled: boolean;
  showCancelSave: boolean;
  onStatusChange: (next: QuestStatus) => void;
  onPriorityChange: (next: QuestPriority) => void;
  onAssigneeChange: (next: string | null) => void;
  onScopeChange: (next: ScopeValue) => void;
  onBack: () => void;
  onNew?: () => void;
  onCancel: () => void;
  onSave: () => void;
  linkedIdeaSlot?: React.ReactNode;
  trailingSlot?: React.ReactNode;
}) {
  void agentId;
  return (
    <div className="ideas-toolbar ideas-canvas-toolbar">
      <Tooltip content="Back to quests">
        <Button variant="secondary" size="sm" onClick={onBack}>
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
      </Tooltip>
      {onNew && (
        <Tooltip content="New quest (N)">
          <Button variant="primary" size="sm" onClick={onNew}>
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
        </Tooltip>
      )}
      {linkedIdeaSlot}
      <QuestStatusPopover status={status} onChange={onStatusChange} />
      <QuestPriorityPopover priority={priority} onChange={onPriorityChange} />
      <AssigneePicker
        assignee={assignee}
        agents={agents}
        users={users}
        onChange={onAssigneeChange}
        renderTrigger={({ open, display }) => (
          <Button
            variant="secondary"
            size="sm"
            className={`ideas-scope-btn quest-assignee-btn${open ? " open" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            title={display ? `Assigned to ${display.name}` : "Unassigned"}
          >
            <AssigneeAvatar assignee={assignee} agents={agents} users={users} size={16} />
            <span className="quest-assignee-btn-name">{display?.name ?? "Unassigned"}</span>
            <svg
              className="ideas-scope-btn-chevron"
              width="9"
              height="9"
              viewBox="0 0 9 9"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M2 3.5 L4.5 6 L7 3.5" />
            </svg>
          </Button>
        )}
      />
      <IdeasScopePopover scope={scope} onChange={onScopeChange} />
      {trailingSlot}
      <div className="ideas-toolbar-spacer" aria-hidden />
      {saving && (
        <span className="quest-detail-savestate">
          <Spinner size="sm" /> Saving
        </span>
      )}
      {showCancelSave && (
        <>
          <Tooltip content={cancelTitle}>
            <Button variant="secondary" size="sm" onClick={onCancel}>
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
                <path d="M3.2 3.2 L9.8 9.8 M9.8 3.2 L3.2 9.8" />
              </svg>
              {cancelLabel}
            </Button>
          </Tooltip>
          <Tooltip content={saveTitle}>
            <Button variant="primary" size="sm" onClick={onSave} disabled={saveDisabled}>
              <svg
                width="11"
                height="11"
                viewBox="0 0 13 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M2.8 6.6 L5.4 9.2 L10.2 4" />
              </svg>
              {saveLabel}
            </Button>
          </Tooltip>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Compose mode
// ─────────────────────────────────────────────────────────────────────
function ComposeCanvas({ agentId, resolvedAgentId }: { agentId: string; resolvedAgentId: string }) {
  const { goAgent } = useNav();
  const [searchParams] = useSearchParams();
  const track = useTrack();
  const fromIdeaId = searchParams.get("fromIdea") ?? null;
  const presetName = searchParams.get("name") ?? "";
  const presetStatus = parseQuestStatus(searchParams.get("status"));

  const { data: ideas = [] } = useAgentIdeas(resolvedAgentId);
  const allQuests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const fetchQuests = useDaemonStore((s) => s.fetchQuests);
  const agents = useDaemonStore((s) => s.agents);
  const currentUser = useAuthStore((s) => s.user);
  const assigneeUsers = useMemo<Pick<User, "id" | "name" | "email" | "avatar_url">[]>(
    () =>
      currentUser
        ? [
            {
              id: currentUser.id,
              name: currentUser.name,
              email: currentUser.email,
              avatar_url: currentUser.avatar_url,
            },
          ]
        : [],
    [currentUser],
  );

  const [pinnedIdea, setPinnedIdea] = useState<Idea | null>(null);
  const [status, setStatus] = useState<QuestStatus>(presetStatus ?? "todo");
  const [priority, setPriority] = useState<QuestPriority>("normal");
  const [assignee, setAssignee] = useState<string | null>(null);
  const [scope, setScope] = useState<ScopeValue>("self");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [canSave, setCanSave] = useState(false);

  const canvasRef = useRef<IdeaCanvasHandle | null>(null);

  useEffect(() => {
    if (!fromIdeaId) {
      setPinnedIdea(null);
      return;
    }
    const found = ideas.find((i) => i.id === fromIdeaId);
    if (found) setPinnedIdea(found);
  }, [fromIdeaId, ideas]);

  const cancel = useCallback(() => {
    goAgent(agentId, "quests", undefined, { replace: true });
  }, [agentId, goAgent]);

  const submit = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const handle = canvasRef.current;
      if (!handle) throw new Error("editor not ready");
      const ideaId = await handle.commit();
      const res = await api.createQuest({
        project: resolvedAgentId,
        agent_id: resolvedAgentId,
        priority,
        scope,
        idea_id: ideaId,
      });
      const newId = res?.quest?.id;
      if (newId) track(Events.QuestCreated, { surface: "quest-canvas", priority, scope });
      // The IPC create path uses defaults for status / assignee and
      // ignores priority/scope on the legacy SQL insert path. Patch
      // the freshly minted quest with whatever the user actually
      // staged in the toolbar — one round-trip, all fields land
      // before navigation completes.
      if (newId) {
        try {
          await api.updateQuest(newId, { status, priority, scope, assignee });
        } catch {
          /* non-fatal — quest exists, just sits at IPC defaults */
        }
      }
      await fetchQuests();
      goAgent(agentId, "quests", newId ?? undefined, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create quest");
      setBusy(false);
    }
  }, [
    busy,
    status,
    priority,
    assignee,
    scope,
    resolvedAgentId,
    fetchQuests,
    goAgent,
    agentId,
    track,
  ]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (!canSave || busy) return;
        e.preventDefault();
        e.stopPropagation();
        void submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [submit, cancel, canSave, busy]);

  const canvasKey = pinnedIdea?.id ?? "compose";

  return (
    <IdeaCanvas
      ref={canvasRef}
      key={canvasKey}
      agentId={resolvedAgentId}
      idea={pinnedIdea ?? undefined}
      initialName={!pinnedIdea ? presetName : undefined}
      onBack={cancel}
      onNew={cancel}
      onPersisted={() => {
        /* parent submit() chains the quest-create itself */
      }}
      onCanCommitChange={setCanSave}
      headerSlot={
        <QuestToolbar
          agentId={agentId}
          agents={agents}
          users={assigneeUsers}
          status={status}
          priority={priority}
          assignee={assignee}
          scope={scope}
          saving={busy}
          cancelLabel="Cancel"
          cancelTitle="Discard new quest"
          saveLabel="Save"
          saveTitle={canSave ? "Create quest (⌘↵)" : "Write something to save"}
          saveDisabled={!canSave || busy}
          showCancelSave={true}
          onStatusChange={setStatus}
          onPriorityChange={setPriority}
          onAssigneeChange={setAssignee}
          onScopeChange={setScope}
          onBack={cancel}
          onCancel={cancel}
          onSave={submit}
          linkedIdeaSlot={
            <LinkedIdeaPicker
              ideas={ideas}
              quests={allQuests}
              pinnedIdea={pinnedIdea}
              onPick={(idea) => setPinnedIdea(idea)}
              onUnpin={() => setPinnedIdea(null)}
            />
          }
          trailingSlot={err ? <span className="quest-compose-err">{err}</span> : undefined}
        />
      }
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
//  View / edit mode
// ─────────────────────────────────────────────────────────────────────
type SaveState = "idle" | "saving" | "error";

function ViewCanvas({
  agentId,
  resolvedAgentId,
  quest,
}: {
  agentId: string;
  resolvedAgentId: string;
  quest: Quest;
}) {
  const { goAgent } = useNav();
  const fetchQuests = useDaemonStore((s) => s.fetchQuests);
  const agents = useDaemonStore((s) => s.agents);
  const currentUser = useAuthStore((s) => s.user);
  const assigneeUsers = useMemo<Pick<User, "id" | "name" | "email" | "avatar_url">[]>(
    () =>
      currentUser
        ? [
            {
              id: currentUser.id,
              name: currentUser.name,
              email: currentUser.email,
              avatar_url: currentUser.avatar_url,
            },
          ]
        : [],
    [currentUser],
  );

  const [status, setStatus] = useState<QuestStatus>(quest.status);
  const [priority, setPriority] = useState<QuestPriority>(quest.priority);
  const [assignee, setAssignee] = useState<string | null>(quest.assignee ?? null);
  const [scope, setScope] = useState<ScopeValue>(quest.scope ?? "self");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [bodyDirty, setBodyDirty] = useState(false);

  const debounceRef = useRef<number | null>(null);
  const canvasRef = useRef<IdeaCanvasHandle | null>(null);
  const lifecycleRef = useRef({ status, priority, assignee, scope });
  lifecycleRef.current = { status, priority, assignee, scope };

  // Re-sync on quest swap (navigation between quests reuses this
  // component) so popovers reflect the new row's persisted values.
  useEffect(() => {
    setStatus(quest.status);
    setPriority(quest.priority);
    setAssignee(quest.assignee ?? null);
    setScope(quest.scope ?? "self");
    setSaveState("idle");
  }, [quest.id, quest.status, quest.priority, quest.assignee, quest.scope]);

  const persistLifecycle = useCallback(async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveState("saving");
    try {
      const { status: s, priority: p, assignee: a, scope: sc } = lifecycleRef.current;
      await api.updateQuest(quest.id, {
        status: s,
        priority: p,
        assignee: a,
        scope: sc,
      });
      await fetchQuests();
      setSaveState("idle");
    } catch {
      setSaveState("error");
    }
  }, [quest.id, fetchQuests]);

  const scheduleLifecycleSave = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(persistLifecycle, 200);
  }, [persistLifecycle]);

  const handleSaveBody = useCallback(async () => {
    const handle = canvasRef.current;
    if (!handle) return;
    try {
      await handle.commit();
    } catch {
      /* canvas surfaces its own error inline */
    }
  }, []);

  const handleRevertBody = useCallback(() => {
    canvasRef.current?.revert();
  }, []);

  if (!quest.idea) {
    return (
      <div className="asv-main">
        <div className="quest-detail-error">
          Couldn&apos;t load this quest&apos;s linked idea. The quest itself is fine; refresh in a
          moment.
        </div>
      </div>
    );
  }

  return (
    <IdeaCanvas
      ref={canvasRef}
      agentId={quest.agent_id ?? resolvedAgentId}
      idea={quest.idea}
      onBack={() => goAgent(agentId, "quests", undefined, { replace: true })}
      onNew={() => goAgent(agentId, "quests", "new", { replace: false })}
      onDirtyChange={setBodyDirty}
      headerSlot={
        <QuestToolbar
          agentId={agentId}
          agents={agents}
          users={assigneeUsers}
          status={status}
          priority={priority}
          assignee={assignee}
          scope={scope}
          saving={saveState === "saving"}
          cancelLabel="Cancel"
          cancelTitle="Revert unsaved changes"
          saveLabel="Save"
          saveTitle="Save (⌘↵)"
          saveDisabled={false}
          showCancelSave={bodyDirty}
          onStatusChange={(next) => {
            setStatus(next);
            scheduleLifecycleSave();
          }}
          onPriorityChange={(next) => {
            setPriority(next);
            scheduleLifecycleSave();
          }}
          onAssigneeChange={(next) => {
            setAssignee(next);
            scheduleLifecycleSave();
          }}
          onScopeChange={(next) => {
            setScope(next);
            scheduleLifecycleSave();
          }}
          onBack={() => goAgent(agentId, "quests", undefined, { replace: true })}
          onNew={() => goAgent(agentId, "quests", "new", { replace: false })}
          onCancel={handleRevertBody}
          onSave={handleSaveBody}
          trailingSlot={
            quest.sibling_quest_ids && quest.sibling_quest_ids.length > 0 ? (
              <span
                className="quest-detail-shared-badge"
                title={`This idea is also tracked by ${quest.sibling_quest_ids.length} other quest${quest.sibling_quest_ids.length === 1 ? "" : "s"}`}
              >
                Shared spec · {quest.sibling_quest_ids.length + 1} quests
              </span>
            ) : undefined
          }
        />
      }
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
//  LinkedIdeaPicker — compose-only. The trigger reads the pinned idea's
//  name (or "New idea") with a chevron; the popover hosts a search +
//  list with per-idea quest counts. Detach falls back to fresh-compose.
// ─────────────────────────────────────────────────────────────────────
function LinkedIdeaPicker({
  ideas,
  quests,
  pinnedIdea,
  onPick,
  onUnpin,
}: {
  ideas: Idea[];
  quests: Quest[];
  pinnedIdea: Idea | null;
  onPick: (idea: Idea) => void;
  onUnpin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const questCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const q of quests) {
      if (q.idea_id) counts.set(q.idea_id, (counts.get(q.idea_id) ?? 0) + 1);
    }
    return counts;
  }, [quests]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? ideas.filter((i) => i.name.toLowerCase().includes(q)) : ideas;
    return list.slice(0, 12);
  }, [ideas, query]);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      trigger={
        <Button
          variant="secondary"
          size="sm"
          className={`quest-compose-link${pinnedIdea ? " is-pinned" : ""}${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={pinnedIdea ? `Linked idea: ${pinnedIdea.name}` : "Composing a new idea"}
        >
          {pinnedIdea && <span className="quest-compose-link-prefix">Idea ·</span>}
          <span className="quest-compose-link-label">
            {pinnedIdea ? pinnedIdea.name : "New idea"}
          </span>
          <svg
            className="quest-compose-link-chevron"
            width="9"
            height="9"
            viewBox="0 0 9 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M2 3.5 L4.5 6 L7 3.5" />
          </svg>
        </Button>
      }
    >
      <div className="quest-compose-picker" role="dialog" aria-label="Pick a linked idea">
        <input
          type="search"
          className="quest-compose-picker-search"
          placeholder="Search ideas…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div className="quest-compose-picker-list">
          {filtered.length === 0 && (
            <div className="quest-compose-picker-empty">No matching ideas.</div>
          )}
          {filtered.map((idea) => {
            const count = questCounts.get(idea.id) ?? 0;
            const isPinned = pinnedIdea?.id === idea.id;
            return (
              <CardTrigger
                key={idea.id}
                className={`quest-compose-picker-row${isPinned ? " is-active" : ""}`}
                onClick={() => {
                  onPick(idea);
                  setOpen(false);
                  setQuery("");
                }}
                aria-label={`Select idea: ${idea.name}`}
              >
                <span className="quest-compose-picker-name">{idea.name}</span>
                {count > 0 && (
                  <span className="quest-compose-picker-meta">
                    · {count} quest{count === 1 ? "" : "s"}
                  </span>
                )}
              </CardTrigger>
            );
          })}
        </div>
        <div className="quest-compose-picker-foot">
          {pinnedIdea ? (
            <button
              type="button"
              className="quest-compose-picker-foot-btn"
              onClick={() => {
                onUnpin();
                setOpen(false);
                setQuery("");
              }}
            >
              Detach idea — compose new
            </button>
          ) : (
            <span className="quest-compose-picker-foot-hint">
              Type below to compose a fresh idea, or pick an existing one above.
            </span>
          )}
        </div>
      </div>
    </Popover>
  );
}
