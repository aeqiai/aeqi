import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api } from "@/lib/api";
import * as ideasApi from "@/api/ideas";
import { useNav } from "@/hooks/useNav";
import { useAgentIdeas, useAgentIdeasCache } from "@/queries/ideas";
import type { Idea, ScopeValue } from "@/lib/types";
import { Button, Textarea, Tooltip } from "./ui";
import { Events, useTrack } from "@/lib/analytics";
import { RichMarkdown, buildIdeasByName } from "./markdown/RichMarkdown";
import IdeaLinksPanel from "./IdeaLinksPanel";
import RefsRow, { type RefRecord } from "./RefsRow";
import TagsEditor from "./TagsEditor";
import IdeasScopePopover from "./ideas/IdeasScopePopover";

/**
 * Imperative handle for callers that supply their own toolbar (the
 * quest-compose page, today). `commit()` flushes the in-flight edit
 * snapshot to the idea store and resolves with the persisted idea id;
 * `revert()` drops in-progress edits back to the persisted snapshot
 * (idea-detail's "Cancel" semantics); `dirty()` reports whether there
 * are unsaved local edits so a parent toolbar can mirror IdeaCanvas's
 * own dirty signal.
 */
export interface IdeaCanvasHandle {
  commit: () => Promise<string>;
  revert: () => void;
  dirty: () => boolean;
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type DecisionState = "idle" | "saving" | "done";

const SAVED_FLASH_MS = 1200;

function extractHashtags(text: string): string[] {
  const re = /(?:^|\s)#([a-z0-9_-]+)/gi;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1].toLowerCase());
  return Array.from(out);
}

function mergeTags(body: string, typed: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...typed, ...extractHashtags(body)]) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/**
 * Apple Notes-style idea canvas. Always-editable, borderless. Explicit save.
 *
 * Two modes collapse into the same surface:
 * - `create`: no idea yet. Cmd+Enter or Save button commits; URL swaps to
 *   the new idea's ID.
 * - `edit`: idea exists. Typing marks the canvas dirty; Save button or
 *   Cmd+Enter persists. Navigating away with unsaved changes flushes to
 *   avoid silent data loss.
 */
export interface IdeaCanvasProps {
  agentId: string;
  idea?: Idea;
  initialName?: string;
  onBack: () => void;
  onNew: () => void;
  /**
   * Hide the canvas's own toolbar (Back / New / Scope / Delete / Save). The
   * embedding surface (e.g. the quest detail header) is expected to provide
   * its own. Tags strip + body editor + refs row stay visible.
   */
  embedded?: boolean;
  /**
   * Replace the canvas's default toolbar with caller-supplied chrome. The
   * tags strip / body / refs / links surface stays. Mutually exclusive
   * with `embedded` (which suppresses the toolbar entirely).
   */
  headerSlot?: ReactNode;
  /**
   * When set, the canvas's internal create/save flow calls this instead
   * of navigating to the persisted idea's detail page. The parent owns
   * the post-persist navigation — useful when the idea is part of a
   * larger flow (e.g. wrapping it in a quest).
   */
  onPersisted?: (ideaId: string) => void;
  /**
   * Reports whether `commit()` would succeed right now. Used by callers
   * that drive their own Save button (the quest-compose page) so the
   * button can be disabled when there's nothing to save in compose mode
   * — never inviting the "Write something first" failure.
   */
  onCanCommitChange?: (canCommit: boolean) => void;
  /**
   * Reports the canvas's internal dirty state — fires `true` on the
   * first edit since the last persist, `false` after a successful
   * save / revert / idea switch. Lets a caller-supplied toolbar mirror
   * idea-detail's "Cancel + Save only when dirty" UX.
   */
  onDirtyChange?: (dirty: boolean) => void;
}

const IdeaCanvas = forwardRef<IdeaCanvasHandle, IdeaCanvasProps>(function IdeaCanvas(
  {
    agentId,
    idea,
    initialName,
    onBack,
    onNew,
    embedded = false,
    headerSlot,
    onPersisted,
    onCanCommitChange,
    onDirtyChange,
  },
  ref,
) {
  const { goAgent } = useNav();
  const track = useTrack();
  const { data: ideas } = useAgentIdeas(agentId);
  const { patchIdea, removeIdea, addIdea } = useAgentIdeasCache(agentId);
  const ideasByName = useMemo(() => buildIdeasByName(ideas), [ideas]);
  // All tags the agent has used elsewhere — ranked by frequency — power the
  // tag-autocomplete dropdown. Self-tags are excluded in TagsEditor.
  const tagSuggestions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of ideas ?? []) {
      for (const t of i.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([t]) => t);
  }, [ideas]);

  const isEdit = !!idea;
  const [name, setName] = useState(idea?.name ?? initialName ?? "");
  const [content, setContent] = useState(idea?.content ?? "");
  const [typedTags, setTypedTags] = useState<string[]>(idea?.tags ?? []);
  const [composeScope, setComposeScope] = useState<ScopeValue>("self");
  // Pending references for compose mode — the idea doesn't exist yet so
  // we collect picker selections locally and replay them as
  // `addIdeaEdge` calls after the idea persists. Compose-mode refs are
  // always treated as `adjacent` (the explicit-link relation).
  const [pendingRefs, setPendingRefs] = useState<RefRecord[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  // Candidate-skill decision state.
  const tags = idea?.tags ?? [];
  const isCandidateSkill = tags.includes("skill") && tags.includes("candidate");
  const isDecided = tags.includes("promoted") || tags.includes("rejected");
  const showDecisionBtns = isEdit && isCandidateSkill && !isDecided;
  const [decisionState, setDecisionState] = useState<DecisionState>("idle");
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [showRejectPanel, setShowRejectPanel] = useState(false);
  const [rejectRationale, setRejectRationale] = useState("");

  // Body editing mode: in `edit`, the textarea is active; in `view`, the
  // rendered markdown is shown. Compose mode (no idea yet) starts in edit.
  const [bodyMode, setBodyMode] = useState<"view" | "edit">(isEdit ? "view" : "edit");

  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const flashRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const inflightRef = useRef(false);
  const latestRef = useRef({ name, content, typedTags });

  latestRef.current = { name, content, typedTags };

  const markDirty = useCallback(() => {
    if (!isEdit) return;
    dirtyRef.current = true;
    setSaveState("dirty");
  }, [isEdit]);

  // When the selected idea changes, reset the canvas to its values.
  useEffect(() => {
    setName(idea?.name ?? "");
    setContent(idea?.content ?? "");
    setTypedTags(idea?.tags ?? []);
    setSaveState("idle");
    setError(null);
    setDecisionState("idle");
    setDecisionError(null);
    setShowRejectPanel(false);
    setRejectRationale("");
    setBodyMode(idea?.id ? "view" : "edit");
    setComposeScope("self");
    setPendingRefs([]);
    dirtyRef.current = false;
  }, [idea?.id, idea?.name, idea?.content, idea?.tags]);

  // Focus the textarea whenever we enter edit mode on an existing idea.
  useEffect(() => {
    if (bodyMode === "edit" && isEdit) {
      requestAnimationFrame(() => bodyRef.current?.focus());
    }
  }, [bodyMode, isEdit]);

  // Focus the title when this mount shows the compose canvas — unless
  // the title arrived pre-filled from a create-from-query flow, in which
  // case the body is the interesting surface to land on.
  useEffect(() => {
    if (!isEdit) {
      requestAnimationFrame(() => {
        if (initialName && initialName.length > 0) bodyRef.current?.focus();
        else titleRef.current?.focus();
      });
    }
  }, [isEdit, initialName]);

  const flushSave = useCallback(async (): Promise<string> => {
    if (!idea) throw new Error("flushSave called without an idea");
    if (inflightRef.current) return idea.id;
    const snapshot = latestRef.current;
    const tags = mergeTags(snapshot.content, snapshot.typedTags);
    const trimmedName = snapshot.name.trim();
    const effectiveName =
      trimmedName || snapshot.content.split("\n")[0].slice(0, 60).trim() || "Untitled";

    // Skip redundant saves — nothing changed since last persisted state.
    if (
      effectiveName === idea.name &&
      snapshot.content === idea.content &&
      JSON.stringify(tags) === JSON.stringify(idea.tags ?? [])
    ) {
      setSaveState("idle");
      dirtyRef.current = false;
      return idea.id;
    }

    inflightRef.current = true;
    setSaveState("saving");
    setError(null);
    try {
      await ideasApi.updateIdea(idea.id, {
        name: effectiveName,
        content: snapshot.content,
        tags,
      });
      patchIdea(idea.id, {
        name: effectiveName,
        content: snapshot.content,
        tags,
      });
      dirtyRef.current = false;
      setSaveState("saved");
      if (flashRef.current) window.clearTimeout(flashRef.current);
      flashRef.current = window.setTimeout(() => setSaveState("idle"), SAVED_FLASH_MS);
      return idea.id;
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : "Save failed");
      throw e;
    } finally {
      inflightRef.current = false;
    }
  }, [idea, patchIdea]);

  // Flush on unmount / idea switch so accidental navigation doesn't lose work.
  // No debounced autosave while typing — the Save button / Cmd+Enter is the
  // only deliberate persist path.
  useEffect(() => {
    return () => {
      if (flashRef.current) window.clearTimeout(flashRef.current);
      if (dirtyRef.current)
        flushSave().catch(() => {
          /* unmount path — best-effort flush */
        });
    };
  }, [flushSave]);

  // Create flow — only runs in compose mode.
  const handleCreate = useCallback(async (): Promise<string> => {
    if (isEdit) throw new Error("handleCreate called in edit mode");
    const snapshot = latestRef.current;
    const trimmedContent = snapshot.content.trim();
    if (!trimmedContent && !snapshot.name.trim()) {
      setError("Write something first");
      throw new Error("empty");
    }
    const effectiveName =
      snapshot.name.trim() || trimmedContent.split("\n")[0].slice(0, 60).trim() || "Untitled";
    const tags = mergeTags(snapshot.content, snapshot.typedTags);
    setSaveState("saving");
    setError(null);
    try {
      const res = await ideasApi.storeIdea({
        name: effectiveName,
        content: snapshot.content,
        tags,
        agent_id: agentId,
        scope: composeScope,
      });
      const created: Idea = {
        id: res.id,
        name: effectiveName,
        content: snapshot.content,
        tags,
        scope: composeScope,
        agent_id: agentId,
      };
      addIdea(created);
      track(Events.IdeaCreated, { surface: "idea-canvas", scope: composeScope });
      // Replay the locally-collected references against the freshly-
      // persisted idea. We fire and-forget — if any individual edge
      // fails the user still has the idea, and they can re-add the ref
      // from edit mode. Keeping the navigate non-blocking on this loop
      // means the canvas swap to edit mode still feels instant.
      if (pendingRefs.length > 0) {
        void Promise.all(
          pendingRefs.map((r) => api.addIdeaEdge(res.id, r.target_id, "adjacent").catch(() => {})),
        );
      }
      setSaveState("saved");
      // When the parent owns post-persist navigation (quest-compose
      // wraps the idea in a quest), defer to it. Otherwise jump to the
      // idea detail like the standalone canvas always has.
      if (onPersisted) {
        onPersisted(res.id);
      } else {
        goAgent(agentId, "ideas", res.id, { replace: true });
      }
      return res.id;
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : "Save failed");
      throw e;
    }
  }, [isEdit, agentId, addIdea, goAgent, composeScope, pendingRefs, onPersisted, track]);

  // Edit-mode revert: drop the in-memory snapshot back to the
  // persisted idea. Used by both the canvas's own Cancel button
  // and by the imperative handle so a caller-supplied toolbar can
  // wire its own Cancel through the same code path.
  const revert = useCallback(() => {
    setName(idea?.name ?? "");
    setContent(idea?.content ?? "");
    setTypedTags(idea?.tags ?? []);
    setError(null);
    setSaveState("idle");
    dirtyRef.current = false;
  }, [idea?.name, idea?.content, idea?.tags]);

  // Imperative handle: the quest-compose page (and any future caller
  // that drives its own toolbar) needs to fire the canvas's persist
  // path from outside. `commit()` resolves with the persisted idea id
  // for both compose and edit flows, so the parent can chain follow-up
  // work (wrapping the idea in a quest) on the same Save click.
  useImperativeHandle(
    ref,
    () => ({
      commit: () => (isEdit ? flushSave() : handleCreate()),
      revert,
      dirty: () => dirtyRef.current,
    }),
    [isEdit, flushSave, handleCreate, revert],
  );

  // Push the canvas's dirty signal to the embedding toolbar so its
  // Cancel + Save buttons can mirror idea-detail's "show only when
  // dirty" UX. `dirty` here is `true` while the user has unsaved
  // edits (or a save is in flight); after a successful save it
  // flicks through "saved" → "idle", both reported as not-dirty.
  useEffect(() => {
    if (!onDirtyChange) return;
    onDirtyChange(saveState === "dirty" || saveState === "saving");
  }, [saveState, onDirtyChange]);

  // Tell the embedding caller whether `commit()` would succeed right
  // now. Edit mode is always commit-ready (the quest wrapper can save
  // even with no inline edits); compose mode requires at least a name
  // or some body content. Mirrors the guard inside `handleCreate`.
  useEffect(() => {
    if (!onCanCommitChange) return;
    const canCommit = isEdit || name.trim().length > 0 || content.trim().length > 0;
    onCanCommitChange(canCommit);
  }, [isEdit, name, content, onCanCommitChange]);

  // Cmd/Ctrl + Enter — commit in create mode, save in edit mode.
  // `e` (bare) — from view mode, enter edit (Linear-style doc shortcut). Ignored
  // when focus is already in an editable surface so it never eats real keystrokes.
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
        ev.preventDefault();
        if (isEdit) flushSave();
        else handleCreate();
        return;
      }
      if (
        ev.key === "e" &&
        !ev.metaKey &&
        !ev.ctrlKey &&
        !ev.altKey &&
        isEdit &&
        bodyMode === "view"
      ) {
        const tgt = ev.target as HTMLElement | null;
        const tag = tgt?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tgt?.isContentEditable) return;
        ev.preventDefault();
        setBodyMode("edit");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isEdit, flushSave, handleCreate, bodyMode]);

  const handleDelete = async () => {
    if (!idea) return;
    try {
      const res = await ideasApi.deleteIdea(idea.id);
      // FK pre-flight: backend reports `in_use` + the offending quest ids.
      // Surface them inline so the user can click through and detach.
      if (!res.ok && res.error === "in_use" && res.quest_ids?.length) {
        const ids = res.quest_ids;
        const formatted = ids.length === 1 ? `quest ${ids[0]}` : `${ids.length} quests`;
        setError(
          `In use by ${formatted}. Detach or delete first: ${ids.slice(0, 5).join(", ")}` +
            (ids.length > 5 ? ` …` : ""),
        );
        setDeleteArmed(false);
        return;
      }
      if (!res.ok) {
        setError(res.error ?? "Delete failed");
        setDeleteArmed(false);
        return;
      }
      removeIdea(idea.id);
      goAgent(agentId, "ideas", undefined, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const handlePromote = useCallback(async () => {
    if (!idea) return;
    setDecisionState("saving");
    setDecisionError(null);
    const nextTags = [...(idea.tags ?? []).filter((t) => t !== "candidate"), "promoted"];
    try {
      await ideasApi.updateIdea(idea.id, { tags: nextTags });
      patchIdea(idea.id, { tags: nextTags });
      setTypedTags(nextTags);
      setDecisionState("done");
    } catch (e) {
      setDecisionState("idle");
      setDecisionError(e instanceof Error ? e.message : "Promote failed");
    }
  }, [idea, patchIdea]);

  const handleReject = useCallback(async () => {
    if (!idea || !rejectRationale.trim()) return;
    setDecisionState("saving");
    setDecisionError(null);
    const nextTags = [...(idea.tags ?? []).filter((t) => t !== "candidate"), "rejected"];
    const nextContent = content.trimEnd() + "\n\n## Rejection rationale\n" + rejectRationale.trim();
    try {
      await ideasApi.updateIdea(idea.id, { tags: nextTags, content: nextContent });
      patchIdea(idea.id, { tags: nextTags, content: nextContent });
      setTypedTags(nextTags);
      setContent(nextContent);
      setDecisionState("done");
      setShowRejectPanel(false);
    } catch (e) {
      setDecisionState("idle");
      setDecisionError(e instanceof Error ? e.message : "Reject failed");
    }
  }, [idea, patchIdea, content, rejectRationale]);

  const inlineTags = mergeTags(content, typedTags);
  // Resolved scope for display in the header popover. In compose mode the
  // user-picked composeScope drives it; in edit mode we read from the idea
  // (with `global` shadowed when agent_id is null, since legacy rows can
  // hit edit without an explicit scope set).
  const headerScope: ScopeValue = isEdit
    ? (idea?.scope ?? (idea?.agent_id == null ? "global" : "self"))
    : composeScope;

  // Two-click delete confirm — first click arms the trash button (turns
  // red, tooltip flips), second commits. Auto-disarms after 4s of no
  // interaction, or on the next render where the user moved focus away.
  // Keeps the affordance to a single inline button instead of opening a
  // popover for a one-noun confirm.
  const [deleteArmed, setDeleteArmed] = useState(false);
  useEffect(() => {
    if (!deleteArmed) return;
    const t = window.setTimeout(() => setDeleteArmed(false), 4000);
    return () => window.clearTimeout(t);
  }, [deleteArmed]);
  const handleDeleteClick = () => {
    if (deleteArmed) handleDelete();
    else setDeleteArmed(true);
  };

  const showCompose = !isEdit;

  const dirty = saveState === "dirty" || saveState === "saving";

  // Cancel = revert. In compose mode it bails back to the index;
  // in edit mode it restores name/content/tags/refs to the
  // committed idea snapshot and clears dirty so the save row hides.
  const handleCancel = () => {
    if (!isEdit) {
      onBack();
      return;
    }
    revert();
  };

  return (
    <div className={embedded ? "ideas-canvas ideas-canvas--embedded" : "asv-main ideas-canvas"}>
      {headerSlot && !embedded && (
        <div className="ideas-list-head ideas-canvas-head">{headerSlot}</div>
      )}
      {!embedded && !headerSlot && (
        <div className="ideas-list-head ideas-canvas-head">
          <div className="ideas-toolbar ideas-canvas-toolbar">
            <Tooltip content="Back to ideas">
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
                Ideas
              </Button>
            </Tooltip>
            {!showCompose && (
              <Tooltip content="New idea (N)">
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
            <IdeasScopePopover
              scope={headerScope}
              locked={isEdit}
              onChange={!isEdit ? setComposeScope : undefined}
            />
            <div className="ideas-toolbar-spacer" aria-hidden />
            {isEdit && idea && (
              <Tooltip content="Track this idea as a quest">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    goAgent(agentId, "quests", "new", {
                      replace: false,
                      search: { fromIdea: idea.id },
                    })
                  }
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
                    <path d="M2.5 6.5h8M6.5 2.5v8" />
                  </svg>
                  Track as quest
                </Button>
              </Tooltip>
            )}
            {isEdit && (
              <Tooltip content={deleteArmed ? "Click again to confirm delete" : "Delete idea"}>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDeleteClick}
                  onBlur={() => setDeleteArmed(false)}
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
                    <path d="M3.2 3.2 L9.8 9.8 M9.8 3.2 L3.2 9.8" />
                  </svg>
                  {deleteArmed ? "Confirm" : "Delete"}
                </Button>
              </Tooltip>
            )}
            {(showCompose || dirty) && (
              <>
                <Tooltip content="Cancel">
                  <Button variant="secondary" size="sm" onClick={handleCancel}>
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
                </Tooltip>
                <Tooltip content={isEdit ? "Save (⌘↵)" : "Save idea (⌘↵)"}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={isEdit ? flushSave : handleCreate}
                    disabled={saveState === "saving"}
                    loading={saveState === "saving"}
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
                </Tooltip>
              </>
            )}
          </div>
        </div>
      )}
      {error && <div className="ideas-canvas-error">{error}</div>}
      <div className="ideas-tags-strip ideas-canvas-strip">
        <TagsEditor
          tags={inlineTags}
          typed={typedTags}
          suggestions={tagSuggestions}
          onAdd={(t) => {
            const next = [...typedTags, t];
            setTypedTags(next);
            markDirty();
          }}
          onRemove={(t) => {
            if (typedTags.includes(t)) {
              const next = typedTags.filter((x) => x !== t);
              setTypedTags(next);
              markDirty();
            }
          }}
        />
        {isEdit && idea ? (
          <IdeaLinksPanel ideaId={idea.id} agentId={agentId} />
        ) : (
          <RefsRow
            candidates={ideas ?? []}
            refs={pendingRefs}
            onAdd={(target) =>
              setPendingRefs((prev) =>
                prev.some((r) => r.target_id === target.id)
                  ? prev
                  : [...prev, { target_id: target.id, name: target.name, relation: "adjacent" }],
              )
            }
            onRemove={({ target_id }) =>
              setPendingRefs((prev) => prev.filter((r) => r.target_id !== target_id))
            }
          />
        )}
      </div>

      <div className="ideas-canvas-content">
        <input
          ref={titleRef}
          className="ideas-canvas-title"
          type="text"
          placeholder={isEdit ? "Untitled" : "Name this idea…"}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            markDirty();
          }}
        />

        {showDecisionBtns && (
          <div className="ideas-canvas-decision-bar">
            <div className="ideas-canvas-decision-head">
              <span className="ideas-canvas-decision-kind">Candidate skill</span>
              <div className="ideas-canvas-decision-actions">
                <Button
                  variant="primary"
                  size="sm"
                  loading={decisionState === "saving" && !showRejectPanel}
                  onClick={handlePromote}
                >
                  Promote
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={decisionState === "saving"}
                  onClick={() => setShowRejectPanel((v) => !v)}
                  aria-expanded={showRejectPanel}
                >
                  Reject
                </Button>
              </div>
            </div>
            {showRejectPanel && (
              <div className="ideas-canvas-reject-panel">
                <Textarea
                  bare
                  className="ideas-canvas-reject-textarea"
                  placeholder="Why reject? This gets appended to the idea body."
                  value={rejectRationale}
                  onChange={(e) => setRejectRationale(e.target.value)}
                  autoFocus
                />
                <div className="ideas-canvas-decision-actions">
                  <Button
                    variant="danger"
                    size="sm"
                    loading={decisionState === "saving"}
                    disabled={!rejectRationale.trim()}
                    onClick={handleReject}
                  >
                    Confirm rejection
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setShowRejectPanel(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {decisionError && <span className="ideas-canvas-error">{decisionError}</span>}
          </div>
        )}

        {bodyMode === "edit" || !isEdit ? (
          <Textarea
            bare
            ref={bodyRef}
            className="ideas-canvas-body"
            placeholder={
              isEdit
                ? "Keep writing…"
                : "Write the idea.\n\n#tag to tag · [[name]] to link · ![[name]] to embed"
            }
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              markDirty();
            }}
            onKeyDown={(e) => {
              // Esc: drop back to rendered view when there's nothing to lose.
              // If the user has unsaved changes we stay in edit so they can
              // see the Save button; a second Esc still escapes focus.
              if (e.key === "Escape" && isEdit && !dirtyRef.current) {
                e.preventDefault();
                setBodyMode("view");
              }
            }}
            onBlur={() => {
              // Only drop back to rendered view when there are no unsaved
              // changes — otherwise the user would lose their editing surface
              // (and the Save button would have nothing to flush visually).
              if (isEdit && !dirtyRef.current) setBodyMode("view");
            }}
          />
        ) : (
          <div
            className="ideas-canvas-body ideas-canvas-body-rendered"
            role="textbox"
            tabIndex={0}
            aria-label="Click to edit"
            onClick={() => setBodyMode("edit")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setBodyMode("edit");
              }
            }}
          >
            {content.trim() ? (
              <RichMarkdown body={content} ideasByName={ideasByName} agentId={agentId} />
            ) : (
              <span className="ideas-canvas-body-empty">Click to write…</span>
            )}
            <span className="ideas-canvas-body-edit-hint" aria-hidden>
              <kbd>E</kbd>
              <span>edit</span>
            </span>
          </div>
        )}
      </div>
    </div>
  );
});

export default IdeaCanvas;
