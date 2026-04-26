import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentDataStore } from "@/store/agentData";
import { Button, Select } from "./ui";
import TestTriggerPanel from "./TestTriggerPanel";
import EventEditor from "./EventEditor";
import EventCanvas from "./EventCanvas";
import EventsOverview from "./EventsOverview";
import EventTraceTab from "./EventTraceTab";
import type { AgentEvent, ScopeValue } from "@/lib/types";

/**
 * AgentEventsTab — the per-agent events surface.
 *
 * Wears the same primitive-head as Ideas: Exo 2 "Events" title on the
 * left, scope tabs (all / mine / global / inherited) inline beside it;
 * right cluster holds count, the view toggle (list · canvas · trace),
 * and the `+ new event` CTA.
 *
 *   list    — dense row picker grouped by scope
 *   canvas  — workflow view:
 *               • no selection → EventsOverview (every event as a
 *                 mini trigger→tools sparkline, grouped by transport)
 *               • selection    → EventCanvas (full per-event pipeline)
 *                                plus the EventEditor form beneath
 *   trace   — per-session fire inspector with a session-id aside row
 *
 * Events are aeqi's WHEN primitive — a pattern + an ordered tool chain.
 * The canvas is what makes that readable.
 */

const NO_EVENTS: AgentEvent[] = [];

const SCOPE_VALUES: ScopeValue[] = ["self", "siblings", "children", "branch", "global"];
type EventsFilter = "all" | ScopeValue | "inherited";
const EVENTS_FILTERS: EventsFilter[] = [
  "all",
  "self",
  "siblings",
  "children",
  "branch",
  "global",
  "inherited",
];

/**
 * Whether an event is "inherited" — visible to this agent but anchored
 * on a different agent. Cross-cuts scope tabs.
 */
function isInherited(ev: AgentEvent, agentId: string): boolean {
  return ev.agent_id != null && ev.agent_id !== agentId;
}

/**
 * Match an event against the active filter.
 */
function matchesFilter(ev: AgentEvent, filter: EventsFilter, agentId: string): boolean {
  if (filter === "all") return true;
  if (filter === "inherited") return isInherited(ev, agentId);
  // scope-based: match ev.scope if present, else fall back to heuristic
  if (ev.scope != null) return ev.scope === filter;
  // Fallback heuristics when scope is not yet on the wire
  if (filter === "self") return ev.agent_id === agentId;
  if (filter === "global") return ev.agent_id == null;
  return false;
}

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
 * pattern input demanded users already know aeqi's event vocabulary;
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
  const [scope, setScope] = useState<EventsFilter>("all");
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

  /* ── Scope counts + filtered list ─────────────────────────────── */
  const scopeCounts = useMemo<Record<EventsFilter, number>>(() => {
    const counts = Object.fromEntries(EVENTS_FILTERS.map((f) => [f, 0])) as Record<
      EventsFilter,
      number
    >;
    for (const ev of events) {
      counts.all += 1;
      if (isInherited(ev, agentId)) {
        counts.inherited += 1;
      }
      if (ev.scope != null && SCOPE_VALUES.includes(ev.scope)) {
        counts[ev.scope] += 1;
      } else if (ev.agent_id === agentId) {
        counts.self += 1;
      } else if (ev.agent_id == null) {
        counts.global += 1;
      }
    }
    return counts;
  }, [events, agentId]);

  const filteredEvents = useMemo(() => {
    if (scope === "all") return events;
    return events.filter((ev) => matchesFilter(ev, scope, agentId));
  }, [events, scope, agentId]);

  /* ── Add form state ────────────────────────────────────────────── */
  const [newName, setNewName] = useState("");
  const [newPattern, setNewPattern] = useState("session:start");
  const [newTransport, setNewTransport] = useState<string>("session");
  const [newCooldown, setNewCooldown] = useState("");
  const [newScope, setNewScope] = useState<ScopeValue>("self");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const resetAddForm = () => {
    setNewName("");
    setNewTransport("session");
    setNewPattern("session:start");
    setNewCooldown("");
    setNewScope("self");
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
        scope: newScope,
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

  /* ── Primitive head — Exo 2 title + scope tabs + view toggle ──
     When an event is open, the heading becomes a back-link to the
     list so there's always a one-click return from detail. */
  const scopeControl = <EventsScopeTabs scope={scope} counts={scopeCounts} onChange={setScope} />;
  const head = (
    <EventsPrimitiveHead
      countLabel={
        filteredEvents.length === events.length
          ? undefined
          : `${filteredEvents.length} of ${events.length}`
      }
      view={activeSubTab}
      onViewChange={setActiveSubTab}
      onNew={() => setShowAddForm(true)}
      scopeControl={scopeControl}
      onBack={
        selectedId ? () => goAgent(agentId, "events", undefined, { replace: true }) : undefined
      }
    />
  );
  const traceAside =
    activeSubTab === "trace" ? (
      <div className="events-trace-aside">
        <label className="events-trace-aside-label" htmlFor="trace-session-id">
          session
        </label>
        <input
          id="trace-session-id"
          className="events-trace-aside-input"
          type="text"
          value={traceSessionId}
          onChange={(e) => setTraceSessionId(e.target.value)}
          placeholder="paste session id"
        />
      </div>
    ) : null;

  /* ── Trace view (unchanged surface, just wrapped) ─────────────── */
  if (activeSubTab === "trace") {
    return (
      <div className="asv-main events-surface">
        {head}
        {traceAside}
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
              <div className="events-addform-label">Scope</div>
              <Select
                size="sm"
                value={newScope}
                onChange={(v) => setNewScope(v as ScopeValue)}
                options={SCOPE_VALUES.map((s) => ({ value: s, label: s }))}
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
        {head}
        {activeSubTab === "canvas" ? (
          <EventsOverview
            events={filteredEvents}
            onSelect={(id) => goAgent(agentId, "events", id)}
            onNew={() => setShowAddForm(true)}
          />
        ) : (
          <EventsList
            agentId={agentId}
            events={filteredEvents}
            scope={scope}
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
      {head}

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

/* ── List view (dense row picker grouped by scope bucket) ── */

function EventsList({
  agentId,
  events,
  scope,
  onSelect,
  onNew,
}: {
  agentId: string;
  events: AgentEvent[];
  scope: EventsFilter;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  // Group into buckets for the "all" view.
  const buckets = useMemo(() => {
    const self: AgentEvent[] = [];
    const siblings: AgentEvent[] = [];
    const children: AgentEvent[] = [];
    const branch: AgentEvent[] = [];
    const global: AgentEvent[] = [];
    const inherited: AgentEvent[] = [];
    for (const ev of events) {
      if (isInherited(ev, agentId)) inherited.push(ev);
      const sc =
        ev.scope ?? (ev.agent_id == null ? "global" : ev.agent_id === agentId ? "self" : null);
      if (sc === "self") self.push(ev);
      else if (sc === "siblings") siblings.push(ev);
      else if (sc === "children") children.push(ev);
      else if (sc === "branch") branch.push(ev);
      else if (sc === "global" || ev.agent_id == null) global.push(ev);
    }
    return { self, siblings, children, branch, global, inherited };
  }, [events, agentId]);

  if (events.length === 0) {
    return (
      <div className="events-list events-list--empty">
        <button type="button" className="inline-picker-empty-cta" onClick={onNew}>
          <span className="inline-picker-empty-cta-label">
            {scope === "all" ? "No events yet" : `No ${scope} events`}
          </span>
          <span className="inline-picker-empty-cta-hint">New event</span>
        </button>
      </div>
    );
  }

  // When the user has narrowed the scope to one bucket, the page title
  // already communicates it — don't duplicate with a group header.
  const showSections = scope === "all";

  return (
    <div className="events-list">
      {showSections ? (
        <>
          {buckets.self.length > 0 && (
            <Section label={`self · ${agentId.slice(0, 8)}`} count={buckets.self.length}>
              {buckets.self.map((ev) => (
                <EventRow key={ev.id} event={ev} agentId={agentId} onSelect={onSelect} />
              ))}
            </Section>
          )}
          {buckets.siblings.length > 0 && (
            <Section label="siblings" count={buckets.siblings.length}>
              {buckets.siblings.map((ev) => (
                <EventRow key={ev.id} event={ev} agentId={agentId} onSelect={onSelect} />
              ))}
            </Section>
          )}
          {buckets.children.length > 0 && (
            <Section label="children" count={buckets.children.length}>
              {buckets.children.map((ev) => (
                <EventRow key={ev.id} event={ev} agentId={agentId} onSelect={onSelect} />
              ))}
            </Section>
          )}
          {buckets.branch.length > 0 && (
            <Section label="branch" count={buckets.branch.length}>
              {buckets.branch.map((ev) => (
                <EventRow key={ev.id} event={ev} agentId={agentId} onSelect={onSelect} />
              ))}
            </Section>
          )}
          {buckets.global.length > 0 && (
            <Section label="global · every agent" count={buckets.global.length}>
              {buckets.global.map((ev) => (
                <EventRow key={ev.id} event={ev} agentId={agentId} onSelect={onSelect} />
              ))}
            </Section>
          )}
          {buckets.inherited.length > 0 && (
            <Section label="inherited · other agents" count={buckets.inherited.length}>
              {buckets.inherited.map((ev) => (
                <EventRow key={ev.id} event={ev} agentId={agentId} onSelect={onSelect} />
              ))}
            </Section>
          )}
        </>
      ) : (
        events.map((ev) => (
          <EventRow key={ev.id} event={ev} agentId={agentId} onSelect={onSelect} />
        ))
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

function ScopeChip({ scope }: { scope: ScopeValue }) {
  if (scope === "self") return null;
  return <span className={`scope-chip scope-chip--${scope}`}>{scope}</span>;
}

function EventRow({
  event,
  agentId,
  onSelect,
}: {
  event: AgentEvent;
  agentId: string;
  onSelect: (id: string) => void;
}) {
  const { itemId } = useParams<{ itemId?: string }>();
  const transport = eventTransport(event);
  const isGlobal = event.agent_id == null;
  const inherited = isInherited(event, agentId);
  const meta =
    event.fire_count > 0
      ? `${event.fire_count} fire${event.fire_count === 1 ? "" : "s"}`
      : event.idea_ids.length > 0
        ? `${event.idea_ids.length} idea${event.idea_ids.length === 1 ? "" : "s"}`
        : "";
  // Resolve display scope for chip — prefer explicit field, fallback heuristic.
  const displayScope: ScopeValue | null =
    event.scope ?? (isGlobal ? "global" : event.agent_id === agentId ? "self" : null);
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
      <span className="events-list-row-name">
        {inherited && event.agent_id && (
          <span className="scope-inherited-prefix">from @{event.agent_id.slice(0, 8)}</span>
        )}
        {eventLabel(event)}
      </span>
      {displayScope && displayScope !== "self" && <ScopeChip scope={displayScope} />}
      <span className="events-list-row-pattern">{event.pattern}</span>
      <span className="events-list-row-meta">{meta}</span>
    </button>
  );
}

/* ── Primitive head + scope tabs + view toggle ─────────────────── */

const VIEW_LABELS: Record<SubTab, string> = {
  list: "list",
  canvas: "canvas",
  trace: "trace",
};

function EventsPrimitiveHead({
  countLabel,
  view,
  onViewChange,
  onNew,
  scopeControl,
  onBack,
}: {
  countLabel?: string;
  view: SubTab;
  onViewChange: (next: SubTab) => void;
  onNew: () => void;
  scopeControl?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <div className="primitive-head">
      <div className="primitive-head-lead">
        {onBack ? (
          <h2 className="primitive-head-heading">
            <button
              type="button"
              className="primitive-head-heading-back"
              onClick={onBack}
              title="Back to events"
              aria-label="Back to events"
            >
              <span className="primitive-head-heading-back-chevron" aria-hidden>
                ←
              </span>
              Events
            </button>
          </h2>
        ) : (
          <h2 className="primitive-head-heading">Events</h2>
        )}
        {scopeControl}
      </div>
      <div className="primitive-head-actions">
        {countLabel && <span className="primitive-head-meta">{countLabel}</span>}
        <EventsViewToggle view={view} onChange={onViewChange} />
        <button type="button" className="primitive-head-new" onClick={onNew} title="New event">
          <svg
            width="11"
            height="11"
            viewBox="0 0 12 12"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M6 2.5v7M2.5 6h7" />
          </svg>
          new event
        </button>
      </div>
    </div>
  );
}

function EventsViewToggle({ view, onChange }: { view: SubTab; onChange: (next: SubTab) => void }) {
  return (
    <div className="primitive-view-toggle" role="tablist" aria-label="View mode">
      <button
        type="button"
        role="tab"
        aria-selected={view === "list"}
        className={`primitive-view-toggle-btn${view === "list" ? " active" : ""}`}
        onClick={() => onChange("list")}
        title="List view"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
          <path
            d="M2 3h8M2 6h8M2 9h8"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </svg>
        {VIEW_LABELS.list}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "canvas"}
        className={`primitive-view-toggle-btn${view === "canvas" ? " active" : ""}`}
        onClick={() => onChange("canvas")}
        title="Canvas view"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          aria-hidden
        >
          <rect x="1.7" y="2.2" width="3.1" height="2.6" rx="0.4" />
          <rect x="7.2" y="2.2" width="3.1" height="2.6" rx="0.4" />
          <rect x="4.45" y="7.2" width="3.1" height="2.6" rx="0.4" />
          <path d="M4.8 3.5H7.2 M3.25 4.8V6.5H6 M8.75 4.8V6.5H6" strokeLinecap="round" />
        </svg>
        {VIEW_LABELS.canvas}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view === "trace"}
        className={`primitive-view-toggle-btn${view === "trace" ? " active" : ""}`}
        onClick={() => onChange("trace")}
        title="Trace view"
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.2"
          aria-hidden
        >
          <path
            d="M2 2.5 L4.5 6 L3 9.5 L6.5 7 L9.5 10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="2" cy="2.5" r="0.8" fill="currentColor" />
          <circle cx="9.5" cy="10" r="0.8" fill="currentColor" />
        </svg>
        {VIEW_LABELS.trace}
      </button>
    </div>
  );
}

function EventsScopeTabs({
  scope,
  counts,
  onChange,
}: {
  scope: EventsFilter;
  counts: Record<EventsFilter, number>;
  onChange: (next: EventsFilter) => void;
}) {
  return (
    <div className="primitive-scope-tabs" role="tablist" aria-label="Scope">
      {EVENTS_FILTERS.map((s) => {
        const isEmpty = counts[s] === 0;
        return (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={scope === s}
            className={`primitive-scope-tab${scope === s ? " active" : ""}${isEmpty && scope !== s ? " empty" : ""}`}
            onClick={() => onChange(s)}
          >
            {s}
            <span className="primitive-scope-tab-count">{counts[s]}</span>
          </button>
        );
      })}
    </div>
  );
}
