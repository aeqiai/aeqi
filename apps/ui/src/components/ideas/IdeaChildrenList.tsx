import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { listIdeaChildren, storeIdea } from "@/api/ideas";
import { ideaKeys } from "@/queries/keys";
import type { Idea, ScopeValue } from "@/lib/types";
import { useNav } from "@/hooks/useNav";
import { Button, Modal, Input } from "../ui";

/**
 * Tables-in-Ideas Phase 2.1 — Children list under the BlockEditor body.
 *
 * Shows the Idea's direct children (rows whose `parent_idea_id` points
 * at this Idea) as small cards with name + status chip. "Add child"
 * opens a modal that creates a new Idea with `parent_idea_id` pre-filled.
 * Clicking a child navigates to its detail page.
 *
 * The section hides itself entirely when there are no children AND no
 * pending create — the parent Idea looks unchanged for callers that
 * never use the parent_idea_id field.
 */
export interface IdeaChildrenListProps {
  ideaId: string;
  agentId: string;
  scope?: ScopeValue;
}

const STATUS_KEY = "status";

function statusOf(idea: Idea): string | null {
  const props = idea.properties ?? {};
  const status = (props as Record<string, unknown>)[STATUS_KEY];
  if (typeof status === "string" && status.trim() !== "") return status;
  return null;
}

export default function IdeaChildrenList({ ideaId, agentId, scope }: IdeaChildrenListProps) {
  const { goEntity, entityId } = useNav();
  const queryClient = useQueryClient();
  const [children, setChildren] = useState<Idea[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listIdeaChildren(ideaId)
      .then((res) => {
        if (cancelled) return;
        setChildren(res.ideas ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load children");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ideaId]);

  async function refresh() {
    const res = await listIdeaChildren(ideaId);
    setChildren(res.ideas ?? []);
    await queryClient.invalidateQueries({ queryKey: ideaKeys.all });
  }

  // Hide the section entirely when there's nothing to show and the user
  // hasn't opened the add-child modal. Keeps the canvas clean for ideas
  // that aren't parents.
  const hideEmpty = !loading && children.length === 0 && !showAdd;

  if (hideEmpty) {
    return (
      <div className="idea-children idea-children--empty">
        <button type="button" className="idea-property-add" onClick={() => setShowAdd(true)}>
          + Add child
        </button>
        {showAdd && (
          <AddChildModal
            parentIdeaId={ideaId}
            agentId={agentId}
            scope={scope}
            onClose={() => setShowAdd(false)}
            onCreated={async () => {
              setShowAdd(false);
              await refresh();
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="idea-children" aria-label="Child ideas">
      <div className="idea-children-head">
        <button
          type="button"
          className="idea-children-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((next) => !next)}
        >
          <svg
            className={expanded ? "is-open" : ""}
            width="10"
            height="10"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4.5 3 L7.5 6 L4.5 9" />
          </svg>
          <span className="idea-children-title">Children</span>
          <span className="idea-children-count">{children.length}</span>
        </button>
        <button type="button" className="idea-property-add" onClick={() => setShowAdd(true)}>
          + Add child
        </button>
      </div>
      {error && <span className="idea-children-error">{error}</span>}
      {loading ? (
        <span className="idea-children-loading">Loading…</span>
      ) : expanded ? (
        <ul className="idea-children-list">
          {children.map((child) => {
            const status = statusOf(child);
            return (
              <li key={child.id} className="idea-children-item">
                <button
                  type="button"
                  className="idea-children-card"
                  onClick={() => goEntity(entityId, "ideas", child.id)}
                >
                  <span className="idea-children-card-name">{child.name || "Untitled"}</span>
                  {status && <span className="idea-children-card-status">{status}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {showAdd && (
        <AddChildModal
          parentIdeaId={ideaId}
          agentId={agentId}
          scope={scope}
          onClose={() => setShowAdd(false)}
          onCreated={async () => {
            setShowAdd(false);
            await refresh();
          }}
        />
      )}
    </div>
  );
}

interface AddChildModalProps {
  parentIdeaId: string;
  agentId: string;
  scope?: ScopeValue;
  onClose: () => void;
  onCreated: () => Promise<void> | void;
}

function AddChildModal({ parentIdeaId, agentId, scope, onClose, onCreated }: AddChildModalProps) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await storeIdea({
        name: trimmed,
        content: "",
        agent_id: agentId,
        scope: scope ?? "self",
        parent_idea_id: parentIdeaId,
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
      setSubmitting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Add child idea">
      <form onSubmit={handleSubmit} className="idea-property-add-form">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="What is this child idea?"
          autoFocus
          required
        />
        {error && <span className="idea-property-add-error">{error}</span>}
        <div className="idea-property-add-actions">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" size="sm" loading={submitting}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
