import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Events, useTrack } from "@/lib/analytics";
import type { Idea, Quest, QuestPriority, QuestStatus, ScopeValue } from "@/lib/types";
import { useVisibleIdeas } from "@/queries/ideas";
import { Button, Loading, Modal, Select } from "../ui";
import { blockTreeToPlainText, truncatePreview } from "../editor/blockEditorContent";
import { SCOPE_LABEL } from "../ideas/types";
import styles from "./TrackIdeaAsQuestModal.module.css";

const STATUS_OPTIONS: { value: QuestStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In Progress" },
  { value: "in_review", label: "In Review" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

const PRIORITY_OPTIONS: { value: QuestPriority; label: string }[] = [
  { value: "critical", label: "Critical" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

const SCOPE_OPTIONS: { value: ScopeValue; label: string }[] = [
  { value: "self", label: SCOPE_LABEL.self },
  { value: "children", label: SCOPE_LABEL.children },
  { value: "global", label: SCOPE_LABEL.global },
];

export interface TrackIdeaAsQuestModalProps {
  open: boolean;
  idea?: Idea | null;
  ideaId?: string | null;
  agentId: string;
  companyId: string;
  initialStatus?: QuestStatus;
  parentQuestId?: string | null;
  onClose: () => void;
  onCreated: (quest: Quest) => Promise<void> | void;
}

export default function TrackIdeaAsQuestModal({
  open,
  idea,
  ideaId,
  agentId,
  companyId,
  initialStatus = "todo",
  parentQuestId,
  onClose,
  onCreated,
}: TrackIdeaAsQuestModalProps) {
  const track = useTrack();
  const { data: visibleIdeas = [], isLoading } = useVisibleIdeas(open && !idea, companyId);
  const linkedIdea = useMemo(
    () => idea ?? visibleIdeas.find((candidate) => candidate.id === ideaId) ?? null,
    [idea, ideaId, visibleIdeas],
  );
  const preview = useMemo(() => {
    const text = blockTreeToPlainText(linkedIdea?.content);
    return truncatePreview(text, 160);
  }, [linkedIdea?.content]);

  const [status, setStatus] = useState<QuestStatus>(initialStatus);
  const [priority, setPriority] = useState<QuestPriority>("normal");
  const [scope, setScope] = useState<ScopeValue>("self");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStatus(initialStatus);
    setPriority("normal");
    setScope("self");
    setSubmitting(false);
    setError(null);
  }, [initialStatus, open, ideaId, idea?.id]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    if (!linkedIdea) {
      setError("The linked idea is still loading.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await api.createQuest({
        project: agentId,
        agent_id: agentId,
        idea_id: linkedIdea.id,
        priority,
        scope,
        parent: parentQuestId ?? undefined,
      });
      const quest = response.quest;
      if (!quest?.id) throw new Error(response.error || "Quest was not created.");
      try {
        await api.updateQuest(quest.id, {
          status,
          priority,
          scope,
        });
      } catch {
        /* The quest exists; stale lifecycle metadata can be edited from detail. */
      }
      track(Events.QuestCreated, {
        surface: "track-idea-modal",
        priority,
        scope,
        status,
      });
      await onCreated({ ...quest, status, priority, scope, idea: response.idea ?? linkedIdea });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create quest.");
      setSubmitting(false);
    }
  };

  const missingIdea = open && !isLoading && !linkedIdea;

  return (
    <Modal open={open} onClose={handleClose} title="Track as quest" className={styles.modal}>
      <form className={styles.form} onSubmit={handleSubmit}>
        <section className={styles.idea} aria-label="Linked idea">
          <span className={styles.ideaLabel}>Idea</span>
          {isLoading && !linkedIdea ? (
            <div className={styles.loading}>
              <Loading size="sm" label="Loading idea" showLabel />
            </div>
          ) : linkedIdea ? (
            <>
              <strong>{linkedIdea.name || "Untitled idea"}</strong>
              <p>{preview || "No body yet."}</p>
            </>
          ) : (
            <p>Idea not found.</p>
          )}
        </section>

        <div className={styles.grid}>
          <label className={styles.field} htmlFor="track-quest-status">
            <span>Status</span>
            <Select
              id="track-quest-status"
              options={STATUS_OPTIONS}
              value={status}
              onChange={(value) => setStatus(value as QuestStatus)}
              fullWidth
            />
          </label>
          <label className={styles.field} htmlFor="track-quest-priority">
            <span>Priority</span>
            <Select
              id="track-quest-priority"
              options={PRIORITY_OPTIONS}
              value={priority}
              onChange={(value) => setPriority(value as QuestPriority)}
              fullWidth
            />
          </label>
          <label className={styles.field} htmlFor="track-quest-scope">
            <span>Visibility</span>
            <Select
              id="track-quest-scope"
              options={SCOPE_OPTIONS}
              value={scope}
              onChange={(value) => setScope(value as ScopeValue)}
              fullWidth
            />
          </label>
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <div className={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            type="submit"
            loading={submitting}
            disabled={missingIdea || isLoading}
          >
            Create quest
          </Button>
        </div>
      </form>
    </Modal>
  );
}
