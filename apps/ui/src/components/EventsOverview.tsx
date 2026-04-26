import { useMemo } from "react";
import type { AgentEvent, ToolCall } from "@/lib/types";
import {
  type LifecycleGroup,
  LIFECYCLE_HINT,
  LIFECYCLE_LABEL,
  LIFECYCLE_ORDER,
  eventLifecycle,
} from "./events/lifecycle";

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
      <div className="events-overview-empty">
        <div className="events-overview-empty-eyebrow">events</div>
        <div className="events-overview-empty-title">No pipelines yet</div>
        <p className="events-overview-empty-body">
          Events are when-and-then. A pattern fires — a session starts, a webhook lands, a cron
          ticks — and the event runs an ordered chain of tool calls. This is where you replace
          n8n-style automation, scoped to this agent.
        </p>
        <button type="button" className="events-overview-empty-cta" onClick={onNew}>
          New event
        </button>
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
            <span className="events-overview-group-hint">{LIFECYCLE_HINT[group]}</span>
            <span className="events-overview-group-rule" />
            <span className="events-overview-group-count">{list.length}</span>
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

  return (
    <li className={`events-overview-row${!event.enabled ? " is-dimmed" : ""}`}>
      <button
        type="button"
        className="events-overview-row-btn"
        onClick={() => onSelect(event.id)}
        aria-label={`Open ${event.name}`}
      >
        <div className="events-overview-row-head">
          <span className={`events-overview-row-pin events-overview-tone-${group}`} aria-hidden />
          <span className="events-overview-row-name">{event.name}</span>
          {isGlobal && <span className="events-overview-row-badge">global</span>}
          <span className="events-overview-row-pattern">{event.pattern}</span>
          <span className="events-overview-row-spacer" />
          <span className="events-overview-row-fires">
            {event.fire_count > 0 ? `${event.fire_count.toLocaleString()} fires` : "never"}
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
                <span className="events-overview-chip is-tool">{toolScope(tc)}</span>
              </span>
            ))
          )}
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
