import { useEffect, useState } from "react";
import type { AgentEvent, ToolCall } from "@/lib/types";
import { Button } from "../ui";
import TestTriggerPanel from "../TestTriggerPanel";
import EventCanvasEditor, { type CanvasDraft } from "./EventCanvasEditor";
import FiresPanel from "./FiresPanel";

interface EventDetailProps {
  event: AgentEvent;
  agentId: string;
  onSave: (fields: SaveFields) => Promise<void>;
  onDelete: () => Promise<void>;
  onBack: () => void;
}

export interface SaveFields {
  name?: string;
  pattern?: string;
  cooldown_secs?: number;
  enabled?: boolean;
  tool_calls?: ToolCall[] | null;
}

function deepEqualToolCalls(a: ToolCall[], b: ToolCall[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default function EventDetail({
  event,
  agentId,
  onSave,
  onDelete,
  onBack,
}: EventDetailProps) {
  const isGlobal = event.agent_id == null;
  const isSystem = event.system === true;
  const readOnly = isGlobal || isSystem;

  const [name, setName] = useState(event.name);
  const [enabled, setEnabled] = useState(event.enabled);
  const [draft, setDraft] = useState<CanvasDraft>({
    pattern: event.pattern,
    cooldown_secs: event.cooldown_secs ?? 0,
    tool_calls: event.tool_calls ?? [],
  });

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showTrigger, setShowTrigger] = useState(false);
  const [showFires, setShowFires] = useState(false);

  // Reset local draft when the underlying event identity changes.
  useEffect(() => {
    setName(event.name);
    setEnabled(event.enabled);
    setDraft({
      pattern: event.pattern,
      cooldown_secs: event.cooldown_secs ?? 0,
      tool_calls: event.tool_calls ?? [],
    });
    setErr(null);
    setShowTrigger(false);
    setShowFires(false);
  }, [event.id]);

  const dirty =
    name !== event.name ||
    enabled !== event.enabled ||
    draft.pattern !== event.pattern ||
    draft.cooldown_secs !== (event.cooldown_secs ?? 0) ||
    !deepEqualToolCalls(draft.tool_calls, event.tool_calls ?? []);

  const handleSave = async () => {
    if (!name.trim() || !draft.pattern.trim()) {
      setErr("name and pattern are required");
      return;
    }
    setErr(null);
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        pattern: draft.pattern.trim(),
        cooldown_secs: draft.cooldown_secs,
        enabled,
        tool_calls: draft.tool_calls.length > 0 ? draft.tool_calls : null,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setName(event.name);
    setEnabled(event.enabled);
    setDraft({
      pattern: event.pattern,
      cooldown_secs: event.cooldown_secs ?? 0,
      tool_calls: event.tool_calls ?? [],
    });
    setErr(null);
  };

  return (
    <div className="events-detail">
      <header className="events-detail-strip">
        <div className="events-detail-strip-lead">
          <button
            type="button"
            className="events-detail-strip-back"
            onClick={onBack}
            title="Back to events"
            aria-label="Back to events"
          >
            <span aria-hidden>←</span>
          </button>
          <input
            className="events-detail-strip-name"
            type="text"
            value={name}
            readOnly={readOnly}
            disabled={readOnly}
            placeholder="event name"
            onChange={(e) => setName(e.target.value)}
            aria-label="Event name"
          />
          {isGlobal && (
            <span className="events-detail-strip-badge" title="Global event — every agent">
              global
            </span>
          )}
          {event.scope && event.scope !== "self" && (
            <span className={`scope-chip scope-chip--${event.scope}`}>{event.scope}</span>
          )}
        </div>
        <div className="events-detail-strip-actions">
          <label className="events-detail-strip-toggle" title="Enabled">
            <input
              type="checkbox"
              checked={enabled}
              disabled={readOnly}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            enabled
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowTrigger((v) => !v)}
            disabled={readOnly}
          >
            {showTrigger ? "hide test" : "test trigger"}
          </Button>
          {!readOnly && !event.pattern.startsWith("session:") && (
            <Button
              variant="secondary"
              size="sm"
              className="channel-disconnect-btn"
              onClick={onDelete}
            >
              delete
            </Button>
          )}
          {dirty && !readOnly && (
            <>
              <Button variant="ghost" size="sm" onClick={handleReset} disabled={saving}>
                reset
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSave}
                loading={saving}
                disabled={saving}
              >
                save
              </Button>
            </>
          )}
        </div>
      </header>

      {err && <div className="events-detail-error">{err}</div>}

      {readOnly && (
        <div className="events-detail-notice">
          {isGlobal
            ? "Inherited global event — fires for every agent at this lifecycle moment. Manage from Settings."
            : "System event — read-only."}
        </div>
      )}

      {showTrigger && (
        <TestTriggerPanel event={event} agentId={agentId} onClose={() => setShowTrigger(false)} />
      )}

      <EventCanvasEditor
        draft={draft}
        readOnly={readOnly}
        hasFired={event.fire_count > 0}
        fireCount={event.fire_count}
        lastFired={event.last_fired ?? null}
        totalCostUsd={event.total_cost_usd}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
        onShowFires={() => setShowFires((v) => !v)}
        firesOpen={showFires}
      />

      {showFires && (
        <FiresPanel
          eventName={event.name}
          pattern={event.pattern}
          fireCountHint={event.fire_count}
        />
      )}
    </div>
  );
}
