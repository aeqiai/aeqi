import type { AgentEvent, ToolCall } from "@/lib/types";

/**
 * EventCanvas — visual workflow for a single event.
 *
 * Every AEQI event is a small pipeline:
 *   trigger → (context) → tool calls → fire record
 *
 * The form editor is accurate but dense; the canvas gives users the
 * n8n-style "see the shape" read. Left-to-right flow, transport-colored
 * trigger, pill-shaped nodes, hairline connectors. Read-only — the
 * existing EventEditor handles mutation below it.
 */

interface EventCanvasProps {
  event: AgentEvent;
}

type TransportTone = "session" | "telegram" | "webhook" | "loop" | "context" | "other";

function patternTransport(pattern: string): TransportTone {
  const prefix = pattern.split(":")[0]?.toLowerCase() ?? "";
  if (prefix === "session") return "session";
  if (prefix === "telegram") return "telegram";
  if (prefix === "webhook" || prefix === "http") return "webhook";
  if (prefix === "loop") return "loop";
  if (prefix === "context") return "context";
  return "other";
}

function prettyToolName(name: string): { scope: string; action: string | null } {
  const dot = name.indexOf(".");
  if (dot === -1) return { scope: name, action: null };
  return { scope: name.slice(0, dot), action: name.slice(dot + 1) };
}

function toolArgPreview(tc: ToolCall): string | null {
  const keys = Object.keys(tc.args ?? {});
  if (keys.length === 0) return null;
  const first = keys[0];
  const val = (tc.args as Record<string, unknown>)[first];
  const preview =
    typeof val === "string"
      ? `"${val.length > 28 ? val.slice(0, 28) + "…" : val}"`
      : typeof val === "number" || typeof val === "boolean"
        ? String(val)
        : Array.isArray(val)
          ? `[${val.length}]`
          : "…";
  return `${first} ${preview}`;
}

export default function EventCanvas({ event }: EventCanvasProps) {
  const tone = patternTransport(event.pattern);
  const hasContext = event.idea_ids.length > 0 || !!event.query_template;
  const tools = event.tool_calls ?? [];
  const hasFired = event.fire_count > 0;

  return (
    <div className="event-canvas" role="group" aria-label="Event pipeline">
      <div className="event-canvas-track">
        {/* Trigger */}
        <CanvasNode tone={tone} kind="trigger" label="trigger">
          <div className="event-canvas-node-title">{event.name}</div>
          <div className="event-canvas-node-mono">{event.pattern}</div>
          {event.cooldown_secs > 0 && (
            <div className="event-canvas-node-meta">cooldown {event.cooldown_secs}s</div>
          )}
        </CanvasNode>

        <Connector />

        {/* Context — only if populated; otherwise render a ghost node for shape */}
        {hasContext ? (
          <>
            <CanvasNode tone="context" kind="context" label="context">
              <div className="event-canvas-node-title">
                {event.idea_ids.length > 0
                  ? `${event.idea_ids.length} idea${event.idea_ids.length === 1 ? "" : "s"}`
                  : "query only"}
              </div>
              {event.query_template && (
                <div className="event-canvas-node-mono">{event.query_template}</div>
              )}
              {event.query_top_k != null && (
                <div className="event-canvas-node-meta">top-k {event.query_top_k}</div>
              )}
            </CanvasNode>
            <Connector />
          </>
        ) : null}

        {/* Tool chain */}
        {tools.length === 0 ? (
          <CanvasNode tone="empty" kind="tool" label="tools">
            <div className="event-canvas-node-title event-canvas-node-empty">no tool calls</div>
            <div className="event-canvas-node-meta">fire-and-forget observer</div>
          </CanvasNode>
        ) : (
          tools.map((tc, i) => {
            const { scope, action } = prettyToolName(tc.tool || "(unset)");
            const preview = toolArgPreview(tc);
            return (
              <span key={i} className="event-canvas-chain-step">
                <CanvasNode tone="tool" kind="tool" label={`step ${i + 1}`}>
                  <div className="event-canvas-node-title">
                    <span className="event-canvas-tool-scope">{scope}</span>
                    {action && <span className="event-canvas-tool-action">.{action}</span>}
                  </div>
                  {preview && <div className="event-canvas-node-mono">{preview}</div>}
                </CanvasNode>
                {i < tools.length - 1 && <Connector />}
              </span>
            );
          })
        )}

        <Connector />

        {/* Terminal — fire record */}
        <CanvasNode tone={hasFired ? "fired" : "empty"} kind="terminal" label="fires">
          {hasFired ? (
            <>
              <div className="event-canvas-node-title">{event.fire_count.toLocaleString()}×</div>
              {event.last_fired && (
                <div className="event-canvas-node-meta">
                  last {new Date(event.last_fired).toLocaleString()}
                </div>
              )}
              {event.total_cost_usd > 0 && (
                <div className="event-canvas-node-meta">
                  ${event.total_cost_usd.toFixed(4)} total
                </div>
              )}
            </>
          ) : (
            <div className="event-canvas-node-title event-canvas-node-empty">never fired</div>
          )}
        </CanvasNode>
      </div>
    </div>
  );
}

/* ── Canvas primitives ─────────────────────────────────────────────── */

function CanvasNode({
  tone,
  kind,
  label,
  children,
}: {
  tone: TransportTone | "tool" | "fired" | "empty";
  kind: "trigger" | "context" | "tool" | "terminal";
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`event-canvas-node event-canvas-node--${kind} event-canvas-node--tone-${tone}`}>
      <div className="event-canvas-node-label">{label}</div>
      <div className="event-canvas-node-body">{children}</div>
    </div>
  );
}

/**
 * Hairline arrow connector between nodes. SVG so the arrowhead is crisp
 * at all zoom levels. Height matches the node body (paint inside the
 * track's align-items: center).
 */
function Connector() {
  return (
    <svg
      className="event-canvas-connector"
      width="40"
      height="12"
      viewBox="0 0 40 12"
      fill="none"
      aria-hidden="true"
    >
      <line
        x1="0"
        y1="6"
        x2="34"
        y2="6"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M30 2 L36 6 L30 10"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
