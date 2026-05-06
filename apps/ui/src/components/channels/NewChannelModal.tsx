import { useEffect, useMemo, useState } from "react";
import { Button, Input, Modal } from "@/components/ui";
import { useDaemonStore } from "@/store/daemon";
import RoundAvatar from "@/components/RoundAvatar";
import type { InitialParticipant } from "@/api/conversation-channels";

interface NewChannelModalProps {
  entityId: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string, participants: InitialParticipant[]) => void;
}

interface PickerEntry {
  kind: "agent" | "user";
  id: string;
  label: string;
  avatar?: string | null;
}

/**
 * Modal for creating a new in-app channel.
 *
 * Two inputs: channel name + participant picker (search across this Company's
 * agents + the current user). Agents get pre-loaded so users can mention them
 * the moment the channel opens.
 */
export default function NewChannelModal({
  entityId,
  submitting,
  error,
  onClose,
  onSubmit,
}: NewChannelModalProps) {
  const [name, setName] = useState("");
  const [picker, setPicker] = useState("");
  const [picked, setPicked] = useState<PickerEntry[]>([]);

  const agents = useDaemonStore((s) => s.agents);
  const candidates: PickerEntry[] = useMemo(() => {
    const fromAgents = agents
      .filter((a) => a.entity_id === entityId)
      .map<PickerEntry>((a) => ({
        kind: "agent",
        id: a.id,
        label: a.name ?? a.id,
        avatar: a.avatar ?? null,
      }));
    return fromAgents;
  }, [agents, entityId]);

  const filtered = useMemo(() => {
    const q = picker.trim().toLowerCase();
    const not = new Set(picked.map((p) => `${p.kind}:${p.id}`));
    return candidates
      .filter((c) => !not.has(`${c.kind}:${c.id}`))
      .filter((c) => (q ? c.label.toLowerCase().includes(q) : true))
      .slice(0, 8);
  }, [candidates, picker, picked]);

  // Auto-focus name on open.
  useEffect(() => {
    // intentional empty effect; modal handles focus on first focusable
  }, []);

  const trimmed = name.trim();
  const valid = trimmed.length > 0;

  return (
    <Modal open onClose={onClose} title="New channel">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || submitting) return;
          onSubmit(
            trimmed,
            picked.map((p) => ({ kind: p.kind, id: p.id })),
          );
        }}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-4)",
          padding: "var(--space-4)",
        }}
      >
        <label
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-primary)",
          }}
        >
          <span>Name</span>
          <Input
            placeholder="e.g. product, ops, finance"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </label>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-primary)",
          }}
        >
          <span>Add agents (optional)</span>
          <Input
            placeholder="Search agents in this company"
            value={picker}
            onChange={(e) => setPicker(e.target.value)}
          />
          {picked.length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "var(--space-2)",
                marginTop: "var(--space-1)",
              }}
            >
              {picked.map((p) => (
                <button
                  key={`${p.kind}:${p.id}`}
                  type="button"
                  onClick={() =>
                    setPicked((prev) => prev.filter((x) => !(x.kind === p.kind && x.id === p.id)))
                  }
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "var(--space-2)",
                    padding: "4px 10px 4px 6px",
                    borderRadius: 999,
                    background: "var(--color-bg-subtle)",
                    color: "var(--color-text-primary)",
                    fontSize: "var(--font-size-xs)",
                    border: 0,
                    cursor: "pointer",
                  }}
                  title="Remove"
                >
                  <RoundAvatar name={p.label} size={18} src={p.avatar ?? undefined} />
                  {p.label}
                  <span aria-hidden style={{ color: "var(--color-text-muted)" }}>
                    ×
                  </span>
                </button>
              ))}
            </div>
          )}
          {filtered.length > 0 && (
            <ul
              role="listbox"
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                background: "var(--color-card)",
                borderRadius: "var(--radius-2)",
                boxShadow: "var(--shadow-sm)",
                maxHeight: 200,
                overflow: "auto",
              }}
            >
              {filtered.map((c) => (
                <li key={`${c.kind}:${c.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setPicked((prev) => [...prev, c]);
                      setPicker("");
                    }}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-2)",
                      padding: "var(--space-2) var(--space-3)",
                      background: "transparent",
                      border: 0,
                      textAlign: "left",
                      cursor: "pointer",
                      color: "var(--color-text-primary)",
                      fontSize: "var(--font-size-sm)",
                    }}
                  >
                    <RoundAvatar name={c.label} size={20} src={c.avatar ?? undefined} />
                    <span>{c.label}</span>
                    <span
                      style={{
                        marginLeft: "auto",
                        fontSize: "var(--font-size-xs)",
                        color: "var(--color-text-muted)",
                        textTransform: "lowercase",
                      }}
                    >
                      {c.kind}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <div
            role="alert"
            style={{
              fontSize: "var(--font-size-xs)",
              color: "var(--color-text-muted)",
            }}
          >
            {error}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: "var(--space-2)",
          }}
        >
          <Button variant="secondary" size="sm" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" disabled={!valid || submitting}>
            {submitting ? "Creating…" : "Create channel"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
