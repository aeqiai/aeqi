import { useMemo } from "react";
import type { AgentEvent, ToolCall } from "@/lib/types";

/**
 * EventsOverview — the empty-state canvas showing every event for an
 * agent as a row in a workflow atlas, grouped by pattern transport
 * (session, telegram, webhook, loop, …). Each row is a compact
 * trigger→tools sparkline; clicking opens that event's full canvas.
 *
 * This is the "map of what happens when X fires" read — the closest
 * thing to an n8n canvas when no single event is selected.
 */

interface EventsOverviewProps {
  events: AgentEvent[];
  onSelect: (id: string) => void;
  onNew: () => void;
}

type TransportTone = "session" | "telegram" | "webhook" | "loop" | "context" | "other";

const TONE_ORDER: TransportTone[] = ["session", "context", "loop", "webhook", "telegram", "other"];

const TONE_LABEL: Record<TransportTone, string> = {
  session: "session · lifecycle",
  context: "context · budget",
  loop: "loop · guardrail",
  webhook: "webhook · external http",
  telegram: "telegram · chat",
  other: "custom",
};

function patternTransport(pattern: string): TransportTone {
  const prefix = pattern.split(":")[0]?.toLowerCase() ?? "";
  if (prefix === "session") return "session";
  if (prefix === "telegram") return "telegram";
  if (prefix === "webhook" || prefix === "http") return "webhook";
  if (prefix === "loop") return "loop";
  if (prefix === "context") return "context";
  return "other";
}

function toolScope(tc: ToolCall): string {
  const name = tc.tool || "?";
  const dot = name.indexOf(".");
  return dot === -1 ? name : name.slice(0, dot);
}

export default function EventsOverview({ events, onSelect, onNew }: EventsOverviewProps) {
  const grouped = useMemo(() => {
    const map = new Map<TransportTone, AgentEvent[]>();
    for (const ev of events) {
      const tone = patternTransport(ev.pattern);
      const list = map.get(tone) ?? [];
      list.push(ev);
      map.set(tone, list);
    }
    return TONE_ORDER.flatMap((tone) => {
      const list = map.get(tone);
      return list ? [{ tone, events: list }] : [];
    });
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="events-overview-empty">
        <div className="events-overview-empty-eyebrow">events</div>
        <div className="events-overview-empty-title">No pipelines yet</div>
        <p className="events-overview-empty-body">
          Events are the when-and-then. A pattern fires — a session start, a telegram message, a
          webhook hit — and the event runs an ordered chain of tool calls. Think n8n, scoped to this
          agent.
        </p>
        <button type="button" className="events-overview-empty-cta" onClick={onNew}>
          New event
        </button>
      </div>
    );
  }

  return (
    <div className="events-overview">
      {grouped.map(({ tone, events: list }) => (
        <section key={tone} className="events-overview-group">
          <header className="events-overview-group-head">
            <span className={`events-overview-group-dot events-overview-tone-${tone}`} />
            <span className="events-overview-group-label">{TONE_LABEL[tone]}</span>
            <span className="events-overview-group-rule" />
            <span className="events-overview-group-count">{list.length}</span>
          </header>
          <ul className="events-overview-list" role="list">
            {list.map((ev) => (
              <OverviewRow key={ev.id} event={ev} tone={tone} onSelect={onSelect} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function OverviewRow({
  event,
  tone,
  onSelect,
}: {
  event: AgentEvent;
  tone: TransportTone;
  onSelect: (id: string) => void;
}) {
  const tools = event.tool_calls ?? [];
  const hasContext = event.idea_ids.length > 0 || !!event.query_template;
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
          <span className={`events-overview-row-pin events-overview-tone-${tone}`} aria-hidden />
          <span className="events-overview-row-name">{event.name}</span>
          {isGlobal && <span className="events-overview-row-badge">global</span>}
          <span className="events-overview-row-pattern">{event.pattern}</span>
          <span className="events-overview-row-spacer" />
          <span className="events-overview-row-fires">
            {event.fire_count > 0 ? `${event.fire_count.toLocaleString()} fires` : "never"}
          </span>
        </div>
        <div className="events-overview-row-flow">
          <span className={`events-overview-chip is-trigger events-overview-tone-${tone}`}>
            trigger
          </span>
          {hasContext && (
            <>
              <ConnectorTiny />
              <span className="events-overview-chip is-context">
                {event.idea_ids.length > 0
                  ? `${event.idea_ids.length} idea${event.idea_ids.length === 1 ? "" : "s"}`
                  : "query"}
              </span>
            </>
          )}
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
