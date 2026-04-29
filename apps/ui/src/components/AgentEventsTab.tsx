import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import * as eventsApi from "@/api/events";
import { useAgentEvents, useAgentEventsCache } from "@/queries/events";
import type { AgentEvent, ScopeValue } from "@/lib/types";
import { Button, Select } from "./ui";
import { Events as TrackEvents, useTrack } from "@/lib/analytics";
import EventsToolbar from "./events/EventsToolbar";
import {
  type EventsFilterState,
  type EventsScope,
  type EventsGroup,
  EVENTS_SCOPE_VALUES,
  EVENTS_GROUP_VALUES,
} from "./events/EventsFilterPopover";
import { eventLifecycle } from "./events/lifecycle";
import EventsOverview from "./EventsOverview";
import EventDetail from "./events/EventDetail";

const NO_EVENTS: AgentEvent[] = [];
const SCOPE_VALUES: ScopeValue[] = ["self", "siblings", "children", "branch", "global"];

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
    id: "schedule",
    label: "schedule · cron",
    desc: "Fires on a clock — a cron expression drives the cadence.",
    patterns: [
      { value: "schedule:0 9 * * *", label: "daily at 09:00" },
      { value: "schedule:0 9 * * 1", label: "weekly Monday 09:00" },
      { value: "schedule:*/15 * * * *", label: "every 15 minutes" },
    ],
  },
  {
    id: "custom",
    label: "custom · free-form",
    desc: "Anything else — type the pattern yourself.",
    patterns: [],
  },
];

function isInherited(ev: AgentEvent, agentId: string): boolean {
  return ev.agent_id != null && ev.agent_id !== agentId;
}

function matchesScope(ev: AgentEvent, scope: EventsScope, agentId: string): boolean {
  if (scope === "all") return true;
  if (scope === "inherited") return isInherited(ev, agentId);
  if (scope === "global") return ev.agent_id == null;
  if (scope === "self") return ev.agent_id === agentId;
  return false;
}

function parseScope(raw: string | null): EventsScope {
  return EVENTS_SCOPE_VALUES.includes(raw as EventsScope) ? (raw as EventsScope) : "all";
}
function parseGroup(raw: string | null): EventsGroup {
  return EVENTS_GROUP_VALUES.includes(raw as EventsGroup) ? (raw as EventsGroup) : "all";
}

export default function AgentEventsTab({ agentId }: { agentId: string }) {
  const { goEntity, entityId } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;
  const [searchParams, setSearchParams] = useSearchParams();
  const track = useTrack();
  const composing = searchParams.get("compose") === "1";

  const filter: EventsFilterState = {
    scope: parseScope(searchParams.get("scope")),
    group: parseGroup(searchParams.get("group")),
    search: searchParams.get("q") ?? "",
  };

  const patchParams = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams);
      mut(params);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const onFilter = useCallback(
    (patch: Partial<EventsFilterState>) => {
      patchParams((p) => {
        if ("scope" in patch) {
          if (patch.scope && patch.scope !== "all") p.set("scope", patch.scope);
          else p.delete("scope");
        }
        if ("group" in patch) {
          if (patch.group && patch.group !== "all") p.set("group", patch.group);
          else p.delete("group");
        }
        if ("search" in patch) {
          if (patch.search) p.set("q", patch.search);
          else p.delete("q");
        }
      });
    },
    [patchParams],
  );

  const { data: events = NO_EVENTS } = useAgentEvents(agentId);
  const { invalidateEvents, patchEvent, removeEvent } = useAgentEventsCache(agentId);

  useEffect(() => {
    const handler = () => patchParams((p) => p.set("compose", "1"));
    window.addEventListener("aeqi:new-event", handler);
    return () => window.removeEventListener("aeqi:new-event", handler);
  }, [patchParams]);

  const selected = events.find((e) => e.id === selectedId) ?? null;

  /* ── Counts for filter popover ───────────────────────────────── */
  const scopeCounts = useMemo<Record<EventsScope, number>>(() => {
    const c: Record<EventsScope, number> = { all: 0, self: 0, inherited: 0, global: 0 };
    for (const ev of events) {
      c.all += 1;
      if (ev.agent_id == null) c.global += 1;
      else if (ev.agent_id === agentId) c.self += 1;
      if (isInherited(ev, agentId)) c.inherited += 1;
    }
    return c;
  }, [events, agentId]);

  const groupCounts = useMemo<Record<EventsGroup, number>>(() => {
    const c: Record<EventsGroup, number> = { all: 0, runtime: 0, webhooks: 0, routines: 0 };
    for (const ev of events) {
      c.all += 1;
      const g = eventLifecycle(ev);
      c[g] += 1;
    }
    return c;
  }, [events]);

  const filteredEvents = useMemo(() => {
    const q = filter.search.trim().toLowerCase();
    return events.filter((ev) => {
      if (!matchesScope(ev, filter.scope, agentId)) return false;
      if (filter.group !== "all" && eventLifecycle(ev) !== filter.group) return false;
      if (q) {
        const hay = `${ev.name} ${ev.pattern}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, filter.scope, filter.group, filter.search, agentId]);

  const openCompose = useCallback(() => patchParams((p) => p.set("compose", "1")), [patchParams]);
  const closeCompose = useCallback(() => patchParams((p) => p.delete("compose")), [patchParams]);

  /* ── Add form state (full-bleed overlay) ─────────────────────── */
  const [newName, setNewName] = useState("");
  const [newPattern, setNewPattern] = useState("session:start");
  const [newTransport, setNewTransport] = useState<string>("session");
  const [newCooldown, setNewCooldown] = useState("");
  const [newScope, setNewScope] = useState<ScopeValue>("self");
  const [saving, setSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const resetAddForm = useCallback(() => {
    setNewName("");
    setNewTransport("session");
    setNewPattern("session:start");
    setNewCooldown("");
    setNewScope("self");
    setCreateError(null);
  }, []);

  useEffect(() => {
    if (composing) resetAddForm();
  }, [composing, resetAddForm]);

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
      await eventsApi.createEvent(payload);
      track(TrackEvents.EventCreated, { surface: "agent-events-tab", scope: newScope });
      closeCompose();
      void invalidateEvents();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Failed to create event");
    } finally {
      setSaving(false);
    }
  };

  /* ── Render branches ─────────────────────────────────────────── */

  if (composing) {
    const preset = TRANSPORT_PRESETS.find((t) => t.id === newTransport) ?? TRANSPORT_PRESETS[0];
    return (
      <div className="asv-main events-surface">
        <div className="events-surface-body">
          <div className="events-addform">
            <div className="events-addform-head">
              <div>
                <div className="events-addform-eyebrow">new event</div>
                <div className="events-addform-title">Wire a new pipeline</div>
              </div>
              <button
                type="button"
                className="events-addform-close"
                onClick={closeCompose}
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
              <Button variant="secondary" onClick={closeCompose} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (selected) {
    return (
      <div className="asv-main events-surface">
        <div className="events-surface-body">
          <EventDetail
            event={selected}
            agentId={agentId}
            onSave={async (fields) => {
              await eventsApi.updateEvent(selected.id, fields as Record<string, unknown>);
              patchEvent(selected.id, fields);
            }}
            onDelete={async () => {
              await eventsApi.deleteEvent(selected.id);
              removeEvent(selected.id);
              goEntity(entityId, "events", undefined, { replace: true });
            }}
            onBack={() => goEntity(entityId, "events", undefined, { replace: true })}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="asv-main events-surface">
      <EventsToolbar
        filter={filter}
        onFilter={onFilter}
        scopeCounts={scopeCounts}
        groupCounts={groupCounts}
        onNew={openCompose}
      />
      <div className="events-surface-body">
        <EventsOverview
          events={filteredEvents}
          onSelect={(id) => goEntity(entityId, "events", id)}
          onNew={openCompose}
        />
      </div>
    </div>
  );
}
