/* eslint-disable max-lines -- Existing Ideas document primitive; splitting it is a separate refactor. */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type { DragEvent, ReactNode } from "react";
import { logError } from "@/lib/logging";
import * as ideasApi from "@/api/ideas";
import { useNav } from "@/hooks/useNav";
import { useAgentIdeas, useAgentIdeasCache } from "@/queries/ideas";
import type { Idea, ScopeValue } from "@/lib/types";
import { Events, useTrack } from "@/lib/analytics";
import { asStringArray, parseFrontmatter } from "@/lib/frontmatter";
import LazyBlockEditor from "./editor/LazyBlockEditor";
import { blockTreeToPlainText } from "./editor/blockEditorContent";
import IdeaLinksPanel from "./IdeaLinksPanel";
import RefsRow, { type RefRecord } from "./RefsRow";
import TagsEditor from "./TagsEditor";
import IdeaConversationPanel from "./ideas/IdeaConversationPanel";
import IdeaPropertyChips from "./ideas/IdeaPropertyChips";
import IdeaChildrenList from "./ideas/IdeaChildrenList";
import IdeaCanvasToolbar from "./ideas/IdeaCanvasToolbar";
import IdeaCanvasDecisionPanel from "./ideas/IdeaCanvasDecisionPanel";
import { isMarkdownFile } from "./ideas/ideaImport";
import { mergeTags } from "./ideas/ideaTagUtils";
import { ImportMenu } from "./blueprints/ImportMenu";
import { Textarea } from "./ui";

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

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type DecisionState = "idle" | "saving" | "done";

const SAVED_FLASH_MS = 1200;

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
  parentIdeaId?: string | null;
  onBack: () => void;
  onNew: () => void;
  onTrackAsQuest?: (idea: Idea) => void;
  /**
   * Hide the canvas's own toolbar (Back / New / Scope / Delete / Save). The
   * embedding surface (e.g. the quest detail header) is expected to provide
   * its own. Tags strip + body editor + refs row stay visible.
   */
  embedded?: boolean;
  /**
   * Hide the tags / references band so an embedding surface can render idea
   * metadata in a side inspector instead of inside the document body.
   */
  hideMetaStrip?: boolean;
  /** Controlled compose visibility when an embedding surface owns scope UI. */
  composeScope?: ScopeValue;
  /**
   * Replace the canvas's default toolbar with caller-supplied chrome. The
   * tags strip / body / refs / links surface stays. Mutually exclusive
   * with `embedded` (which suppresses the toolbar entirely).
   */
  headerSlot?: ReactNode;
  /** Local chrome rendered inside the document content, directly above
   *  the idea title. Embedding pages use this for section-level controls
   *  without adding external rows around the canvas. */
  contentHeaderSlot?: ReactNode;
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
  /** Bump this from an embedding surface when related non-idea activity
   *  lands in the idea's backing session. */
  activityRefreshKey?: unknown;
  /** Conversation activity display. Defaults to old behavior: visible
   *  unless the metadata strip is hidden. */
  conversationActivity?: "auto" | "hidden" | "stacked" | "tabs" | "combined";
}

const IdeaCanvas = forwardRef<IdeaCanvasHandle, IdeaCanvasProps>(function IdeaCanvas(
  {
    agentId,
    idea,
    initialName,
    parentIdeaId,
    onBack,
    onNew,
    onTrackAsQuest,
    embedded = false,
    hideMetaStrip = false,
    composeScope: controlledComposeScope,
    headerSlot,
    contentHeaderSlot,
    onPersisted,
    onCanCommitChange,
    onDirtyChange,
    activityRefreshKey,
    conversationActivity = "auto",
  },
  ref,
) {
  const { goEntity, companyId } = useNav();
  const track = useTrack();
  const { data: ideas } = useAgentIdeas(agentId, true, companyId);
  const { patchIdea, removeIdea, addIdea, invalidateIdeas } = useAgentIdeasCache(
    agentId,
    companyId,
  );
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
  const [internalComposeScope, setInternalComposeScope] = useState<ScopeValue>("self");
  const composeScope = controlledComposeScope ?? internalComposeScope;
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
  const [activityRefreshSeq, setActivityRefreshSeq] = useState(0);

  // The block editor is always-editable when `editable` is true — no
  // separate view/edit toggle. The `editable` flag mirrors the
  // pre-existing canvas's "embedded read-only" surface (compose mode is
  // always editable; edit mode also editable; the canvas can be passed
  // `editable={false}` later for a future read-only embed).
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const flashRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const inflightRef = useRef(false);
  const latestRef = useRef({ name, content, typedTags });

  latestRef.current = { name, content, typedTags };

  const resizeTitle = useCallback(() => {
    const title = titleRef.current;
    if (!title) return;
    title.style.height = "auto";
    title.style.height = `${title.scrollHeight}px`;
  }, []);

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
    if (controlledComposeScope == null) setInternalComposeScope("self");
    setPendingRefs([]);
    dirtyRef.current = false;
  }, [controlledComposeScope, idea?.id, idea?.name, idea?.content, idea?.tags]);

  // Focus the title when this mount shows the compose canvas. Body
  // autofocus is delegated to the BlockEditor itself via its `autofocus`
  // prop when a pre-filled title arrived from a create-from-query flow.
  useEffect(() => {
    if (!isEdit) {
      requestAnimationFrame(() => {
        if (!(initialName && initialName.length > 0)) titleRef.current?.focus();
      });
    }
  }, [isEdit, initialName]);

  const flushSave = useCallback(async (): Promise<string> => {
    if (!idea) throw new Error("flushSave called without an idea");
    if (inflightRef.current) return idea.id;
    const snapshot = latestRef.current;
    const flatBody = blockTreeToPlainText(snapshot.content);
    const tags = mergeTags(flatBody, snapshot.typedTags);
    const trimmedName = snapshot.name.trim();
    const effectiveName = trimmedName || flatBody.split("\n")[0].slice(0, 60).trim() || "Untitled";

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
      await ideasApi.updateIdea(
        idea.id,
        {
          name: effectiveName,
          content: snapshot.content,
          tags,
        },
        companyId,
      );
      patchIdea(idea.id, {
        name: effectiveName,
        content: snapshot.content,
        tags,
      });
      setActivityRefreshSeq((n) => n + 1);
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
  }, [idea, patchIdea, companyId]);

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
    const flatBody = blockTreeToPlainText(snapshot.content).trim();
    if (!flatBody && !snapshot.name.trim()) {
      setError("Write something first");
      throw new Error("empty");
    }
    const effectiveName =
      snapshot.name.trim() || flatBody.split("\n")[0].slice(0, 60).trim() || "Untitled";
    const tags = mergeTags(flatBody, snapshot.typedTags);
    setSaveState("saving");
    setError(null);
    try {
      const res = await ideasApi.storeIdea(
        {
          name: effectiveName,
          content: snapshot.content,
          tags,
          agent_id: agentId,
          scope: composeScope,
          parent_idea_id: parentIdeaId ?? undefined,
        },
        companyId,
      );
      const created: Idea = {
        id: res.id,
        name: effectiveName,
        content: snapshot.content,
        tags,
        scope: composeScope,
        agent_id: agentId,
        parent_idea_id: parentIdeaId ?? undefined,
      };
      addIdea(created);
      track(Events.IdeaCreated, {
        surface: "idea-canvas",
        scope: composeScope,
        has_parent: parentIdeaId ? "true" : "false",
      });
      // Replay the locally-collected references against the freshly-
      // persisted idea. We fire and-forget — if any individual edge
      // fails the user still has the idea, and they can re-add the ref
      // from edit mode. Keeping the navigate non-blocking on this loop
      // means the canvas swap to edit mode still feels instant.
      if (pendingRefs.length > 0) {
        void Promise.all(
          pendingRefs.map((r) =>
            ideasApi
              .addIdeaEdge(res.id, r.target_id, "adjacent", companyId)
              .catch((e) => logError("idea-canvas.add-adjacent-edge", e)),
          ),
        );
      }
      setSaveState("saved");
      // When the parent owns post-persist navigation (quest-compose
      // wraps the idea in a quest), defer to it. Otherwise jump to the
      // idea detail like the standalone canvas always has.
      if (onPersisted) {
        onPersisted(res.id);
      } else {
        goEntity(companyId, "ideas", res.id, { replace: true });
      }
      return res.id;
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : "Save failed");
      throw e;
    }
  }, [
    isEdit,
    agentId,
    parentIdeaId,
    companyId,
    addIdea,
    goEntity,
    composeScope,
    pendingRefs,
    onPersisted,
    track,
  ]);

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

  useEffect(() => {
    resizeTitle();
  }, [name, resizeTitle]);

  // Tell the embedding caller whether `commit()` would succeed right
  // now. Edit mode is always commit-ready (the quest wrapper can save
  // even with no inline edits); compose mode requires at least a name
  // or some body content. Mirrors the guard inside `handleCreate`.
  useEffect(() => {
    if (!onCanCommitChange) return;
    const canCommit = isEdit || name.trim().length > 0 || content.trim().length > 0;
    onCanCommitChange(canCommit);
  }, [isEdit, name, content, onCanCommitChange]);

  // Cmd/Ctrl + Enter — commit in create mode, save in edit mode. The
  // BlockEditor is always-editable; no view/edit toggle to manage, so
  // the bare `e` shortcut (Linear-style "enter edit") was retired.
  useEffect(() => {
    const handler = (ev: KeyboardEvent) => {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") {
        ev.preventDefault();
        if (isEdit) flushSave();
        else handleCreate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isEdit, flushSave, handleCreate]);

  const handleDelete = async () => {
    if (!idea) return;
    try {
      const res = await ideasApi.deleteIdea(idea.id, companyId);
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
      goEntity(companyId, "ideas", undefined, { replace: true });
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
      await ideasApi.updateIdea(idea.id, { tags: nextTags }, companyId);
      patchIdea(idea.id, { tags: nextTags });
      setTypedTags(nextTags);
      setActivityRefreshSeq((n) => n + 1);
      setDecisionState("done");
    } catch (e) {
      setDecisionState("idle");
      setDecisionError(e instanceof Error ? e.message : "Promote failed");
    }
  }, [idea, patchIdea, companyId]);

  const handleReject = useCallback(async () => {
    if (!idea || !rejectRationale.trim()) return;
    setDecisionState("saving");
    setDecisionError(null);
    const nextTags = [...(idea.tags ?? []).filter((t) => t !== "candidate"), "rejected"];
    // Reject rationale is appended as plaintext; the BlockEditor will
    // re-parse it on next mount. We project the current JSON tree to
    // text first so existing block structure isn't lost — the editor
    // round-trips plain paragraphs cleanly back to blocks on reload.
    const flat = blockTreeToPlainText(content).trimEnd();
    const nextContent = flat + "\n\n## Rejection rationale\n" + rejectRationale.trim();
    try {
      await ideasApi.updateIdea(idea.id, { tags: nextTags, content: nextContent }, companyId);
      patchIdea(idea.id, { tags: nextTags, content: nextContent });
      setTypedTags(nextTags);
      setContent(nextContent);
      setActivityRefreshSeq((n) => n + 1);
      setDecisionState("done");
      setShowRejectPanel(false);
    } catch (e) {
      setDecisionState("idle");
      setDecisionError(e instanceof Error ? e.message : "Reject failed");
    }
  }, [idea, patchIdea, content, rejectRationale, companyId]);

  const inlineTags = mergeTags(blockTreeToPlainText(content), typedTags);
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

  const conversationActivityRefreshKey = useMemo(
    () => [activityRefreshSeq, activityRefreshKey],
    [activityRefreshSeq, activityRefreshKey],
  );

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

  const handleFileImport = useCallback(
    async (files: FileList) => {
      if (!idea) return;
      const failures: string[] = [];
      for (const file of Array.from(files)) {
        try {
          if (isMarkdownFile(file)) {
            const raw = await file.text();
            const { body, data } = parseFrontmatter(raw);
            const importedName =
              (typeof data.title === "string" && data.title) ||
              file.name.replace(/\.(md|markdown)$/i, "") ||
              "Untitled";
            const summary = typeof data.summary === "string" ? data.summary.trim() : "";
            const importedContent =
              summary && !body.startsWith(summary) ? `${summary}\n\n${body.trim()}` : body.trim();
            await ideasApi.storeIdea(
              {
                name: importedName,
                content: importedContent,
                tags: asStringArray(data.tags),
                agent_id: agentId,
                scope: idea.scope ?? headerScope,
                parent_idea_id: idea.id,
              },
              companyId,
            );
          } else {
            const upload = await ideasApi.uploadFileToIdea(
              {
                agentId,
                file,
                scope: idea.scope ?? headerScope,
                parentIdeaId: idea.id,
              },
              companyId,
            );
            if (!upload.ok) throw new Error(upload.error || "upload failed");
          }
        } catch (e) {
          failures.push(`${file.name}: ${e instanceof Error ? e.message : "import failed"}`);
        }
      }
      await invalidateIdeas();
      setActivityRefreshSeq((n) => n + 1);
      if (failures.length > 0) setError(failures.join("; "));
    },
    [agentId, headerScope, idea, invalidateIdeas, companyId],
  );
  const handleDropFiles = (event: DragEvent) => {
    if (!idea || event.dataTransfer.files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    void handleFileImport(event.dataTransfer.files);
  };

  return (
    <div
      className={embedded ? "ideas-canvas ideas-canvas--embedded" : "asv-main ideas-canvas"}
      onDragOver={(event) => {
        if (idea && event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={handleDropFiles}
    >
      {headerSlot && !embedded && (
        <div className="ideas-list-head ideas-canvas-head">{headerSlot}</div>
      )}
      {!embedded && !headerSlot && (
        <div className="ideas-list-head ideas-canvas-head">
          <IdeaCanvasToolbar
            isEdit={isEdit}
            showCompose={!isEdit}
            dirty={saveState === "dirty" || saveState === "saving"}
            idea={idea}
            headerScope={headerScope}
            setComposeScope={setInternalComposeScope}
            saveState={saveState}
            deleteArmed={deleteArmed}
            setDeleteArmed={setDeleteArmed}
            onBack={onBack}
            onNew={onNew}
            onTrackAsQuest={() => {
              if (!idea) return;
              if (onTrackAsQuest) {
                onTrackAsQuest(idea);
                return;
              }
              goEntity(companyId, "quests", "new", {
                replace: false,
                search: { fromIdea: idea.id },
              });
            }}
            onDeleteClick={handleDeleteClick}
            onCancel={handleCancel}
            onSave={isEdit ? flushSave : handleCreate}
            importMenu={
              <ImportMenu
                companyId={companyId}
                parts={["ideas"]}
                blueprintTitle="Import child ideas from a template"
                accept="*/*"
                fileLabel="From files"
                onMarkdownPicked={(files) => void handleFileImport(files)}
                onBlueprintSpawned={() => void invalidateIdeas()}
              />
            }
          />
        </div>
      )}
      <div className="ideas-canvas-frame">
        <div className="ideas-canvas-paper">
          {error && <div className="ideas-canvas-error">{error}</div>}
          {!hideMetaStrip && (
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
                        : [
                            ...prev,
                            { target_id: target.id, name: target.name, relation: "adjacent" },
                          ],
                    )
                  }
                  onRemove={({ target_id }) =>
                    setPendingRefs((prev) => prev.filter((r) => r.target_id !== target_id))
                  }
                />
              )}
            </div>
          )}

          <div className="ideas-canvas-content">
            {contentHeaderSlot}
            <Textarea
              ref={titleRef}
              className="ideas-canvas-title"
              bare
              placeholder={isEdit ? "Untitled" : "Name this idea…"}
              rows={1}
              value={name}
              onChange={(e) => {
                setName(e.target.value.replace(/\s*\n+\s*/g, " "));
                markDirty();
                resizeTitle();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
            />

            {showDecisionBtns && (
              <IdeaCanvasDecisionPanel
                decisionState={decisionState}
                decisionError={decisionError}
                showRejectPanel={showRejectPanel}
                setShowRejectPanel={setShowRejectPanel}
                rejectRationale={rejectRationale}
                setRejectRationale={setRejectRationale}
                onPromote={handlePromote}
                onReject={handleReject}
              />
            )}

            {isEdit && idea && !hideMetaStrip ? (
              <IdeaPropertyChips
                ideaId={idea.id}
                scopedEntity={companyId}
                properties={idea.properties}
              />
            ) : null}

            <div className="ideas-canvas-body ideas-canvas-body-block">
              <LazyBlockEditor
                initialContent={idea?.content ?? content ?? null}
                onChange={(json) => {
                  setContent(json);
                  markDirty();
                }}
                placeholder={
                  isEdit ? "Keep writing…" : "Write the idea. Type / for blocks · #tag to tag"
                }
                autofocus={!isEdit && !!initialName && initialName.length > 0}
              />
            </div>

            {isEdit && idea && !hideMetaStrip && (
              <IdeaChildrenList ideaId={idea.id} agentId={agentId} scope={idea.scope} />
            )}
          </div>
        </div>
        {isEdit && idea && (
          <IdeaConversationPanel
            ideaId={idea.id}
            showActivity={
              conversationActivity === "auto" ? !hideMetaStrip : conversationActivity !== "hidden"
            }
            variant={
              conversationActivity === "tabs" || conversationActivity === "combined"
                ? conversationActivity
                : "stacked"
            }
            activityRefreshKey={conversationActivityRefreshKey}
            actions={
              <ImportMenu
                companyId={companyId}
                parts={["ideas"]}
                blueprintTitle="Import child ideas from a template"
                accept="*/*"
                fileLabel="Upload files"
                triggerLabel="Upload"
                includeBlueprint={false}
                onMarkdownPicked={(files) => void handleFileImport(files)}
                onBlueprintSpawned={() => void invalidateIdeas()}
              />
            }
          />
        )}
      </div>
    </div>
  );
});

export default IdeaCanvas;
