import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useNav } from "@/hooks/useNav";
import { useAgentDataStore } from "@/store/agentData";
import type { Idea } from "@/lib/types";
import IdeaLinksPanel from "./IdeaLinksPanel";
import TagsEditor from "./TagsEditor";

type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 800;
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
 * Apple Notes-style idea canvas. Always-editable, borderless, autosaving.
 *
 * Two modes collapse into the same surface:
 * - `create`: no idea yet. Cmd+Enter commits; URL swaps to the new idea's ID.
 * - `edit`: idea exists. Any change schedules a debounced autosave; blur
 *   flushes immediately. No explicit save button — the saved indicator
 *   is the only feedback.
 */
export default function IdeaCanvas({ agentId, idea }: { agentId: string; idea?: Idea }) {
  const { goAgent } = useNav();
  const patchIdea = useAgentDataStore((s) => s.patchIdea);
  const removeIdea = useAgentDataStore((s) => s.removeIdea);
  const addIdea = useAgentDataStore((s) => s.addIdea);

  const isEdit = !!idea;
  const [name, setName] = useState(idea?.name ?? "");
  const [content, setContent] = useState(idea?.content ?? "");
  const [typedTags, setTypedTags] = useState<string[]>(idea?.tags ?? []);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const titleRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<number | null>(null);
  const flashRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const inflightRef = useRef(false);
  const latestRef = useRef({ name, content, typedTags });

  latestRef.current = { name, content, typedTags };

  // When the selected idea changes, reset the canvas to its values.
  useEffect(() => {
    setName(idea?.name ?? "");
    setContent(idea?.content ?? "");
    setTypedTags(idea?.tags ?? []);
    setSaveState("idle");
    setError(null);
    setConfirmDelete(false);
    dirtyRef.current = false;
  }, [idea?.id, idea?.name, idea?.content, idea?.tags]);

  // Focus the title when this mount shows the compose canvas.
  useEffect(() => {
    if (!isEdit) {
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [isEdit]);

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

  // Schedule a debounced autosave whenever content changes (edit mode only).
  const scheduleSave = useCallback(() => {
    if (!isEdit) return;
    dirtyRef.current = true;
    setSaveState("pending");
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      flushSave();
    }, SAVE_DEBOUNCE_MS);
  }, [isEdit, flushSave]);

  // Flush on unmount or when switching to a different idea.
  useEffect(() => {
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
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
      });
      const created: Idea = {
        id: res.id,
        name: effectiveName,
        content: snapshot.content,
        tags,
        agent_id: agentId,
      };
      addIdea(agentId, created);
      setSaveState("saved");
      goAgent(agentId, "ideas", res.id, { replace: true });
    } catch (e) {
      setSaveState("error");
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }, [isEdit, agentId, addIdea, goAgent]);

  // Cmd/Ctrl + Enter — commit in create mode, force-flush in edit mode.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== "Enter") return;
      e.preventDefault();
      if (isEdit) {
        if (debounceRef.current) window.clearTimeout(debounceRef.current);
        flushSave();
      } else {
        handleCreate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isEdit, flushSave, handleCreate]);

  const handleDelete = async () => {
    if (!idea) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deleteIdea(idea.id);
      removeIdea(agentId, idea.id);
      goAgent(agentId, "ideas", undefined, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
      setConfirmDelete(false);
    }
  };

  const inlineTags = mergeTags(content, typedTags);

  return (
    <div className="asv-main ideas-canvas">
      <input
        ref={titleRef}
        className="ideas-canvas-title"
        type="text"
        placeholder="Title"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          scheduleSave();
        }}
        onBlur={() => {
          if (isEdit && dirtyRef.current) {
            if (debounceRef.current) window.clearTimeout(debounceRef.current);
            flushSave();
          }
        }}
      />

      <TagsEditor
        tags={inlineTags}
        typed={typedTags}
        onAdd={(t) => {
          const next = [...typedTags, t];
          setTypedTags(next);
          scheduleSave();
        }}
        onRemove={(t) => {
          // Only allow removing a typed tag; hashtag chips live in the body.
          if (typedTags.includes(t)) {
            const next = typedTags.filter((x) => x !== t);
            setTypedTags(next);
            scheduleSave();
          }
        }}
      />

      <textarea
        className="ideas-canvas-body"
        placeholder="Start typing… use #hashtags inline."
        value={content}
        onChange={(e) => {
          setContent(e.target.value);
          scheduleSave();
        }}
        onBlur={() => {
          if (isEdit && dirtyRef.current) {
            if (debounceRef.current) window.clearTimeout(debounceRef.current);
            flushSave();
          }
        }}
      />

      <div className="ideas-canvas-footer">
        <div className="ideas-canvas-status">
          <SaveIndicator state={saveState} />
          {error && <span className="ideas-canvas-error">{error}</span>}
        </div>
        <div className="ideas-canvas-actions">
          {!isEdit ? (
            <>
              <span className="ideas-canvas-hint">⌘ + Enter</span>
              <button
                type="button"
                className="ideas-canvas-btn primary"
                onClick={handleCreate}
                disabled={saveState === "saving"}
              >
                {saveState === "saving" ? "Saving…" : "Save"}
              </button>
            </>
          ) : (
            <button
              type="button"
              className={`ideas-canvas-btn ghost danger${confirmDelete ? " confirm" : ""}`}
              onClick={handleDelete}
              onBlur={() => setConfirmDelete(false)}
            >
              {confirmDelete ? "Confirm delete?" : "Delete"}
            </button>
          )}
        </div>
      </div>

      {isEdit && idea && <IdeaLinksPanel ideaId={idea.id} agentId={agentId} />}
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const label =
    state === "pending"
      ? "Editing…"
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
