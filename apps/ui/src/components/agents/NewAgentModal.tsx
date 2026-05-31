import { useState, type FormEvent } from "react";
import { api } from "@/lib/api";
import type { Agent } from "@/lib/types";
import { Button, Input, Modal, Textarea } from "@/components/ui";

interface NewAgentModalProps {
  open: boolean;
  trustId: string;
  agents: Agent[];
  onClose: () => void;
  onCreated: (agentId: string) => Promise<void>;
}

interface SpawnAgentPayload {
  name: string;
  trust_id: string;
  system_prompt?: string;
}

export default function NewAgentModal({
  open,
  trustId,
  agents,
  onClose,
  onCreated,
}: NewAgentModalProps) {
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName("");
    setBrief("");
    setSubmitting(false);
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    const agentName = normalizeAgentName(name);
    if (!agentName) {
      setError("Enter an agent name.");
      return;
    }
    if (!/^[a-z0-9_-]+$/.test(agentName)) {
      setError("Use letters, numbers, hyphens, or underscores.");
      return;
    }
    if (agents.some((agent) => normalizeAgentName(agent.name) === agentName)) {
      setError(`An agent named ${agentName} already exists in this TRUST.`);
      return;
    }

    const trimmedBrief = brief.trim();
    const payload: SpawnAgentPayload = {
      name: agentName,
      trust_id: trustId,
      ...(trimmedBrief ? { system_prompt: `You are ${agentName}. ${trimmedBrief}` } : {}),
    };

    setSubmitting(true);
    try {
      const resp = await api.spawnAgent(payload as Parameters<typeof api.spawnAgent>[0]);
      reset();
      onClose();
      await onCreated(resp.agent.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create agent.");
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="New agent" className="aeqi-form-modal">
      <form className="aeqi-form-modal__form" onSubmit={handleSubmit}>
        <p className="aeqi-form-modal__copy">
          Create a blank agent in this TRUST. Agent templates stay available below the register.
        </p>

        <Input
          id="new-agent-name"
          label="Agent name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="research-agent"
          hint="Letters, numbers, hyphens, underscores. Spaces become hyphens."
          autoFocus
          required
        />

        <Textarea
          id="new-agent-brief"
          label="Charter"
          value={brief}
          onChange={(event) => setBrief(event.target.value)}
          placeholder="Own weekly market research and summarize the most important changes."
          hint="Optional. Stored as this agent's starting identity."
          rows={4}
        />

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
          <Button type="submit" variant="primary" size="sm" loading={submitting}>
            Create agent
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function normalizeAgentName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "-");
}
