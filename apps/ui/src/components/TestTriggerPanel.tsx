import { useState } from "react";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";
import { Button, Select } from "./ui";
import type { AgentEvent } from "@/lib/types";

interface Props {
  event: AgentEvent;
  /** Agent ID from context — may be undefined for global events. */
  agentId?: string;
  onClose: () => void;
}

export default function TestTriggerPanel({ event, agentId, onClose }: Props) {
  const agents = useDaemonStore((s) => s.agents);

  // For global events with no agent context, let the user pick one.
  const isGlobal = event.agent_id == null;
  const [pickedAgentId, setPickedAgentId] = useState(agentId ?? "");

  const template = event.query_template ?? "";
  const needsQuestDescription = template.includes("{quest_description}");
  const needsUserPrompt = template.includes("{user_prompt}");
  const needsToolOutput = template.includes("{tool_output}");
  const [questDescription, setQuestDescription] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [toolOutput, setToolOutput] = useState("");

  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    system_prompt: string;
    matched_events: Array<{ name: string; pattern: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const effectiveAgentId = isGlobal ? pickedAgentId : (agentId ?? "");

  const handleRun = async () => {
    if (!effectiveAgentId.trim()) {
      setError("Select an agent first.");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const extra: Record<string, unknown> = {};
      if (needsQuestDescription && questDescription.trim()) {
        extra.quest_description = questDescription.trim();
      }
      if (needsUserPrompt && userPrompt.trim()) {
        extra.user_prompt = userPrompt.trim();
      }
      if (needsToolOutput && toolOutput.trim()) {
        extra.tool_output = toolOutput.trim();
      }
      const data = await api.triggerEvent(
        { agent_id: effectiveAgentId.trim() },
        event.pattern,
        Object.keys(extra).length > 0 ? extra : undefined,
      );
      setResult({
        system_prompt: data.system_prompt,
        matched_events: (data.matched_events ?? []) as Array<{ name: string; pattern: string }>,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setRunning(false);
    }
  };

  const handleCopy = () => {
    if (result?.system_prompt) {
      void navigator.clipboard.writeText(result.system_prompt);
    }
  };

  return (
    <div
      style={{
        marginTop: 16,
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        background: "var(--color-bg-elevated)",
        padding: "14px 16px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <span
          style={{
            fontWeight: 600,
            fontSize: "var(--font-size-sm)",
            color: "var(--color-text-primary)",
          }}
        >
          Test trigger
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 16,
            lineHeight: 1,
            color: "var(--color-text-muted)",
            padding: "0 2px",
          }}
          aria-label="Close"
        >
          &times;
        </button>
      </div>

      <div
        style={{
          marginBottom: 8,
          fontSize: "var(--font-size-xs)",
          color: "var(--color-text-secondary)",
        }}
      >
        <strong style={{ color: "var(--color-text-primary)" }}>{event.name}</strong>
        {" · "}
        <code
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-2xs)",
            background: "var(--color-bg-base)",
            padding: "1px 4px",
            borderRadius: "var(--radius-sm)",
          }}
        >
          {event.pattern}
        </code>
      </div>

      {isGlobal && (
        <div style={{ marginBottom: 10 }}>
          <label
            style={{
              display: "block",
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              marginBottom: 4,
              color: "var(--color-text-secondary)",
            }}
          >
            Agent
          </label>
          <Select
            size="sm"
            fullWidth
            value={pickedAgentId}
            onChange={(v) => setPickedAgentId(v)}
            placeholder="— pick an agent —"
            options={agents.map((a) => ({ value: a.id, label: a.name }))}
          />
        </div>
      )}

      {(needsQuestDescription || needsUserPrompt || needsToolOutput) && (
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              fontSize: "var(--font-size-2xs)",
              color: "var(--color-text-muted)",
              marginBottom: 6,
            }}
          >
            Template placeholders — fill these to simulate production context.
          </div>
          {needsQuestDescription && (
            <input
              className="agent-settings-input"
              type="text"
              placeholder="quest_description"
              value={questDescription}
              style={{ width: "100%", marginBottom: 6 }}
              onChange={(e) => setQuestDescription(e.target.value)}
            />
          )}
          {needsUserPrompt && (
            <input
              className="agent-settings-input"
              type="text"
              placeholder="user_prompt"
              value={userPrompt}
              style={{ width: "100%", marginBottom: 6 }}
              onChange={(e) => setUserPrompt(e.target.value)}
            />
          )}
          {needsToolOutput && (
            <input
              className="agent-settings-input"
              type="text"
              placeholder="tool_output"
              value={toolOutput}
              style={{ width: "100%", marginBottom: 6 }}
              onChange={(e) => setToolOutput(e.target.value)}
            />
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Button
          variant="primary"
          size="sm"
          onClick={handleRun}
          loading={running}
          disabled={running}
        >
          Run
        </Button>
        {error && (
          <span style={{ fontSize: "var(--font-size-xs)", color: "var(--color-error)" }}>
            {error}
          </span>
        )}
      </div>

      {result && (
        <div style={{ marginTop: 14 }}>
          {result.matched_events.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: "var(--font-size-xs)",
                  fontWeight: 500,
                  color: "var(--color-text-secondary)",
                  marginBottom: 4,
                }}
              >
                Matched events
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {result.matched_events.map((ev, i) => (
                  <span
                    key={i}
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--font-size-2xs)",
                      background: "var(--color-accent-subtle)",
                      color: "var(--color-accent)",
                      padding: "2px 6px",
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--color-border)",
                    }}
                    title={ev.pattern}
                  >
                    {ev.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              color: "var(--color-text-secondary)",
              marginBottom: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>Assembled context</span>
            <button
              onClick={handleCopy}
              style={{
                background: "none",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius-sm)",
                cursor: "pointer",
                fontSize: "var(--font-size-2xs)",
                padding: "2px 6px",
                color: "var(--color-text-secondary)",
              }}
            >
              Copy
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              padding: "10px 12px",
              background: "var(--color-bg-base)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-size-2xs)",
              lineHeight: 1.6,
              maxHeight: 320,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              color: "var(--color-text-primary)",
            }}
          >
            {result.system_prompt || "(empty)"}
          </pre>
        </div>
      )}
    </div>
  );
}
