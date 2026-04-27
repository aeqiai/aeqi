import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { useNav } from "@/hooks/useNav";
import { useAgentDataStore } from "@/store/agentData";
import { useDaemonStore } from "@/store/daemon";
import type { Idea, Quest, QuestPriority, ScopeValue } from "@/lib/types";
import { Button, Popover } from "./ui";
import IdeaCanvas, { type IdeaCanvasHandle } from "./IdeaCanvas";
import QuestPriorityPopover from "./quests/QuestPriorityPopover";
import IdeasScopePopover from "./ideas/IdeasScopePopover";

/**
 * Dedicated quest-compose surface, mounted at `/:agentId/quests/new`.
 *
 * The body IS `<IdeaCanvas>`. Same tags strip, same body editor, same
 * refs row, same wiki-link resolver — what you get composing an idea
 * directly. The header is the only thing that's quest-shaped: a
 * linked-idea picker (swap to a different existing idea), Priority,
 * Scope, Cancel, Save.
 *
 * Save commits the idea (compose: `storeIdea`; pinned-with-edits:
 * `updateIdea`) and then wraps that idea_id in a fresh quest. Both
 * persist on the same click.
 */
export default function QuestComposePage({
  agentId,
  resolvedAgentId,
}: {
  agentId: string;
  resolvedAgentId: string;
}) {
  const { goAgent } = useNav();
  const [searchParams] = useSearchParams();
  const fromIdeaId = searchParams.get("fromIdea") ?? null;
  const presetName = searchParams.get("name") ?? "";

  const ideasRaw = useAgentDataStore((s) => s.ideasByAgent[resolvedAgentId]);
  const ideas = useMemo(() => ideasRaw ?? [], [ideasRaw]);
  const loadIdeas = useAgentDataStore((s) => s.loadIdeas);
  const allQuests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const fetchQuests = useDaemonStore((s) => s.fetchQuests);

  const [pinnedIdea, setPinnedIdea] = useState<Idea | null>(null);
  const [priority, setPriority] = useState<QuestPriority>("normal");
  const [scope, setScope] = useState<ScopeValue>("self");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Mirrors the canvas's internal can-save signal: compose mode needs
  // at least a name or body before Save is meaningful. Edit mode is
  // always saveable (we can wrap the linked idea in a quest with no
  // inline edits).
  const [canSave, setCanSave] = useState(false);

  const canvasRef = useRef<IdeaCanvasHandle | null>(null);

  // Prime the agent's idea index — the picker can be deep-linked
  // without first visiting the ideas tab.
  useEffect(() => {
    void loadIdeas(resolvedAgentId);
  }, [loadIdeas, resolvedAgentId]);

  // "+ Track as quest" prefills the pinned idea — resolve as soon as
  // the agent's idea index lands.
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

  // The Save button drives both halves: flush the canvas (creates or
  // updates the idea, returns its id) then wrap it in a quest.
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
      await fetchQuests();
      goAgent(agentId, "quests", newId ?? undefined, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create quest");
      setBusy(false);
    }
  }, [busy, priority, scope, resolvedAgentId, fetchQuests, goAgent, agentId]);

  // ⌘↵ commits, Esc bails. We capture at the document level so the
  // parent's `submit` (which also wraps the quest) wins over the
  // canvas's own ⌘↵. The capture is gated on `canSave` so an empty
  // compose surface stays an inert no-op rather than an error flash.
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

  // Keyed remount on idea-id change — `<IdeaCanvas>` keys its internal
  // state on `idea?.id` via useEffect, but a fresh ref makes the
  // imperative handle reattach cleanly. Switching the linked idea
  // abandons in-progress compose work, mirroring how navigating from
  // the ideas tab to a different idea behaves.
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
        <div className="ideas-toolbar ideas-canvas-toolbar">
          <Button variant="secondary" size="sm" onClick={cancel} title="Back to quests">
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
          <LinkedIdeaPicker
            ideas={ideas}
            quests={allQuests}
            pinnedIdea={pinnedIdea}
            onPick={(idea) => setPinnedIdea(idea)}
            onUnpin={() => setPinnedIdea(null)}
          />
          <QuestPriorityPopover priority={priority} onChange={setPriority} />
          <IdeasScopePopover scope={scope} onChange={setScope} />
          <div className="ideas-toolbar-spacer" aria-hidden />
          {err && <span className="quest-compose-err">{err}</span>}
          <Button variant="secondary" size="sm" onClick={cancel} disabled={busy}>
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
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            loading={busy}
            disabled={!canSave || busy}
            title={canSave ? "Create quest (⌘↵)" : "Write something to save"}
          >
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
            Save
          </Button>
        </div>
      }
    />
  );
}

/**
 * Compact "linked idea" trigger that lives in the quest-compose
 * toolbar. Click → popover with idea search, each row showing how many
 * quests already track that idea. Picking remounts the canvas with
 * that idea's body. Detach drops back to fresh-compose.
 */
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
              <button
                key={idea.id}
                type="button"
                className={`quest-compose-picker-row${isPinned ? " is-active" : ""}`}
                onClick={() => {
                  onPick(idea);
                  setOpen(false);
                  setQuery("");
                }}
              >
                <span className="quest-compose-picker-name">{idea.name}</span>
                {count > 0 && (
                  <span className="quest-compose-picker-meta">
                    · {count} quest{count === 1 ? "" : "s"}
                  </span>
                )}
              </button>
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
