import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentDataStore } from "@/store/agentData";
import { Button, EmptyState } from "./ui";
import TestTriggerPanel from "./TestTriggerPanel";
import EventEditor from "./EventEditor";
import EventTraceTab from "./EventTraceTab";
import type { AgentEvent } from "@/lib/types";

const NO_EVENTS: AgentEvent[] = [];

const COMMON_PATTERNS = [
  "session:start",
  "session:step_start",
  "session:stopped",
  "session:quest_start",
  "session:quest_end",
  "session:quest_result",
  "context:budget:exceeded",
  "loop:detected",
];

export default function AgentEventsTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;
  const [activeSubTab, setActiveSubTab] = useState<"handlers" | "trace">("handlers");
  const [traceSessionId, setTraceSessionId] = useState("");

  const events = useAgentDataStore((s) => s.eventsByAgent[agentId] ?? NO_EVENTS);
  const loadEvents = useAgentDataStore((s) => s.loadEvents);
  const patchEvent = useAgentDataStore((s) => s.patchEvent);
  const removeEvent = useAgentDataStore((s) => s.removeEvent);

  const [showTriggerPanel, setShowTriggerPanel] = useState(false);

  useEffect(() => {
    setShowTriggerPanel(false);
  }, [selectedId]);

  useEffect(() => {
    loadEvents(agentId);
  }, [agentId, loadEvents]);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPattern, setNewPattern] = useState("session:message");
  const [newCooldown, setNewCooldown] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showPatternSuggestions, setShowPatternSuggestions] = useState(false);

  const patternSuggestions = COMMON_PATTERNS.filter(
    (p) => p.startsWith(newPattern) && p !== newPattern,
  );

  useEffect(() => {
    const handler = () => {
      setShowAddForm(true);
      setNewName("");
      setNewPattern("session:message");
      setNewCooldown("");
      setCreateError(null);
    };
    window.addEventListener("aeqi:new-event", handler);
    return () => window.removeEventListener("aeqi:new-event", handler);
  }, []);

  const handleCreateEvent = async () => {
    setCreateError(null);
    if (!newName.trim() || !newPattern.trim()) {
      setCreateError("Name and pattern are required");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        agent_id: agentId,
        name: newName.trim(),
        pattern: newPattern.trim(),
        idea_ids: [],
        enabled: true,
        tool_calls: [],
      };
      const parsedCooldown = parseInt(newCooldown, 10);
      if (Number.isFinite(parsedCooldown) && parsedCooldown > 0) {
        payload.cooldown_secs = parsedCooldown;
      }
      await api.createEvent(payload);
      setShowAddForm(false);
      loadEvents(agentId);
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create event");
    } finally {
      setSaving(false);
    }
  };

  const selected = events.find((e) => e.id === selectedId);

  if (activeSubTab === "trace") {
    return (
      <div
        className="asv-main"
        style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 28px 0",
            borderBottom: "1px solid var(--border-faint)",
          }}
        >
          <button
            type="button"
            style={{
              padding: "4px 10px",
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              border: "none",
              borderBottom: "2px solid transparent",
              background: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
            }}
            onClick={() => setActiveSubTab("handlers")}
          >
            Handlers
          </button>
          <button
            type="button"
            style={{
              padding: "4px 10px",
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              border: "none",
              borderBottom: "2px solid var(--accent)",
              background: "none",
              cursor: "pointer",
              color: "var(--text-primary)",
            }}
          >
            Trace
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <label
              htmlFor="trace-session-id"
              style={{ fontSize: "var(--font-size-xs)", color: "var(--text-muted)" }}
            >
              Session ID:
            </label>
            <input
              id="trace-session-id"
              className="agent-settings-input"
              type="text"
              value={traceSessionId}
              onChange={(e) => setTraceSessionId(e.target.value)}
              placeholder="paste session id…"
              style={{ width: 240, fontSize: "var(--font-size-xs)" }}
            />
          </div>
        </div>
        <EventTraceTab sessionId={traceSessionId} />
      </div>
    );
  }

  if (showAddForm) {
    return (
      <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
        <h3 className="events-detail-name">New Event</h3>
        <div style={{ marginTop: 12, marginBottom: 10 }}>
          <label className="agent-settings-label">Name</label>
          <input
            className="agent-settings-input"
            type="text"
            placeholder="on_session_start"
            value={newName}
            style={{ width: "100%", marginTop: 4 }}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="agent-settings-label">Pattern</label>
          <div style={{ position: "relative" }}>
            <input
              className="agent-settings-input"
              type="text"
              placeholder="session:message or telegram:update"
              value={newPattern}
              style={{ width: "100%", marginTop: 4 }}
              onChange={(e) => {
                setNewPattern(e.target.value);
                setShowPatternSuggestions(true);
              }}
              onFocus={() => setShowPatternSuggestions(true)}
              onBlur={() => setTimeout(() => setShowPatternSuggestions(false), 150)}
            />
            {showPatternSuggestions && patternSuggestions.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 2px)",
                  left: 0,
                  right: 0,
                  zIndex: 20,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  background: "var(--bg-base)",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
                  overflow: "hidden",
                }}
              >
                {patternSuggestions.map((p) => (
                  <button
                    key={p}
                    type="button"
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "6px 10px",
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--text-primary)",
                    }}
                    onMouseDown={() => {
                      setNewPattern(p);
                      setShowPatternSuggestions(false);
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label className="agent-settings-label">Cooldown seconds (optional)</label>
          <input
            className="agent-settings-input"
            type="number"
            min={0}
            placeholder="0"
            value={newCooldown}
            style={{ width: 120, marginTop: 4 }}
            onChange={(e) => setNewCooldown(e.target.value)}
          />
        </div>
        {createError && <div className="channel-form-error">{createError}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Button variant="primary" onClick={handleCreateEvent} loading={saving} disabled={saving}>
            {saving ? "Creating…" : "Create"}
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setShowAddForm(false);
              setCreateError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (!selected) {
    return (
      <div
        className="asv-main"
        style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 28px 0",
            borderBottom: "1px solid var(--border-faint)",
            flexShrink: 0,
          }}
        >
          <button
            type="button"
            style={{
              padding: "4px 10px",
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              border: "none",
              borderBottom: "2px solid var(--accent)",
              background: "none",
              cursor: "pointer",
              color: "var(--text-primary)",
            }}
          >
            Handlers
          </button>
          <button
            type="button"
            style={{
              padding: "4px 10px",
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              border: "none",
              borderBottom: "2px solid transparent",
              background: "none",
              cursor: "pointer",
              color: "var(--text-muted)",
            }}
            onClick={() => setActiveSubTab("trace")}
          >
            Trace
          </button>
        </div>
        <div style={{ padding: "20px 28px", overflowY: "auto", flex: 1 }}>
          <EmptyState
            title="Select an event"
            description="Pick an event from the right to view or edit it."
          />
        </div>
      </div>
    );
  }

  const isGlobal = selected.agent_id == null;

  return (
    <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
      <div className="events-detail-header">
        <div>
          <h3 className="events-detail-name">
            {selected.name}
            {isGlobal && (
              <span
                style={{
                  marginLeft: 8,
                  fontSize: 10,
                  fontWeight: 500,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "rgba(0,0,0,0.08)",
                  color: "rgba(0,0,0,0.6)",
                  letterSpacing: "0.05em",
                  verticalAlign: "middle",
                }}
                title="Global event — inherited by every agent"
              >
                GLOBAL
              </span>
            )}
          </h3>
          <span className="events-detail-pattern">{selected.pattern}</span>
        </div>
        <div className="events-detail-actions">
          <Button variant="ghost" size="sm" onClick={() => setShowTriggerPanel((v) => !v)}>
            {showTriggerPanel ? "Hide test" : "Test trigger"}
          </Button>
          {!selected.system && !selected.pattern.startsWith("session:") && (
            <Button
              variant="secondary"
              size="sm"
              className="channel-disconnect-btn"
              onClick={async () => {
                await api.deleteEvent(selected.id);
                removeEvent(agentId, selected.id);
                goAgent(agentId, "events", undefined, { replace: true });
              }}
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      {showTriggerPanel && (
        <TestTriggerPanel
          event={selected}
          agentId={agentId}
          onClose={() => setShowTriggerPanel(false)}
        />
      )}

      {isGlobal && (
        <div
          style={{
            marginTop: 8,
            marginBottom: 8,
            padding: "8px 10px",
            fontSize: 12,
            background: "rgba(0,0,0,0.04)",
            borderRadius: 4,
            color: "rgba(0,0,0,0.65)",
          }}
        >
          Inherited global event — fires for every agent at this lifecycle moment. Manage from
          Settings; per-agent edits are disabled.
        </div>
      )}

      <div className="events-detail-stats">
        {selected.fire_count > 0 ? (
          <>
            Fired {selected.fire_count} time{selected.fire_count === 1 ? "" : "s"}
            {selected.last_fired ? ` · last ${new Date(selected.last_fired).toLocaleString()}` : ""}
            {selected.total_cost_usd > 0 ? ` · $${selected.total_cost_usd.toFixed(4)} total` : ""}
          </>
        ) : (
          <span style={{ color: "rgba(0,0,0,0.45)" }}>Never fired</span>
        )}
      </div>

      <EventEditor
        key={selected.id}
        event={selected}
        readOnly={isGlobal}
        onSave={async (fields) => {
          await api.updateEvent(selected.id, fields as Record<string, unknown>);
          patchEvent(agentId, selected.id, fields);
        }}
      />
    </div>
  );
}
