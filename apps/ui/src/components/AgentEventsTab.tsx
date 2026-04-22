import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentDataStore } from "@/store/agentData";
import { Button } from "./ui";
import TestTriggerPanel from "./TestTriggerPanel";
import EventEditor from "./EventEditor";
import EventCanvas from "./EventCanvas";
import EventsOverview from "./EventsOverview";
import EventTraceTab from "./EventTraceTab";
import type { AgentEvent } from "@/lib/types";

/**
 * AgentEventsTab — the per-agent events surface.
 *
 * Three views, switched via a sub-tab bar that styles itself like the
 * primitive-head pattern (lowercase brand-tinted labels):
 *
 *   list    — dense row picker grouped local/global
 *   canvas  — workflow view:
 *               • no selection → EventsOverview (every event as a
 *                 mini trigger→tools sparkline, grouped by transport)
 *               • selection    → EventCanvas (full per-event pipeline)
 *                                plus the EventEditor form beneath
 *   trace   — existing per-session fire inspector (unchanged surface)
 *
 * Events are AEQI's workflow primitive — a pattern + an ordered tool
 * chain. The canvas is what makes that readable.
 */

const NO_EVENTS: AgentEvent[] = [];

function eventLabel(ev: AgentEvent): string {
  return ev.name.replace(/^on_/, "").replace(/_/g, " ");
}
function eventTransport(ev: AgentEvent): string | null {
  const prefix = ev.pattern.split(":")[0];
  if (prefix === "session") return null;
  return prefix.toUpperCase();
}

type SubTab = "list" | "canvas" | "trace";

/**
 * Transport presets power the guided new-event flow. The old free-text
 * pattern input demanded users already know AEQI's event vocabulary;
 * picking a transport first and a lifecycle moment second collapses that.
 */
interface TransportPreset {
  id: string;
  label: string;
  desc: string;
  patterns: { value: string; label: string }[];
}

const TRANSPORT_PRESETS: TransportPreset[] = [
  {
    id: "session",
    label: "session · lifecycle",
    desc: "Fires at a moment in this agent's own reasoning loop.",
    patterns: [
      { value: "session:start", label: "session starts (system-prompt moment)" },
      { value: "session:step_start", label: "before every step" },
      { value: "session:quest_start", label: "when a quest starts" },
      { value: "session:quest_end", label: "when a quest ends" },
      { value: "session:quest_result", label: "when a quest produces a result" },
      { value: "session:stopped", label: "when the session stops" },
    ],
  },
  {
    id: "context",
    label: "context · budget",
    desc: "Fires when context limits trip — the compaction hook.",
    patterns: [{ value: "context:budget:exceeded", label: "context budget exceeded" }],
  },
  {
    id: "loop",
    label: "loop · guardrail",
    desc: "Middleware-detected pattern — auto-intervene when the agent loops.",
    patterns: [{ value: "loop:detected", label: "loop detected" }],
  },
  {
    id: "webhook",
    label: "webhook · external http",
    desc: "Fires when an HTTP request lands on this agent's webhook URL.",
    patterns: [
      { value: "webhook:generic", label: "any incoming webhook" },
      { value: "webhook:github", label: "GitHub webhook" },
      { value: "webhook:stripe", label: "Stripe webhook" },
    ],
  },
  {
    id: "telegram",
    label: "telegram · chat",
    desc: "Fires when a user messages this agent on Telegram.",
    patterns: [
      { value: "telegram:update", label: "any telegram update" },
      { value: "telegram:command", label: "only /-commands" },
    ],
  },
  {
    id: "custom",
    label: "custom · free-form",
    desc: "Anything else — type the pattern yourself.",
    patterns: [],
  },
];

export default function AgentEventsTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;

  const [activeSubTab, setActiveSubTab] = useState<SubTab>("canvas");
  const [traceSessionId, setTraceSessionId] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [showTriggerPanel, setShowTriggerPanel] = useState(false);

  const events = useAgentDataStore((s) => s.eventsByAgent[agentId] ?? NO_EVENTS);
  const loadEvents = useAgentDataStore((s) => s.loadEvents);
  const patchEvent = useAgentDataStore((s) => s.patchEvent);
  const removeEvent = useAgentDataStore((s) => s.removeEvent);

  useEffect(() => {
    loadEvents(agentId);
  }, [agentId, loadEvents]);

  useEffect(() => {
    setShowTriggerPanel(false);
  }, [selectedId]);

  useEffect(() => {
    const handler = () => setShowAddForm(true);
    window.addEventListener("aeqi:new-event", handler);
    return () => window.removeEventListener("aeqi:new-event", handler);
  }, []);

  const selected = events.find((e) => e.id === selectedId) ?? null;

  /* ── Add form state ────────────────────────────────────────────── */
  const [newName, setNewName] = useState("");
  const [newPattern, setNewPattern] = useState("session:start");
  const [newTransport, setNewTransport] = useState<string>("session");
  const [newCooldown, setNewCooldown] = useState("");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const resetAddForm = () => {
    setNewName("");
    setNewTransport("session");
    setNewPattern("session:start");
    setNewCooldown("");
    setCreateError(null);
  };

  useEffect(() => {
    if (showAddForm) resetAddForm();
  }, [showAddForm]);

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

  /* ── Sub-tabs header — standard tabs, no brand flourish ──────── */
  const SUB_TAB_LABELS: Record<SubTab, string> = {
    list: "List",
    canvas: "Canvas",
    trace: "Trace",
  };
  const subTabBar = (
    <div className="events-subtabs" role="tablist" aria-label="Events view">
      {(["list", "canvas", "trace"] as SubTab[]).map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={activeSubTab === id}
          className={`events-subtab${activeSubTab === id ? " active" : ""}`}
          onClick={() => setActiveSubTab(id)}
        >
          {SUB_TAB_LABELS[id]}
        </button>
      ))}
      {activeSubTab === "trace" && (
        <div className="events-subtabs-aside">
          <label className="events-subtabs-aside-label" htmlFor="trace-session-id">
            session
          </label>
          <input
            id="trace-session-id"
            className="events-subtabs-aside-input"
            type="text"
            value={traceSessionId}
            onChange={(e) => setTraceSessionId(e.target.value)}
            placeholder="paste session id"
          />
        </div>
      )}
    </div>
  );

  /* ── Trace view (unchanged surface, just wrapped) ─────────────── */
  if (activeSubTab === "trace") {
    return (
      <div className="asv-main events-surface">
        {subTabBar}
        <EventTraceTab sessionId={traceSessionId} />
      </div>
    );
  }

  /* ── Add-event form (guided transport picker) ─────────────────── */
  if (showAddForm) {
    const preset = TRANSPORT_PRESETS.find((t) => t.id === newTransport) ?? TRANSPORT_PRESETS[0];
    return (
      <div className="asv-main events-surface events-surface--scroll">
        <div className="events-addform">
          <div className="events-addform-head">
            <div>
              <div className="events-addform-eyebrow">new event</div>
              <div className="events-addform-title">Wire a new pipeline</div>
            </div>
            <button
              type="button"
              className="events-addform-close"
              onClick={() => setShowAddForm(false)}
              aria-label="Cancel"
            >
              ×
            </button>
          </div>

          <div className="events-addform-section">
            <div className="events-addform-label">Transport</div>
            <div className="events-addform-transports">
              {TRANSPORT_PRESETS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`events-addform-transport${newTransport === t.id ? " active" : ""}`}
                  onClick={() => {
                    setNewTransport(t.id);
                    if (t.patterns.length > 0) setNewPattern(t.patterns[0].value);
                  }}
                >
                  <div className="events-addform-transport-label">{t.label}</div>
                  <div className="events-addform-transport-desc">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {preset.patterns.length > 0 && (
            <div className="events-addform-section">
              <div className="events-addform-label">Pattern</div>
              <div className="events-addform-patterns">
                {preset.patterns.map((p) => (
                  <label
                    key={p.value}
                    className={`events-addform-pattern${newPattern === p.value ? " active" : ""}`}
                  >
                    <input
                      type="radio"
                      name="pattern"
                      value={p.value}
                      checked={newPattern === p.value}
                      onChange={() => setNewPattern(p.value)}
                    />
                    <span className="events-addform-pattern-value">{p.value}</span>
                    <span className="events-addform-pattern-label">{p.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {preset.id === "custom" && (
            <div className="events-addform-section">
              <div className="events-addform-label">Pattern</div>
              <input
                className="events-addform-input"
                type="text"
                placeholder="my_transport:my_event"
                value={newPattern}
                onChange={(e) => setNewPattern(e.target.value)}
              />
            </div>
          )}

          <div className="events-addform-row">
            <div className="events-addform-section events-addform-section--grow">
              <div className="events-addform-label">Name</div>
              <input
                className="events-addform-input"
                type="text"
                placeholder="on_session_start"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </div>
            <div className="events-addform-section">
              <div className="events-addform-label">Cooldown (s)</div>
              <input
                className="events-addform-input"
                type="number"
                min={0}
                placeholder="0"
                value={newCooldown}
                onChange={(e) => setNewCooldown(e.target.value)}
              />
            </div>
          </div>

          {createError && <div className="events-addform-error">{createError}</div>}

          <div className="events-addform-actions">
            <Button
              variant="primary"
              onClick={handleCreateEvent}
              loading={saving}
              disabled={saving}
            >
              Create event
            </Button>
            <Button variant="ghost" onClick={() => setShowAddForm(false)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  /* ── No selection ─────────────────────────────────────────────── */
  if (!selected) {
    return (
      <div className="asv-main events-surface events-surface--scroll">
        {subTabBar}
        {activeSubTab === "canvas" ? (
          <EventsOverview
            events={events}
            onSelect={(id) => goAgent(agentId, "events", id)}
            onNew={() => setShowAddForm(true)}
          />
        ) : (
          <EventsList
            agentId={agentId}
            events={events}
            onSelect={(id) => goAgent(agentId, "events", id)}
            onNew={() => setShowAddForm(true)}
          />
        )}
      </div>
    );
  }

  /* ── Selection: canvas + editor ───────────────────────────────── */
  const isGlobal = selected.agent_id == null;

  return (
    <div className="asv-main events-surface events-surface--scroll">
      {subTabBar}

      <div className="events-detail">
        <div className="events-detail-header">
          <div>
            <h3 className="events-detail-name">
              {selected.name}
              {isGlobal && (
                <span
                  className="events-detail-badge-global"
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
          <div className="events-detail-global-notice">
            Inherited global event — fires for every agent at this lifecycle moment. Manage from
            Settings; per-agent edits are disabled.
          </div>
        )}

        {activeSubTab === "canvas" && <EventCanvas event={selected} />}

        {activeSubTab === "list" && (
          <div className="events-detail-stats">
            {selected.fire_count > 0 ? (
              <>
                Fired {selected.fire_count} time{selected.fire_count === 1 ? "" : "s"}
                {selected.last_fired
                  ? ` · last ${new Date(selected.last_fired).toLocaleString()}`
                  : ""}
                {selected.total_cost_usd > 0
                  ? ` · $${selected.total_cost_usd.toFixed(4)} total`
                  : ""}
              </>
            ) : (
              <span className="events-detail-stats-idle">Never fired</span>
            )}
          </div>
        )}

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
    </div>
  );
}

/* ── List view (existing dense row picker, class-only, no inline styles) ── */

function EventsList({
  agentId,
  events,
  onSelect,
  onNew,
}: {
  agentId: string;
  events: AgentEvent[];
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { local, global } = useMemo(() => {
    const local: AgentEvent[] = [];
    const global: AgentEvent[] = [];
    for (const ev of events) {
      (ev.agent_id == null ? global : local).push(ev);
    }
    return { local, global };
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="events-list events-list--empty">
        <button type="button" className="inline-picker-empty-cta" onClick={onNew}>
          <span className="inline-picker-empty-cta-label">No events yet</span>
          <span className="inline-picker-empty-cta-hint">New event</span>
        </button>
      </div>
    );
  }

  return (
    <div className="events-list">
      {local.length > 0 && (
        <Section label={`events · ${agentId.slice(0, 8)}`} count={local.length}>
          {local.map((ev) => (
            <EventRow key={ev.id} event={ev} onSelect={onSelect} />
          ))}
        </Section>
      )}
      {global.length > 0 && (
        <Section label="global · inherited" count={global.length}>
          {global.map((ev) => (
            <EventRow key={ev.id} event={ev} onSelect={onSelect} />
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="inline-picker-group">
        <span className="inline-picker-group-label">{label}</span>
        <span className="inline-picker-group-rule" />
        <span className="inline-picker-group-count">{count}</span>
      </div>
      {children}
    </>
  );
}

function EventRow({ event, onSelect }: { event: AgentEvent; onSelect: (id: string) => void }) {
  const { itemId } = useParams<{ itemId?: string }>();
  const transport = eventTransport(event);
  const isGlobal = event.agent_id == null;
  const meta =
    event.fire_count > 0
      ? `${event.fire_count} fire${event.fire_count === 1 ? "" : "s"}`
      : event.idea_ids.length > 0
        ? `${event.idea_ids.length} idea${event.idea_ids.length === 1 ? "" : "s"}`
        : "";
  return (
    <button
      type="button"
      className={`events-list-row${event.id === itemId ? " active" : ""}${
        !event.enabled ? " is-dimmed" : ""
      }`}
      aria-current={event.id === itemId ? "true" : undefined}
      onClick={() => onSelect(event.id)}
    >
      <span className="events-list-row-badge">{isGlobal ? "GLOBAL" : transport || "SYS"}</span>
      <span className="events-list-row-name">{eventLabel(event)}</span>
      <span className="events-list-row-pattern">{event.pattern}</span>
      <span className="events-list-row-meta">{meta}</span>
    </button>
  );
}
