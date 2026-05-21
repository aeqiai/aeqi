import { useMemo } from "react";
import type { AgentEvent, ToolCall } from "@/lib/types";
import { formatDateTime, formatInteger } from "@/lib/i18n";
import { Button } from "./ui";
import {
  type LifecycleGroup,
  LIFECYCLE_HINT,
  LIFECYCLE_LABEL,
  LIFECYCLE_ORDER,
  eventLifecycle,
} from "./events/lifecycle";
import { SCOPE_LABEL } from "./ideas/types";

/**
 * EventsOverview — the no-selection canvas. Every event is a row showing
 * the trigger→tools sparkline; rows are grouped by lifecycle bucket so
 * users see the three mental models the runtime supports:
 *
 *   runtime · the agent's own loop hooks
 *   webhooks · incoming http (incl. channel integrations)
 *   routines · scheduled / cron
 */

interface EventsOverviewProps {
  events: AgentEvent[];
  onSelect: (id: string) => void;
  onNew: () => void;
}

function toolScope(tc: ToolCall): string {
  const name = tc.tool || "?";
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

const WHY_LABEL: Record<LifecycleGroup, string> = {
  runtime: "runtime hook",
  webhooks: "incoming request",
  routines: "scheduled routine",
};

function whenSummary(event: AgentEvent, group: LifecycleGroup): string {
  if (group === "routines") {
    const cron = event.pattern.startsWith("schedule:")
      ? event.pattern.slice("schedule:".length)
      : event.pattern;
    return cron ? `cron ${cron}` : "cron schedule";
  }
  if (group === "webhooks") {
    const payload = event.pattern.includes(":")
      ? event.pattern.slice(event.pattern.indexOf(":") + 1)
      : event.pattern;
    return payload ? payload.replaceAll("_", " ") : "webhook";
  }
  return event.pattern || "(none)";
}

function toolsSummary(count: number): string {
  return count === 0 ? "observer" : `${formatInteger(count)} tool call${count === 1 ? "" : "s"}`;
}

function traceSummary(event: AgentEvent): string {
  if (event.last_fired) return `last ${formatDateTime(event.last_fired)}`;
  return event.fire_count > 0 ? "trace pending" : "no trace";
}

function cooldownSummary(event: AgentEvent): string {
  return event.cooldown_secs > 0 ? `${formatInteger(event.cooldown_secs)}s cooldown` : "none";
}

/**
 * An event's lifecycle phase — the WHEN-primitive equivalent of a quest's
 * status:
 *   armed   → info    (live, watching for the pattern, hasn't fired yet)
 *   fired   → success (has fired at least once — history exists)
 *   dormant → muted   (disabled by the operator; pattern won't match)
 *
 * We deliberately don't model "firing right now" here — the overview row
 * has no live signal. That belongs to the detail/fires panel.
 */
type EventPhase = "armed" | "fired" | "dormant";
type EventTraceTone = "trace-complete" | "trace-pending" | "trace-empty";
type GroupStatusTone = EventPhase | "trace-complete" | "trace-pending";

interface GroupStatusItem {
  label: string;
  value: number;
  tone: GroupStatusTone;
}

function eventPhase(ev: AgentEvent): EventPhase {
  if (!ev.enabled) return "dormant";
  return ev.fire_count > 0 ? "fired" : "armed";
}

function fireStateSummary(phase: EventPhase): string {
  if (phase === "dormant") return "disabled";
  return phase;
}

function traceTone(event: AgentEvent): EventTraceTone {
  if (event.last_fired) return "trace-complete";
  return event.fire_count > 0 ? "trace-pending" : "trace-empty";
}

function groupStatus(events: AgentEvent[]): GroupStatusItem[] {
  const counts = {
    armed: 0,
    fired: 0,
    dormant: 0,
    traceComplete: 0,
    tracePending: 0,
  };

  for (const ev of events) {
    const phase = eventPhase(ev);
    counts[phase] += 1;
    if (ev.last_fired) counts.traceComplete += 1;
    else if (ev.fire_count > 0) counts.tracePending += 1;
  }

  const items: GroupStatusItem[] = [
    { label: "Armed", value: counts.armed, tone: "armed" },
    { label: "Fired", value: counts.fired, tone: "fired" },
    { label: "Dormant", value: counts.dormant, tone: "dormant" },
    { label: "Traced", value: counts.traceComplete, tone: "trace-complete" },
    { label: "Pending", value: counts.tracePending, tone: "trace-pending" },
  ];

  return items.filter((item) => item.value > 0);
}

export default function EventsOverview({ events, onSelect, onNew }: EventsOverviewProps) {
  const grouped = useMemo(() => {
    const map = new Map<LifecycleGroup, AgentEvent[]>();
    for (const ev of events) {
      const g = eventLifecycle(ev);
      const list = map.get(g) ?? [];
      list.push(ev);
      map.set(g, list);
    }
    return LIFECYCLE_ORDER.flatMap((g) => {
      const list = map.get(g);
      return list ? [{ group: g, events: list }] : [];
    });
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="empty-state-hero">
        <span className="empty-state-hero-eyebrow">a blank canvas</span>
        <h3 className="empty-state-hero-title">No pipelines yet.</h3>
        <p className="empty-state-hero-body">
          Events are when-and-then. A pattern fires — a session starts, a webhook lands, a cron
          ticks — and the event runs an ordered chain of tool calls. This is where you replace
          n8n-style automation, scoped to this agent.
        </p>
        <div className="empty-state-hero-actions">
          <Button variant="primary" size="sm" onClick={onNew}>
            Wire the first event
          </Button>
          <span className="empty-state-hero-kbd" aria-hidden>
            or press <kbd>N</kbd>
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="events-overview">
      {grouped.map(({ group, events: list }) => (
        <section key={group} className="events-overview-group">
          <header className="events-overview-group-head">
            <span className={`events-overview-group-dot events-overview-tone-${group}`} />
            <span className="events-overview-group-label">{LIFECYCLE_LABEL[group]}</span>
            <span className="events-overview-group-count">{list.length}</span>
            <span className="events-overview-group-hint">{LIFECYCLE_HINT[group]}</span>
            <span
              className="events-overview-group-status"
              aria-label={`${LIFECYCLE_LABEL[group]} status`}
            >
              {groupStatus(list).map((item) => (
                <span
                  key={`${item.tone}-${item.label}`}
                  className={`events-overview-group-status-item events-overview-group-status-item--${item.tone}`}
                >
                  <span className="events-overview-group-status-value">
                    {formatInteger(item.value)}
                  </span>
                  <span className="events-overview-group-status-label">{item.label}</span>
                </span>
              ))}
            </span>
            <span className="events-overview-group-rule" />
          </header>
          <ul className="events-overview-list" role="list">
            {list.map((ev) => (
              <OverviewRow key={ev.id} event={ev} group={group} onSelect={onSelect} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function OverviewRow({
  event,
  group,
  onSelect,
}: {
  event: AgentEvent;
  group: LifecycleGroup;
  onSelect: (id: string) => void;
}) {
  const tools = event.tool_calls ?? [];
  const isGlobal = event.agent_id == null;
  const phase = eventPhase(event);
  const when = whenSummary(event, group);
  const toolCount = toolsSummary(tools.length);
  const trace = traceSummary(event);
  const state = fireStateSummary(phase);
  const traceState = traceTone(event);
  const cooldown = cooldownSummary(event);
  // Description for screen readers — the pin and the "N fires" / "never"
  // text both carry phase info, but neither is announced naturally.
  const phaseLabel = state;

  return (
    <li
      className={`events-overview-row${!event.enabled ? " is-dimmed" : ""}`}
      data-phase={phase}
      data-group={group}
    >
      <button
        type="button"
        className="events-overview-row-btn"
        data-testid="event-row"
        data-event-id={event.id}
        onClick={() => onSelect(event.id)}
        aria-label={`Open ${event.name} (${phaseLabel}; when ${when}; ${toolCount}; ${trace}; cooldown ${cooldown})`}
      >
        <div className="events-overview-row-head">
          <span
            className={`events-overview-row-pin events-overview-row-pin--${phase}`}
            aria-hidden
          />
          <span className="events-overview-row-name">{event.name}</span>
          {isGlobal && <span className="scope-chip scope-chip--global">{SCOPE_LABEL.global}</span>}
          <span className="events-overview-row-pattern">{event.pattern}</span>
          <span className="events-overview-row-spacer" />
          <span className="events-overview-row-fires">
            {event.fire_count > 0 ? `${formatInteger(event.fire_count)} fires` : "never"}
          </span>
        </div>
        <div className="events-overview-row-flow">
          <span className={`events-overview-chip is-trigger events-overview-tone-${group}`}>
            trigger
          </span>
          {tools.length === 0 ? (
            <>
              <ConnectorTiny />
              <span className="events-overview-chip is-empty">observer</span>
            </>
          ) : (
            tools.map((tc, i) => (
              <span key={i}>
                <ConnectorTiny />
                <span className="events-overview-chip is-tool">
                  <span className="events-overview-chip-step">{formatInteger(i + 1)}</span>
                  <span>{toolScope(tc)}</span>
                </span>
              </span>
            ))
          )}
        </div>
        <div className="events-overview-row-meta" aria-hidden>
          <span className="events-overview-row-meta-item">
            <span className="events-overview-row-meta-label">When</span>
            <span className="events-overview-row-meta-value">{when}</span>
          </span>
          <span className="events-overview-row-meta-item">
            <span className="events-overview-row-meta-label">Why</span>
            <span className="events-overview-row-meta-value">{WHY_LABEL[group]}</span>
          </span>
          <span className="events-overview-row-meta-item">
            <span className="events-overview-row-meta-label">Tools</span>
            <span className="events-overview-row-meta-value">{toolCount}</span>
          </span>
          <span className={`events-overview-row-meta-item events-overview-row-meta-item--${phase}`}>
            <span className="events-overview-row-meta-label">State</span>
            <span className="events-overview-row-meta-value">{state}</span>
          </span>
          <span
            className={`events-overview-row-meta-item events-overview-row-meta-item--${traceState}`}
          >
            <span className="events-overview-row-meta-label">Trace</span>
            <span className="events-overview-row-meta-value">{trace}</span>
          </span>
          <span
            className={`events-overview-row-meta-item${
              event.cooldown_secs > 0 ? " events-overview-row-meta-item--guard" : ""
            }`}
          >
            <span className="events-overview-row-meta-label">Cooldown</span>
            <span className="events-overview-row-meta-value">{cooldown}</span>
          </span>
        </div>
      </button>
    </li>
  );
}

function ConnectorTiny() {
  return (
    <svg
      className="events-overview-arrow"
      width="18"
      height="8"
      viewBox="0 0 18 8"
      fill="none"
      aria-hidden="true"
    >
      <line x1="0" y1="4" x2="13" y2="4" stroke="currentColor" strokeWidth="1" />
      <path
        d="M10 1.5 L14.5 4 L10 6.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
