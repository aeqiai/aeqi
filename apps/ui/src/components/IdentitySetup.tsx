/**
 * IdentitySetup — reusable component for wiring an agent identity.
 *
 * Used in two contexts:
 *   1. NewAgentPage  — inline textarea on the create form.
 *   2. AgentPage     — compact card shown above the tabs, with edit dialog.
 *
 * Identity wiring = idea (content) + event (session:start injects that idea).
 * The API sequence is: storeIdentityIdea → createEvent with idea_ids.
 * On any failure the component surfaces the error as a toast; prior steps
 * are NOT rolled back (the idea may be left orphaned — acceptable for MVP,
 * since it appears in the Ideas tab and is harmless).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { storeIdentityIdea } from "@/lib/identityApi";
import type { AgentEvent } from "@/lib/types";
import { Button, Spinner } from "./ui";

/* ── slug helper ─────────────────────────────────────────────────────── */

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/* ── Types ───────────────────────────────────────────────────────────── */

interface IdentityEvent {
  event: AgentEvent;
  ideaName: string;
  ideaContent: string;
  ideaId: string;
}

/** Wire identity: create the idea + the session:start event. */
async function wireIdentity(
  agentId: string,
  agentName: string,
  content: string,
): Promise<{ ideaId: string; eventId: string }> {
  const slug = slugify(agentName);
  const ideaName = `${slug}-identity`;

  const ideaResp = await storeIdentityIdea({
    name: ideaName,
    content,
    tags: ["identity"],
    agent_id: agentId,
    scope: "self",
  });
  const ideaId = ideaResp.id;

  const eventResp = await api.createEvent({
    name: "on_session_start_identity",
    pattern: "session:start",
    agent_id: agentId,
    idea_ids: [ideaId],
    scope: "self",
  });
  const eventId = (eventResp as Record<string, unknown>).id as string;

  return { ideaId, eventId };
}

/* ─────────────────────────────────────────────────────────────────────
 *  IdentityCard — shown on AgentPage above the tabs.
 *  Detects the identity event from the agent's events list and shows:
 *    • The idea name + a 140-char preview + "Edit" button if wired.
 *    • A "Configure identity" button that opens an inline dialog if not.
 * ──────────────────────────────────────────────────────────────────── */

export function IdentityCard({
  agentId,
  agentName,
  onToast,
}: {
  agentId: string;
  agentName: string;
  onToast: (msg: string, isError?: boolean) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<IdentityEvent | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);

  const loadIdentity = useCallback(async () => {
    setLoading(true);
    try {
      const eventsResp = await api.getAgentEvents(agentId);
      const rows = ((eventsResp as Record<string, unknown>).events ?? []) as AgentEvent[];
      // Find first session:start event with at least one idea attached.
      const match = rows.find((e) => e.pattern === "session:start" && e.idea_ids.length > 0);
      if (!match) {
        setIdentity(null);
        setLoading(false);
        return;
      }
      // Fetch the first attached idea to get content.
      const firstIdeaId = match.idea_ids[0];
      const ideasResp = await api.getIdeasByIds([firstIdeaId]);
      const idea = ideasResp.ideas[0];
      if (!idea) {
        setIdentity(null);
        setLoading(false);
        return;
      }
      setIdentity({
        event: match,
        ideaId: idea.id,
        ideaName: idea.name,
        ideaContent: idea.content,
      });
      setEditContent(idea.content);
    } catch {
      setIdentity(null);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void loadIdentity();
  }, [loadIdentity]);

  const handleConfigure = async (content: string) => {
    setSaving(true);
    try {
      await wireIdentity(agentId, agentName, content);
      onToast("Identity wired — session:start will inject this.");
      setDialogOpen(false);
      await loadIdentity();
    } catch (err) {
      onToast(
        `Failed to configure identity: ${err instanceof Error ? err.message : "unknown error"}`,
        true,
      );
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = async () => {
    if (!identity) return;
    setSaving(true);
    try {
      await api.updateIdea(identity.ideaId, { content: editContent });
      onToast("Identity updated.");
      setEditing(false);
      await loadIdentity();
    } catch (err) {
      onToast(
        `Failed to update identity: ${err instanceof Error ? err.message : "unknown error"}`,
        true,
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="identity-card identity-card--loading">
        <Spinner size="sm" />
      </div>
    );
  }

  if (identity && !editing) {
    return (
      <div className="identity-card identity-card--wired">
        <div className="identity-card-header">
          <span className="identity-card-label">Identity</span>
          <span className="identity-card-name">{identity.ideaName}</span>
          <button
            type="button"
            className="identity-card-edit-btn"
            onClick={() => {
              setEditContent(identity.ideaContent);
              setEditing(true);
            }}
          >
            edit
          </button>
        </div>
        <p className="identity-card-preview">
          {identity.ideaContent.length > 140
            ? `${identity.ideaContent.slice(0, 140)}…`
            : identity.ideaContent}
        </p>
      </div>
    );
  }

  if (identity && editing) {
    return (
      <div className="identity-card identity-card--editing">
        <div className="identity-card-header">
          <span className="identity-card-label">Identity</span>
          <span className="identity-card-name">{identity.ideaName}</span>
        </div>
        <textarea
          className="identity-card-textarea"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          rows={4}
          autoFocus
        />
        <div className="identity-card-actions">
          <button
            type="button"
            className="identity-card-cancel"
            onClick={() => setEditing(false)}
            disabled={saving}
          >
            cancel
          </button>
          <Button variant="primary" size="sm" onClick={handleEdit} disabled={saving}>
            {saving ? (
              <>
                <Spinner size="sm" />
                Saving…
              </>
            ) : (
              "Save"
            )}
          </Button>
        </div>
      </div>
    );
  }

  // No identity wired yet.
  return (
    <>
      <div className="identity-card identity-card--empty">
        <span className="identity-card-label">Identity</span>
        <span className="identity-card-empty-hint">No identity configured.</span>
        <button
          type="button"
          className="identity-card-configure-btn"
          onClick={() => setDialogOpen(true)}
        >
          Configure identity
        </button>
      </div>

      {dialogOpen && (
        <IdentityDialog
          agentName={agentName}
          saving={saving}
          onSave={handleConfigure}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  IdentityDialog — inline configure dialog for agents without identity.
 * ──────────────────────────────────────────────────────────────────── */

function IdentityDialog({
  agentName,
  saving,
  onSave,
  onClose,
}: {
  agentName: string;
  saving: boolean;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}) {
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="identity-dialog-backdrop" onClick={onClose}>
      <div className="identity-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="identity-dialog-header">
          <span className="identity-dialog-title">Configure identity</span>
          <span className="identity-dialog-agent">{agentName}</span>
        </div>
        <p className="identity-dialog-hint">
          Give this agent an identity — we&apos;ll inject it on every session:start.
        </p>
        <textarea
          ref={textareaRef}
          className="identity-dialog-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="You are a thoughtful assistant who…"
          rows={6}
        />
        <div className="identity-dialog-actions">
          <button
            type="button"
            className="identity-card-cancel"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void onSave(content)}
            disabled={!content.trim() || saving}
          >
            {saving ? (
              <>
                <Spinner size="sm" />
                Wiring…
              </>
            ) : (
              "Wire identity"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 *  wireIdentityForNewAgent — called from NewAgentPage after agent creation.
 *  Returns a user-facing result string (or throws on failure).
 * ──────────────────────────────────────────────────────────────────── */

export async function wireIdentityForNewAgent(
  agentId: string,
  agentName: string,
  content: string,
): Promise<void> {
  await wireIdentity(agentId, agentName, content);
}
