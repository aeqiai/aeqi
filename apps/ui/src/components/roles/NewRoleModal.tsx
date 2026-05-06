import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { Agent, OccupantKind, Role } from "@/lib/types";
import { Button, Input, Modal, Select } from "@/components/ui";

interface NewRoleModalProps {
  open: boolean;
  onClose: () => void;
  entityId: string;
  roles: Role[];
  agents: Agent[];
  onCreated: (role: Role) => void;
}

const KIND_OPTIONS = [
  { value: "vacant", label: "Vacant" },
  { value: "agent", label: "Agent" },
  { value: "human", label: "Human" },
];

/**
 * Modal form for creating a new role inside an entity. Title + kind
 * are always present; occupant is conditional on kind; parent is
 * optional. On success, the parent component appends the row to its list.
 */
export default function NewRoleModal({
  open,
  onClose,
  entityId,
  roles,
  agents,
  onCreated,
}: NewRoleModalProps) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<OccupantKind>("vacant");
  const [agentId, setAgentId] = useState("");
  const [humanId, setHumanId] = useState("");
  const [parentRoleId, setParentRoleId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopedAgents = useMemo(
    () => agents.filter((a) => a.entity_id === entityId || a.id === entityId),
    [agents, entityId],
  );

  const agentOptions = useMemo(
    () => scopedAgents.map((a) => ({ value: a.id, label: a.name })),
    [scopedAgents],
  );

  const parentOptions = useMemo(
    () => [
      { value: "", label: "None" },
      ...roles.map((p) => ({ value: p.id, label: p.title || "(untitled)" })),
    ],
    [roles],
  );

  const reset = () => {
    setTitle("");
    setKind("vacant");
    setAgentId("");
    setHumanId("");
    setParentRoleId("");
    setSubmitting(false);
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }

    let occupantId: string | undefined;
    if (kind === "agent") {
      if (!agentId) {
        setError("Select an agent for this role.");
        return;
      }
      occupantId = agentId;
    } else if (kind === "human") {
      const trimmedHuman = humanId.trim();
      if (!trimmedHuman) {
        setError("Enter a user id or email for this role.");
        return;
      }
      occupantId = trimmedHuman;
    }

    setSubmitting(true);
    try {
      const resp = await api.createRole({
        entity_id: entityId,
        title: trimmedTitle,
        occupant_kind: kind,
        ...(occupantId ? { occupant_id: occupantId } : {}),
        ...(parentRoleId ? { parent_role_id: parentRoleId } : {}),
      });
      onCreated(resp.role);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create role.");
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="New role">
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Title
          </span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Head of Engineering"
            autoFocus
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Occupant kind
          </span>
          <Select
            options={KIND_OPTIONS}
            value={kind}
            onChange={(v) => setKind(v as OccupantKind)}
            fullWidth
          />
        </label>

        {kind === "agent" && (
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span
              style={{
                fontSize: 12,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Agent
            </span>
            <Select
              options={agentOptions}
              value={agentId}
              onChange={setAgentId}
              placeholder={agentOptions.length === 0 ? "No agents in this entity" : "Select agent"}
              disabled={agentOptions.length === 0}
              fullWidth
            />
          </label>
        )}

        {kind === "human" && (
          <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <span
              style={{
                fontSize: 12,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Human
            </span>
            <Input
              value={humanId}
              onChange={(e) => setHumanId(e.target.value)}
              placeholder="user id or email"
            />
          </label>
        )}

        <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span
            style={{
              fontSize: 12,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Parent role
          </span>
          <Select
            options={parentOptions}
            value={parentRoleId}
            onChange={setParentRoleId}
            fullWidth
          />
        </label>

        {error && (
          <div style={{ fontSize: 13, color: "var(--color-error)" }} role="alert">
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--space-2)",
            marginTop: "var(--space-2)",
          }}
        >
          <Button
            variant="secondary"
            size="sm"
            type="button"
            onClick={handleClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={submitting}>
            Create role
          </Button>
        </div>
      </form>
    </Modal>
  );
}
