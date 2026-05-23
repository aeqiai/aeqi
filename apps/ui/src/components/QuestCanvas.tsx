import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import * as ideasApi from "@/api/ideas";
import { useNav } from "@/hooks/useNav";
import { useAgentIdeas } from "@/queries/ideas";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { formatAssignee } from "@/lib/assignee";
import type { Idea, Quest, QuestPriority, QuestStatus, ScopeValue, User } from "@/lib/types";
import { Events, useTrack } from "@/lib/analytics";
import IdeaCanvas, { type IdeaCanvasHandle } from "./IdeaCanvas";
import QuestDetailSummary from "./quests/QuestDetailSummary";
import QuestDetailRail from "./quests/QuestDetailRail";
import QuestToolbar from "./quests/QuestToolbar";
import LinkedIdeaPicker from "./quests/LinkedIdeaPicker";
import { isDirectChildOf, questParentId } from "./quests/agentQuestsHelpers";

const QUEST_STATUS_VALUES: QuestStatus[] = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "cancelled",
];

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
//  Compose mode
// ─────────────────────────────────────────────────────────────────────
function ComposeCanvas({ agentId, resolvedAgentId }: { agentId: string; resolvedAgentId: string }) {
  const { goEntity, trustId } = useNav();
  const [searchParams] = useSearchParams();
  const track = useTrack();
  const fromIdeaId = searchParams.get("fromIdea") ?? null;
  const presetName = searchParams.get("name") ?? "";
  const presetStatus = parseQuestStatus(searchParams.get("status"));
  const parentQuestId = searchParams.get("parent") ?? null;

  const { data: ideas = [] } = useAgentIdeas(resolvedAgentId, true, trustId);
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
  const [dueAt, setDueAt] = useState<string | null>(null);
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
    goEntity(trustId, "quests", undefined, { replace: true });
  }, [trustId, goEntity]);

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
        parent: parentQuestId ?? undefined,
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
          await api.updateQuest(newId, {
            status,
            priority,
            scope,
            assignee,
            due_at: dueAt,
          });
        } catch {
          /* non-fatal — quest exists, just sits at IPC defaults */
        }
      }
      await fetchQuests();
      if (parentQuestId) {
        goEntity(trustId, "quests", undefined, {
          replace: true,
          search: { scope: parentQuestId },
        });
      } else {
        goEntity(trustId, "quests", newId ?? undefined, { replace: true });
      }
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
    dueAt,
    parentQuestId,
    resolvedAgentId,
    fetchQuests,
    goEntity,
    trustId,
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
          due_at={dueAt}
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
          onDueChange={setDueAt}
          onBack={cancel}
          onCancel={cancel}
          onSave={submit}
          breadcrumbLabel={pinnedIdea?.name ?? (presetName || "New quest")}
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
  const { goEntity, trustId } = useNav();
  const fetchQuests = useDaemonStore((s) => s.fetchQuests);
  const agents = useDaemonStore((s) => s.agents);
  const allQuests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const currentUser = useAuthStore((s) => s.user);
  const { data: ideas = [] } = useAgentIdeas(quest.agent_id ?? resolvedAgentId, true, trustId);
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
  const [dueAt, setDueAt] = useState<string | null>(quest.due_at ?? null);
  const [ideaTags, setIdeaTags] = useState<string[]>(quest.idea?.tags ?? []);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [bodyDirty, setBodyDirty] = useState(false);
  const [activityRefreshSeq, setActivityRefreshSeq] = useState(0);
  const defaultAssignee = useMemo(
    () =>
      currentUser?.id
        ? formatAssignee("user", currentUser.id)
        : resolvedAgentId
          ? formatAssignee("agent", resolvedAgentId)
          : null,
    [currentUser?.id, resolvedAgentId],
  );

  // Linear-style single-key shortcuts on the detail page open the
  // matching popover. Owning the open state up here is what lets `S`,
  // `P`, `A`, `D` flip the controlled `open` props on the children.
  const [statusOpen, setStatusOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [dueOpen, setDueOpen] = useState(false);

  const debounceRef = useRef<number | null>(null);
  const canvasRef = useRef<IdeaCanvasHandle | null>(null);
  const lifecycleRef = useRef({ status, priority, assignee, scope, dueAt });
  lifecycleRef.current = { status, priority, assignee, scope, dueAt };

  // Re-sync on quest swap (navigation between quests reuses this
  // component) so popovers reflect the new row's persisted values.
  useEffect(() => {
    setStatus(quest.status);
    setPriority(quest.priority);
    setAssignee(quest.assignee ?? null);
    setScope(quest.scope ?? "self");
    setDueAt(quest.due_at ?? null);
    setIdeaTags(quest.idea?.tags ?? []);
    setSaveState("idle");
  }, [
    quest.id,
    quest.status,
    quest.priority,
    quest.assignee,
    quest.scope,
    quest.due_at,
    quest.idea?.id,
    quest.idea?.tags,
  ]);

  const persistLifecycle = useCallback(async () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setSaveState("saving");
    try {
      const { status: s, priority: p, assignee: a, scope: sc, dueAt: du } = lifecycleRef.current;
      await api.updateQuest(quest.id, {
        status: s,
        priority: p,
        assignee: a,
        scope: sc,
        due_at: du,
      });
      await fetchQuests();
      setActivityRefreshSeq((n) => n + 1);
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

  const handleStatusChange = useCallback(
    (next: QuestStatus) => {
      setStatus(next);
      if (next === "in_progress" && !assignee && defaultAssignee) {
        setAssignee(defaultAssignee);
      }
      scheduleLifecycleSave();
    },
    [assignee, defaultAssignee, scheduleLifecycleSave],
  );

  const handlePriorityChange = useCallback(
    (next: QuestPriority) => {
      setPriority(next);
      scheduleLifecycleSave();
    },
    [scheduleLifecycleSave],
  );

  const handleAssigneeChange = useCallback(
    (next: string | null) => {
      setAssignee(next);
      scheduleLifecycleSave();
    },
    [scheduleLifecycleSave],
  );

  const handleScopeChange = useCallback(
    (next: ScopeValue) => {
      setScope(next);
      scheduleLifecycleSave();
    },
    [scheduleLifecycleSave],
  );

  const handleDueChange = useCallback(
    (next: string | null) => {
      setDueAt(next);
      scheduleLifecycleSave();
    },
    [scheduleLifecycleSave],
  );

  const persistIdeaTags = useCallback(
    async (nextTags: string[]) => {
      if (!quest.idea) return;
      const previous = ideaTags;
      setIdeaTags(nextTags);
      try {
        await ideasApi.updateIdea(quest.idea.id, { tags: nextTags }, trustId);
        await fetchQuests();
        setActivityRefreshSeq((n) => n + 1);
      } catch {
        setIdeaTags(previous);
      }
    },
    [fetchQuests, ideaTags, quest.idea, trustId],
  );

  const handleTagAdd = useCallback(
    (tag: string) => {
      const key = tag.toLowerCase();
      if (ideaTags.some((item) => item.toLowerCase() === key)) return;
      void persistIdeaTags([...ideaTags, tag]);
    },
    [ideaTags, persistIdeaTags],
  );

  const handleTagRemove = useCallback(
    (tag: string) => {
      void persistIdeaTags(ideaTags.filter((item) => item !== tag));
    },
    [ideaTags, persistIdeaTags],
  );

  // S / P / A shortcuts. Skip when focus is inside an editable
  // element (BlockEditor, search input, etc.) and when any modifier
  // is held — same conventions as the j/k navigation in
  // AgentQuestsTab. Open the matching popover on key-down; the
  // popover's own focus handling takes over from there.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable;
      if (isEditable) return;
      if (e.key === "s" || e.key === "S") {
        e.preventDefault();
        setStatusOpen((prev) => !prev);
        setPriorityOpen(false);
        setAssigneeOpen(false);
        setDueOpen(false);
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        setPriorityOpen((prev) => !prev);
        setStatusOpen(false);
        setAssigneeOpen(false);
        setDueOpen(false);
        return;
      }
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        setAssigneeOpen((prev) => !prev);
        setStatusOpen(false);
        setPriorityOpen(false);
        setDueOpen(false);
        return;
      }
      if (e.key === "d" || e.key === "D") {
        e.preventDefault();
        setDueOpen((prev) => !prev);
        setStatusOpen(false);
        setPriorityOpen(false);
        setAssigneeOpen(false);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
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

  const backToQuests = () => goEntity(trustId, "quests", undefined, { replace: true });
  const newQuest = () => goEntity(trustId, "quests", "new", { replace: false });
  const openQuest = (id: string) => goEntity(trustId, "quests", id, { replace: false });
  const tagSuggestions = Array.from(
    new Set(ideas.flatMap((idea) => idea.tags ?? []).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b));
  const parentId = questParentId(quest.id);
  const parentQuest = parentId ? allQuests.find((q) => q.id === parentId) : undefined;
  const childQuests = allQuests.filter((q) => isDirectChildOf(q, quest.id));
  const siblingIds = new Set(quest.sibling_quest_ids ?? []);
  const siblingQuests = allQuests.filter(
    (q) =>
      q.id !== quest.id &&
      (siblingIds.has(q.id) || (quest.idea_id != null && q.idea_id === quest.idea_id)),
  );
  const displayQuest: Quest = quest.idea
    ? {
        ...quest,
        idea: {
          ...quest.idea,
          tags: ideaTags,
        },
      }
    : quest;

  return (
    <div className="asv-main quest-detail-page">
      <div className="ideas-list-head ideas-canvas-head quest-detail-head">
        <QuestToolbar
          agentId={agentId}
          agents={agents}
          users={assigneeUsers}
          status={status}
          priority={priority}
          assignee={assignee}
          scope={scope}
          due_at={dueAt}
          saving={saveState === "saving"}
          cancelLabel="Cancel"
          cancelTitle="Revert unsaved changes"
          saveLabel="Save"
          saveTitle="Save (⌘↵)"
          saveDisabled={false}
          showCancelSave={bodyDirty}
          showLifecycleControls={false}
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
          onAssigneeChange={handleAssigneeChange}
          onScopeChange={handleScopeChange}
          onDueChange={handleDueChange}
          onBack={backToQuests}
          onNew={newQuest}
          onCancel={handleRevertBody}
          onSave={handleSaveBody}
          statusOpen={statusOpen}
          onStatusOpenChange={setStatusOpen}
          priorityOpen={priorityOpen}
          onPriorityOpenChange={setPriorityOpen}
          assigneeOpen={assigneeOpen}
          onAssigneeOpenChange={setAssigneeOpen}
          dueOpen={dueOpen}
          onDueOpenChange={setDueOpen}
          breadcrumbLabel={quest.idea?.name ?? quest.id}
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
      </div>
      <div className="quest-detail-layout">
        <QuestDetailRail
          quest={displayQuest}
          parentQuest={parentQuest}
          childQuests={childQuests}
          siblingQuests={siblingQuests}
          onOpenQuest={openQuest}
        />
        <main className="quest-detail-document">
          <IdeaCanvas
            ref={canvasRef}
            agentId={quest.agent_id ?? resolvedAgentId}
            idea={displayQuest.idea}
            activityRefreshKey={activityRefreshSeq}
            onBack={backToQuests}
            onNew={newQuest}
            onDirtyChange={setBodyDirty}
            embedded
            hideMetaStrip
          />
        </main>
        <QuestDetailSummary
          quest={displayQuest}
          status={status}
          priority={priority}
          assignee={assignee}
          scope={scope}
          dueAt={dueAt}
          agents={agents}
          users={assigneeUsers}
          tagSuggestions={tagSuggestions}
          childQuests={childQuests}
          activityRefreshKey={activityRefreshSeq}
          onStatusChange={handleStatusChange}
          onPriorityChange={handlePriorityChange}
          onAssigneeChange={handleAssigneeChange}
          onScopeChange={handleScopeChange}
          onDueChange={handleDueChange}
          onTagAdd={handleTagAdd}
          onTagRemove={handleTagRemove}
          statusOpen={statusOpen}
          onStatusOpenChange={setStatusOpen}
          priorityOpen={priorityOpen}
          onPriorityOpenChange={setPriorityOpen}
          assigneeOpen={assigneeOpen}
          onAssigneeOpenChange={setAssigneeOpen}
          dueOpen={dueOpen}
          onDueOpenChange={setDueOpen}
        />
      </div>
    </div>
  );
}
