import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { useNav } from "@/hooks/useNav";
import * as eventsApi from "@/api/events";
import { useAgentEventCounts, useAgentEvents, useAgentEventsCache } from "@/queries/events";
import type { Agent, AgentEvent, ScopeValue } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { Button, Icon, Select, Loading, Tooltip } from "./ui";
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
import { SCOPE_LABEL, SCOPE_PICKER_VALUES } from "./ideas/types";
import AgentAvatar from "./AgentAvatar";

const NO_EVENTS: AgentEvent[] = [];

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
    desc: "Defines what enters the agent loop at lifecycle moments.",
    patterns: [
      { value: "session:start", label: "session starts" },
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
    desc: "Controls compaction when context limits trip.",
    patterns: [{ value: "context:budget:exceeded", label: "context budget exceeded" }],
  },
  {
    id: "loop",
    label: "loop · guardrail",
    desc: "Lets the runtime intervene when reasoning gets stuck.",
    patterns: [{ value: "loop:detected", label: "loop detected" }],
  },
  {
    id: "schedule",
    label: "schedule · cron",
    desc: "Runs this agent's loop on a clock.",
    patterns: [
      { value: "schedule:0 9 * * *", label: "daily at 09:00" },
      { value: "schedule:0 9 * * 1", label: "weekly Monday 09:00" },
      { value: "schedule:*/15 * * * *", label: "every 15 minutes" },
    ],
  },
  {
    id: "custom",
    label: "custom · free-form",
    desc: "Use a runtime pattern that is already emitted elsewhere.",
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

function agentLivenessLabel(agent: Agent | null | undefined): string {
  if (!agent) return "agent";
  if (agent.status === "active") return "online";
  if (agent.status === "stopped") return "offline";
  return "idle";
}

function handlerCountLabel(count: number): string {
  return `${count} handler${count === 1 ? "" : "s"}`;
}

function paramsRecord(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  params.forEach((value, key) => {
    if (value) out[key] = value;
  });
  return out;
}

export default function AgentEventsTab({
  agentId,
  agentRail = false,
}: {
  agentId: string;
  agentRail?: boolean;
}) {
  const { goEntity, trustId, entityPath } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;
  const [searchParams, setSearchParams] = useSearchParams();
  const track = useTrack();
  const composing = searchParams.get("compose") === "1";
  const allAgents = useDaemonStore((s) => s.agents);
  const entityAgents = useMemo(
    () => (agentRail && trustId ? allAgents.filter((a) => a.trust_id === trustId) : []),
    [agentRail, allAgents, trustId],
  );
  const entityAgentIds = useMemo(() => entityAgents.map((agent) => agent.id), [entityAgents]);
  const { counts: eventCounts } = useAgentEventCounts(agentRail ? entityAgentIds : []);
  const selectedAgentParam = searchParams.get("agent");
  const activeAgentId = useMemo(() => {
    if (!agentRail) return agentId;
    if (selectedAgentParam && entityAgents.some((a) => a.id === selectedAgentParam)) {
      return selectedAgentParam;
    }
    return agentId;
  }, [agentRail, agentId, selectedAgentParam, entityAgents]);
  const activeAgent = useMemo(
    () => allAgents.find((a) => a.id === activeAgentId) ?? null,
    [allAgents, activeAgentId],
  );

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

  const { data: events = NO_EVENTS, isLoading: eventsLoading } = useAgentEvents(activeAgentId);
  const { invalidateEvents, patchEvent, removeEvent } = useAgentEventsCache(activeAgentId);

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
      else if (ev.agent_id === activeAgentId) c.self += 1;
      if (isInherited(ev, activeAgentId)) c.inherited += 1;
    }
    return c;
  }, [events, activeAgentId]);

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
      if (!matchesScope(ev, filter.scope, activeAgentId)) return false;
      if (filter.group !== "all" && eventLifecycle(ev) !== filter.group) return false;
      if (q) {
        const hay = `${ev.name} ${ev.pattern}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [events, filter.scope, filter.group, filter.search, activeAgentId]);

  const openCompose = useCallback(() => patchParams((p) => p.set("compose", "1")), [patchParams]);
  const closeCompose = useCallback(() => patchParams((p) => p.delete("compose")), [patchParams]);
  const switchAgent = useCallback(
    (nextAgentId: string) => {
      if (!agentRail || !trustId) return;
      const params = new URLSearchParams(searchParams);
      params.set("agent", nextAgentId);
      params.delete("compose");
      if (selectedId) {
        goEntity(trustId, "events", undefined, {
          search: paramsRecord(params),
        });
      } else {
        setSearchParams(params, { replace: true });
      }
    },
    [agentRail, goEntity, searchParams, selectedId, setSearchParams, trustId],
  );

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
        agent_id: activeAgentId,
        name: newName.trim(),
        pattern: newPattern.trim(),
        scope: newScope,
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

  const listHref = useMemo(() => {
    if (!agentRail || !trustId) return undefined;
    const params = new URLSearchParams(searchParams);
    params.set("agent", activeAgentId);
    params.delete("compose");
    const qs = params.toString();
    return `${entityPath(trustId, "events")}${qs ? `?${qs}` : ""}`;
  }, [activeAgentId, agentRail, entityPath, searchParams, trustId]);

  const frame = useCallback(
    (content: ReactNode) => {
      if (!agentRail) return content;
      return (
        <div className="events-workbench">
          <EventAgentRail
            agents={entityAgents}
            activeAgentId={activeAgentId}
            eventCounts={eventCounts}
            onSelect={switchAgent}
          />
          <div className="events-workbench-main">{content}</div>
        </div>
      );
    },
    [activeAgentId, agentRail, entityAgents, eventCounts, switchAgent],
  );

  /* ── Render branches ─────────────────────────────────────────── */

  if (composing) {
    const preset = TRANSPORT_PRESETS.find((t) => t.id === newTransport) ?? TRANSPORT_PRESETS[0];
    return frame(
      <div className="asv-main events-surface">
        <div className="events-surface-body">
          <div className="events-addform">
            <div className="events-addform-head">
              <div>
                <div className="events-addform-eyebrow">new handler</div>
                <div className="events-addform-title">
                  Add to {activeAgent?.name ?? "agent"} loop
                </div>
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
                <div className="events-addform-label">Visibility</div>
                <Select
                  size="sm"
                  value={newScope}
                  onChange={(v) => setNewScope(v as ScopeValue)}
                  options={SCOPE_PICKER_VALUES.map((s) => ({ value: s, label: SCOPE_LABEL[s] }))}
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
                disabled={saving || !activeAgentId}
              >
                Create event
              </Button>
              <Button variant="secondary" onClick={closeCompose} disabled={saving}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      </div>,
    );
  }

  if (selected) {
    // Detail mounts directly under `.asv-main events-surface` (a flex
    // column with `min-height:0; overflow:hidden`) so the canvas inside
    // EventDetail can claim full available height — mirrors the
    // IdeaCanvas shape. The `.events-surface-body` auto-scroll wrapper
    // only fits the list/compose branches.
    return frame(
      <div className="asv-main events-surface">
        <EventDetail
          event={selected}
          agentId={activeAgentId}
          backHref={listHref}
          onSave={async (fields) => {
            await eventsApi.updateEvent(selected.id, fields as Record<string, unknown>);
            patchEvent(selected.id, fields);
          }}
          onDelete={async () => {
            await eventsApi.deleteEvent(selected.id);
            removeEvent(selected.id);
            if (agentRail) {
              goEntity(trustId, "events", undefined, {
                replace: true,
                search: { agent: activeAgentId },
              });
            } else {
              goEntity(trustId, "events", undefined, { replace: true });
            }
          }}
        />
      </div>,
    );
  }

  if (eventsLoading) {
    return frame(
      <div className="asv-main events-surface">
        <div
          className="events-surface-body"
          style={{ display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <Loading size="md" />
        </div>
      </div>,
    );
  }

  return frame(
    <div className="asv-main events-surface">
      {/* Page header — matches the Quests-page pattern: display title on
         the left, primary CTA on the right, then the toolbar row beneath
         (search + filter). Anchors the surface with a destination label
         instead of jumping straight into the search field. */}
      <header className="events-list-header">
        <div className="events-list-title-block">
          <h1 className="events-list-title">Events</h1>
          {agentRail && (
            <div className="events-list-context">
              <span>Agent loop</span>
              <strong>{activeAgent?.name ?? "Select an agent"}</strong>
              <span>{agentLivenessLabel(activeAgent)}</span>
              <span>{handlerCountLabel(events.length)}</span>
            </div>
          )}
        </div>
        <div className="events-list-header-actions">
          <Tooltip content="New handler (N)">
            <Button
              variant="primary"
              size="md"
              onClick={openCompose}
              disabled={!activeAgentId}
              leadingIcon={<Icon icon={Plus} size="sm" />}
            >
              New handler
            </Button>
          </Tooltip>
        </div>
      </header>
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
          onSelect={(id) => {
            if (agentRail) {
              goEntity(trustId, "events", id, { search: { agent: activeAgentId } });
            } else {
              goEntity(trustId, "events", id);
            }
          }}
          onNew={openCompose}
        />
      </div>
    </div>,
  );
}

function EventAgentRail({
  agents,
  activeAgentId,
  eventCounts,
  onSelect,
}: {
  agents: Agent[];
  activeAgentId: string;
  eventCounts: Map<string, number>;
  onSelect: (agentId: string) => void;
}) {
  return (
    <aside className="events-agent-rail" aria-label="Event agent lens">
      <header className="events-agent-rail-head">
        <span className="events-agent-rail-kicker">Agent lens</span>
        <span className="events-agent-rail-count">{agents.length}</span>
      </header>
      <div className="events-agent-rail-list">
        {agents.map((agent) => {
          const active = agent.id === activeAgentId;
          const count = eventCounts.get(agent.id) ?? 0;
          return (
            <button
              key={agent.id}
              type="button"
              className={`events-agent-rail-row${active ? " is-active" : ""}`}
              onClick={() => onSelect(agent.id)}
              aria-current={active ? "true" : undefined}
            >
              <AgentAvatar name={agent.name} src={agent.avatar} />
              <span className="events-agent-rail-row-main">
                <span className="events-agent-rail-row-name">{agent.name}</span>
                <span className="events-agent-rail-row-meta">
                  {agentLivenessLabel(agent)} · {handlerCountLabel(count)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}
