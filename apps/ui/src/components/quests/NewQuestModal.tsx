import { useEffect, useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import { Events, useTrack } from "@/lib/analytics";
import type { Quest, QuestPriority, QuestStatus, ScopeValue } from "@/lib/types";
import { Button, Input, Modal, Select, Textarea } from "../ui";
import { SCOPE_LABEL } from "../ideas/types";

const STATUS_OPTIONS: { value: QuestStatus; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "todo", label: "Todo" },
  { value: "in_progress", label: "In progress" },
  { value: "in_review", label: "In review" },
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

export interface NewQuestModalProps {
  open: boolean;
  agentId: string;
  initialStatus?: QuestStatus;
  parentQuestId?: string | null;
  onClose: () => void;
  onCreated: (quest: Quest) => Promise<void> | void;
}

export default function NewQuestModal({
  open,
  agentId,
  initialStatus = "todo",
  parentQuestId,
  onClose,
  onCreated,
}: NewQuestModalProps) {
  const track = useTrack();
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [status, setStatus] = useState<QuestStatus>(initialStatus);
  const [priority, setPriority] = useState<QuestPriority>("normal");
  const [scope, setScope] = useState<ScopeValue>("self");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setBrief("");
    setStatus(initialStatus);
    setPriority("normal");
    setScope("self");
    setSubmitting(false);
    setError(null);
  }, [open, initialStatus, parentQuestId]);

  const handleClose = () => {
    if (submitting) return;
    onClose();
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const trimmedName = name.trim();
    const trimmedBrief = brief.trim();
    if (!trimmedName) {
      setError("Enter a quest name.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const response = await api.createQuest({
        project: agentId,
        agent_id: agentId,
        priority,
        scope,
        parent: parentQuestId ?? undefined,
        idea: {
          name: trimmedName,
          content: trimmedBrief,
          tags: ["quest"],
          agent_id: agentId,
          scope,
        },
      });
      const quest = response.quest;
      if (!quest?.id) throw new Error(response.error || "Quest was not created.");
      try {
        await api.updateQuest(quest.id, { status, priority, scope });
      } catch {
        /* Quest exists; lifecycle fields remain editable from the board/detail. */
      }
      track(Events.QuestCreated, {
        surface: "new-quest-modal",
        priority,
        scope,
        status,
        ...(parentQuestId ? { parent: parentQuestId } : {}),
      });
      await onCreated({ ...quest, status, priority, scope, idea: response.idea ?? quest.idea });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create quest.");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={parentQuestId ? "New subquest" : "New quest"}
      description={
        parentQuestId
          ? "Create a child quest under the current focus."
          : "Create a quest and its linked idea in one step."
      }
      className="aeqi-form-modal"
      footer={
        <div className="aeqi-form-modal__footer">
          {error && (
            <div className="aeqi-form-modal__error" role="alert">
              {error}
            </div>
          )}
          <div className="aeqi-form-modal__actions">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="new-quest-form"
              variant="primary"
              size="sm"
              loading={submitting}
            >
              Create quest
            </Button>
          </div>
        </div>
      }
    >
      <form id="new-quest-form" className="aeqi-form-modal__form" onSubmit={handleSubmit}>
        <Input
          id="new-quest-name"
          label="Quest name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Review launch checklist"
          autoFocus
          required
        />

        <Textarea
          id="new-quest-brief"
          label="Brief"
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="What should be done, checked, or produced?"
          hint="Optional. This becomes the linked idea body."
          rows={4}
        />

        <div className="aeqi-form-modal__grid">
          <label className="aeqi-form-modal__field" htmlFor="new-quest-status">
            <span>Status</span>
            <Select
              id="new-quest-status"
              options={STATUS_OPTIONS}
              value={status}
              onChange={(value) => setStatus(value as QuestStatus)}
              fullWidth
            />
          </label>
          <label className="aeqi-form-modal__field" htmlFor="new-quest-priority">
            <span>Priority</span>
            <Select
              id="new-quest-priority"
              options={PRIORITY_OPTIONS}
              value={priority}
              onChange={(value) => setPriority(value as QuestPriority)}
              fullWidth
            />
          </label>
          <label className="aeqi-form-modal__field" htmlFor="new-quest-scope">
            <span>Visibility</span>
            <Select
              id="new-quest-scope"
              options={SCOPE_OPTIONS}
              value={scope}
              onChange={(value) => setScope(value as ScopeValue)}
              fullWidth
            />
          </label>
        </div>
      </form>
    </Modal>
  );
}
