import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useNav } from "@/hooks/useNav";
import { useAgentDataStore } from "@/store/agentData";
import type { Idea, ScopeValue } from "@/lib/types";
import { Button } from "./ui";
import { RichMarkdown, buildIdeasByName } from "./markdown/RichMarkdown";
import IdeaLinksPanel from "./IdeaLinksPanel";
import TagsEditor from "./TagsEditor";
import IdeasScopePopover from "./ideas/IdeasScopePopover";

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
export default function IdeaCanvas({
  agentId,
  idea,
  initialName,
  onBack,
  onNew,
}: {
  agentId: string;
  idea?: Idea;
  initialName?: string;
  onBack: () => void;
  onNew: () => void;
}) {
  const { goAgent } = useNav();
  const patchIdea = useAgentDataStore((s) => s.patchIdea);
  const removeIdea = useAgentDataStore((s) => s.removeIdea);
  const addIdea = useAgentDataStore((s) => s.addIdea);
  const ideas = useAgentDataStore((s) => s.ideasByAgent[agentId]);
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

  const flushSave = useCallback(async () => {
    if (!idea || inflightRef.current) return;
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
      return;
    }

    inflightRef.current = true;
    setSaveState("saving");
    setError(null);
    try {
      await api.updateIdea(idea.id, {
        name: effectiveName,
        content: snapshot.content,
        tags,
      });
      patchIdea(agentId, idea.id, {
        name: effectiveName,
        content: snapshot.content,
        tags,
      });
      dirtyRef.current = false;
      setSaveState("saved");
      if (flashRef.current) window.clearTimeout(flashRef.current);
      flashRef.current = window.setTimeout(() => setSaveState("idle"), SAVED_FLASH_MS);
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      inflightRef.current = false;
    }
  }, [idea, agentId, patchIdea]);

  // Flush on unmount / idea switch so accidental navigation doesn't lose work.
  // No debounced autosave while typing — the Save button / Cmd+Enter is the
  // only deliberate persist path.
  useEffect(() => {
    return () => {
      if (flashRef.current) window.clearTimeout(flashRef.current);
      if (dirtyRef.current) flushSave();
    };
  }, [flushSave]);

  // Create flow — only runs in compose mode.
  const handleCreate = useCallback(async () => {
    if (isEdit) return;
    const snapshot = latestRef.current;
    const trimmedContent = snapshot.content.trim();
    if (!trimmedContent && !snapshot.name.trim()) {
      setError("Write something first");
      return;
    }
    const effectiveName =
      snapshot.name.trim() || trimmedContent.split("\n")[0].slice(0, 60).trim() || "Untitled";
    const tags = mergeTags(snapshot.content, snapshot.typedTags);
    setSaveState("saving");
    setError(null);
    try {
      const res = await api.storeIdea({
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
      addIdea(agentId, created);
      setSaveState("saved");
      goAgent(agentId, "ideas", res.id, { replace: true });
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }, [isEdit, agentId, addIdea, goAgent, composeScope]);

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
      await api.deleteIdea(idea.id);
      removeIdea(agentId, idea.id);
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
      await api.updateIdea(idea.id, { tags: nextTags });
      patchIdea(agentId, idea.id, { tags: nextTags });
      setTypedTags(nextTags);
      setDecisionState("done");
    } catch (e) {
      setDecisionState("idle");
      setDecisionError(e instanceof Error ? e.message : "Promote failed");
    }
  }, [idea, agentId, patchIdea]);

  const handleReject = useCallback(async () => {
    if (!idea || !rejectRationale.trim()) return;
    setDecisionState("saving");
    setDecisionError(null);
    const nextTags = [...(idea.tags ?? []).filter((t) => t !== "candidate"), "rejected"];
    const nextContent = content.trimEnd() + "\n\n## Rejection rationale\n" + rejectRationale.trim();
    try {
      await api.updateIdea(idea.id, { tags: nextTags, content: nextContent });
      patchIdea(agentId, idea.id, { tags: nextTags, content: nextContent });
      setTypedTags(nextTags);
      setContent(nextContent);
      setDecisionState("done");
      setShowRejectPanel(false);
    } catch (e) {
      setDecisionState("idle");
      setDecisionError(e instanceof Error ? e.message : "Reject failed");
    }
  }, [idea, agentId, patchIdea, content, rejectRationale]);

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

  return (
    <div className="asv-main ideas-canvas">
      <div className="ideas-list-head ideas-canvas-head">
        <div className="ideas-toolbar ideas-canvas-toolbar">
          <button
            type="button"
            className="ideas-toolbar-btn"
            onClick={onBack}
            title="Back to ideas"
            aria-label="Back to ideas"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 13 13"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M8 3 L4.5 6.5 L8 10" />
            </svg>
          </button>
          {!showCompose && (
            <button
              type="button"
              className="ideas-toolbar-btn"
              onClick={onNew}
              title="New idea (N)"
              aria-label="New idea"
            >
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
            </button>
          )}
          <div className="ideas-toolbar-spacer" aria-hidden />
          {error && <span className="ideas-canvas-error">{error}</span>}
          <SaveIndicator state={saveState} />
          <IdeasScopePopover
            scope={headerScope}
            locked={isEdit}
            onChange={!isEdit ? setComposeScope : undefined}
          />
          {showCompose && (
            <Button
              variant="primary"
              size="sm"
              loading={saveState === "saving"}
              onClick={handleCreate}
              title="Save idea (⌘↵)"
            >
              Save
            </Button>
          )}
          {isEdit && (
            <button
              type="button"
              className={`ideas-toolbar-btn danger${deleteArmed ? " armed" : ""}`}
              onClick={handleDeleteClick}
              onBlur={() => setDeleteArmed(false)}
              title={deleteArmed ? "Click again to confirm delete" : "Delete idea"}
              aria-label={deleteArmed ? "Confirm delete" : "Delete idea"}
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M3 3.5h7M5 3.5V2.5h3v1M3.8 3.5l.5 7h4.4l.5-7M5.3 5.5v3.5M7.7 5.5v3.5" />
              </svg>
            </button>
          )}
        </div>
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
            // Only allow removing a typed tag; hashtag chips live in the body.
            if (typedTags.includes(t)) {
              const next = typedTags.filter((x) => x !== t);
              setTypedTags(next);
              markDirty();
            }
          }}
        />
        {isEdit && idea && <IdeaLinksPanel ideaId={idea.id} agentId={agentId} />}
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
                <textarea
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
          <textarea
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
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label =
    state === "dirty"
      ? "Edited — unsaved"
      : state === "saving"
        ? "Saving…"
        : state === "saved"
          ? "Saved"
          : state === "error"
            ? "Save failed"
            : "";
  if (!label) return <span className="ideas-canvas-save-indicator" aria-hidden />;
  return (
    <span className={`ideas-canvas-save-indicator state-${state}`}>
      <span className="ideas-canvas-save-dot" aria-hidden />
      {label}
    </span>
  );
}
