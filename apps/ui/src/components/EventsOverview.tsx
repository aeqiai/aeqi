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
  routineWhenLabel,
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

function toolParts(tc: ToolCall): { scope: string; action: string | null } {
  const name = tc.tool || "?";
  const dot = name.indexOf(".");
  if (dot === -1) return { scope: name, action: null };
  return { scope: name.slice(0, dot), action: name.slice(dot + 1) };
}

const WHY_LABEL: Record<LifecycleGroup, string> = {
  runtime: "runtime hook",
  webhooks: "incoming request",
  routines: "scheduled routine",
};

const RUNTIME_WHY_LABEL: Record<string, string> = {
  context: "context budget",
  graph_guardrail: "graph guardrail",
  guardrail: "guardrail detector",
  loop: "loop detector",
  session: "session lifecycle",
  shell: "shell result",
};

const WEBHOOK_WHY_LABEL: Record<string, string> = {
  discord: "Discord webhook",
  github: "GitHub webhook",
  http: "HTTP webhook",
  slack: "Slack webhook",
  stripe: "Stripe webhook",
  telegram: "Telegram webhook",
  webhook: "webhook request",
};

function patternPrefix(pattern: string): string {
  return pattern.split(":")[0]?.toLowerCase() ?? "";
}

function whySummary(event: AgentEvent, group: LifecycleGroup): string {
  const prefix = patternPrefix(event.pattern);
  if (group === "runtime") return RUNTIME_WHY_LABEL[prefix] ?? WHY_LABEL.runtime;
  if (group === "webhooks") return WEBHOOK_WHY_LABEL[prefix] ?? WHY_LABEL.webhooks;
  if (prefix === "cron" || prefix === "schedule") return "cron scheduler";
  return WHY_LABEL.routines;
}

function whenSummary(event: AgentEvent, group: LifecycleGroup): string {
  if (group === "routines") {
    return routineWhenLabel(event.pattern);
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
  return `${formatInteger(count)} tool call${count === 1 ? "" : "s"}`;
}

function toolArgsSummary(tc: ToolCall): { label: string; title: string } | null {
  const keys = Object.keys(tc.args ?? {});
  if (keys.length === 0) return null;

  const [first, ...rest] = keys;
  const value = (tc.args as Record<string, unknown>)[first];
  const preview =
    typeof value === "string"
      ? `"${value.length > 18 ? value.slice(0, 18) + "..." : value}"`
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : Array.isArray(value)
          ? `[${formatInteger(value.length)}]`
          : "{...}";
  const label =
    rest.length > 0 ? `${first} ${preview} +${formatInteger(rest.length)}` : `${first} ${preview}`;
  return { label, title: `args: ${keys.join(", ")}` };
}

function traceSummary(event: AgentEvent): string {
  if (event.last_fired) return `last ${formatDateTime(event.last_fired)}`;
  return event.fire_count > 0 ? "trace pending" : "no trace";
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${formatInteger(seconds)}s`;
  if (seconds % 3600 === 0) return `${formatInteger(seconds / 3600)}h`;
  if (seconds % 60 === 0) return `${formatInteger(seconds / 60)}m`;
  return `${formatInteger(seconds)}s`;
}

function gateSummary(event: AgentEvent): string {
  const cooldown =
    event.cooldown_secs > 0 ? `${formatDuration(event.cooldown_secs)} cooldown` : null;
  if (!event.enabled) return cooldown ? `disabled, ${cooldown}` : "disabled";
  return cooldown ?? "ready to fire";
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
type GroupStatusTone =
  | EventPhase
  | "ready"
  | "trace-complete"
  | "trace-pending"
  | "tool-calls"
  | "observers"
  | "guarded";

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
  if (phase === "dormant") return "Disabled";
  if (phase === "fired") return "Fired";
  return "Armed";
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
    ready: 0,
    traceComplete: 0,
    tracePending: 0,
    toolCalls: 0,
    observers: 0,
    guarded: 0,
  };

  for (const ev of events) {
    const phase = eventPhase(ev);
    const toolCallCount = ev.tool_calls?.length ?? 0;
    counts[phase] += 1;
    counts.toolCalls += toolCallCount;
    if (toolCallCount === 0) counts.observers += 1;
    if (!ev.enabled || ev.cooldown_secs > 0) counts.guarded += 1;
    else counts.ready += 1;
    if (ev.last_fired) counts.traceComplete += 1;
    else if (ev.fire_count > 0) counts.tracePending += 1;
  }

  const items: GroupStatusItem[] = [
    { label: "Armed", value: counts.armed, tone: "armed" },
    { label: "Fired", value: counts.fired, tone: "fired" },
    { label: "Dormant", value: counts.dormant, tone: "dormant" },
    { label: "Ready", value: counts.ready, tone: "ready" },
    { label: "Calls", value: counts.toolCalls, tone: "tool-calls" },
    { label: "Observers", value: counts.observers, tone: "observers" },
    { label: "Guarded", value: counts.guarded, tone: "guarded" },
    { label: "Trace Done", value: counts.traceComplete, tone: "trace-complete" },
    { label: "Trace Pending", value: counts.tracePending, tone: "trace-pending" },
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
        <span className="empty-state-hero-eyebrow">agent loop</span>
        <h3 className="empty-state-hero-title">No event handlers yet.</h3>
        <p className="empty-state-hero-body">
          A handler starts with a runtime pattern, passes through gates, and can run an ordered
          chain of tool calls before the agent continues.
        </p>
        <div className="empty-state-hero-actions">
          <Button variant="primary" size="sm" onClick={onNew}>
            Add first handler
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
  const why = whySummary(event, group);
  const when = whenSummary(event, group);
  const toolCount = toolsSummary(tools.length);
  const trace = traceSummary(event);
  const state = fireStateSummary(phase);
  const traceState = traceTone(event);
  const gate = gateSummary(event);
  const isGuarded = !event.enabled || event.cooldown_secs > 0;
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
        aria-label={`Open ${event.name} (${phaseLabel}; why ${why}; when ${when}; ${toolCount}; ${trace}; gate ${gate})`}
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
          <span className="events-overview-row-state">{state}</span>
          <span className="events-overview-row-fires">
            {event.fire_count > 0 ? `${formatInteger(event.fire_count)} fires` : "never"}
          </span>
        </div>
        <div className="events-overview-row-flow">
          <span className="events-overview-chip is-reason">
            <span className="events-overview-chip-step">why</span>
            <span className="events-overview-chip-text">{why}</span>
          </span>
          <ConnectorTiny />
          <span
            className={`events-overview-chip is-trigger events-overview-tone-${group}`}
            title={when}
          >
            <span className="events-overview-chip-step">when</span>
            <span className="events-overview-chip-text">{when}</span>
          </span>
          <ConnectorTiny />
          <span
            className={`events-overview-chip is-gate${isGuarded ? " is-guard" : " is-ready"}`}
            title={gate}
          >
            <span className="events-overview-chip-step">gate</span>
            <span className="events-overview-chip-text">{gate}</span>
          </span>
          <ConnectorTiny />
          <span className={`events-overview-chip is-fire events-overview-fire-${phase}`}>
            <span className="events-overview-chip-step">fire</span>
            <span className="events-overview-chip-text">{state}</span>
          </span>
          {tools.length === 0 ? (
            <>
              <ConnectorTiny />
              <span className="events-overview-chip is-empty">no tool calls</span>
            </>
          ) : (
            tools.map((tc, i) => {
              const { scope, action } = toolParts(tc);
              const args = toolArgsSummary(tc);
              return (
                <span key={i}>
                  <ConnectorTiny />
                  <span
                    className="events-overview-chip is-tool"
                    title={args ? `${tc.tool} - ${args.title}` : tc.tool}
                  >
                    <span className="events-overview-chip-step">call {formatInteger(i + 1)}</span>
                    <span>{scope}</span>
                    {action && <span className="events-overview-chip-action">.{action}</span>}
                    {args && <span className="events-overview-chip-args">{args.label}</span>}
                  </span>
                </span>
              );
            })
          )}
          <ConnectorTiny />
          <span
            className={`events-overview-chip is-trace events-overview-trace-${traceState}`}
            title={trace}
          >
            <span className="events-overview-chip-step">trace</span>
            <span className="events-overview-chip-text">{trace}</span>
          </span>
        </div>
        <div className="events-overview-row-meta" aria-hidden>
          <span className="events-overview-row-meta-item">
            <span className="events-overview-row-meta-label">When</span>
            <span className="events-overview-row-meta-value">{when}</span>
          </span>
          <span className="events-overview-row-meta-item">
            <span className="events-overview-row-meta-label">Why</span>
            <span className="events-overview-row-meta-value">{why}</span>
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
              isGuarded ? " events-overview-row-meta-item--guard" : ""
            }`}
          >
            <span className="events-overview-row-meta-label">Gate</span>
            <span className="events-overview-row-meta-value">{gate}</span>
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
