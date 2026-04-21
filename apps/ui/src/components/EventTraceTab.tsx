import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { EmptyState, Spinner } from "@/components/ui";
import type { EventInvocationRow, InvocationStepRow } from "@/lib/types";

interface Props {
  sessionId: string;
}

function durationMs(started: string, finished: string | null): string {
  if (!finished) return "…";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusDot(status: string): React.ReactElement {
  const color =
    status === "ok" ? "var(--success)" : status === "error" ? "var(--error)" : "var(--text-muted)";
  return (
    <span
      style={{
        display: "inline-block",
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: color,
        marginRight: 5,
        flexShrink: 0,
      }}
      aria-label={status}
    />
  );
}

interface StepDetailProps {
  invocationId: number;
  onClose: () => void;
}

function StepDetail({ invocationId, onClose }: StepDetailProps) {
  const [inv, setInv] = useState<EventInvocationRow | null>(null);
  const [steps, setSteps] = useState<InvocationStepRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getInvocationDetail(invocationId)
      .then((res) => {
        if (cancelled) return;
        setInv(res.invocation);
        setSteps(res.steps);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invocationId]);

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6,
        background: "var(--bg-surface)",
        marginTop: 8,
        padding: "12px 14px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <button
          type="button"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted)",
            fontSize: 12,
            padding: 0,
          }}
          onClick={onClose}
          aria-label="Close step detail"
        >
          ← back
        </button>
        {inv && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--font-size-xs)" }}>
            {inv.pattern}
            {inv.event_name ? ` · ${inv.event_name}` : ""}
          </span>
        )}
      </div>

      {loading && (
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "var(--font-size-sm)",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Spinner size="sm" />
          Loading…
        </div>
      )}
      {error && (
        <div style={{ color: "var(--error)", fontSize: "var(--font-size-sm)" }}>{error}</div>
      )}

      {!loading && !error && steps.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: "var(--font-size-sm)" }}>
          No steps recorded.
        </div>
      )}

      {steps.map((step) => {
        let argsPreview = step.args_json;
        try {
          argsPreview = JSON.stringify(JSON.parse(step.args_json), null, 2);
        } catch {
          // keep raw
        }
        const argsTrunc = argsPreview.length > 300 ? argsPreview.slice(0, 300) + "…" : argsPreview;
        const summaryTrunc = step.result_summary
          ? step.result_summary.length > 400
            ? step.result_summary.slice(0, 400) + "…"
            : step.result_summary
          : null;

        return (
          <div
            key={step.id}
            style={{
              borderTop: "1px solid var(--border-faint)",
              paddingTop: 8,
              marginTop: 8,
              fontSize: "var(--font-size-xs)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
              }}
            >
              {statusDot(step.status)}
              <code
                style={{
                  fontFamily: "var(--font-mono)",
                  color: "var(--text-primary)",
                }}
              >
                {step.tool_name}
              </code>
              <span style={{ color: "var(--text-muted)", marginLeft: "auto" }}>
                {durationMs(step.started_at, step.finished_at)}
              </span>
            </div>
            {argsTrunc && (
              <pre
                style={{
                  margin: "2px 0 4px",
                  padding: "4px 6px",
                  background: "var(--bg-base)",
                  border: "1px solid var(--border-faint)",
                  borderRadius: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--font-size-2xs)",
                  color: "var(--text-secondary)",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {argsTrunc}
              </pre>
            )}
            {summaryTrunc && (
              <div
                style={{
                  padding: "3px 6px",
                  background: "var(--bg-base)",
                  border: "1px solid var(--border-faint)",
                  borderRadius: 4,
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--font-size-2xs)",
                  color: "var(--text-secondary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {summaryTrunc}
              </div>
            )}
            {step.error && <div style={{ color: "var(--error)", marginTop: 2 }}>{step.error}</div>}
          </div>
        );
      })}
    </div>
  );
}

export default function EventTraceTab({ sessionId }: Props) {
  const [invocations, setInvocations] = useState<EventInvocationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    api
      .listInvocations(sessionId, 50)
      .then((res) => setInvocations(res.invocations))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!sessionId) {
    return (
      <div style={{ padding: "20px 28px" }}>
        <EmptyState
          eyebrow="Trace"
          title="No session selected"
          description="Pick a session from the inbox to see which events it fired, their steps, and where time went."
        />
      </div>
    );
  }

  return (
    <div style={{ padding: "20px 28px", overflowY: "auto", flex: 1 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "var(--font-size-sm)",
            fontWeight: 600,
            color: "var(--text-primary)",
          }}
        >
          Event Invocation Trace
        </h3>
        <button
          type="button"
          style={{
            marginLeft: "auto",
            background: "none",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "2px 8px",
            fontSize: "var(--font-size-xs)",
            cursor: "pointer",
            color: "var(--text-secondary)",
          }}
          onClick={load}
        >
          Refresh
        </button>
      </div>

      {loading && (
        <div
          style={{
            color: "var(--text-muted)",
            fontSize: "var(--font-size-sm)",
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Spinner size="sm" />
          Loading…
        </div>
      )}
      {error && (
        <div style={{ color: "var(--error)", fontSize: "var(--font-size-sm)" }}>{error}</div>
      )}

      {!loading && !error && invocations.length === 0 && (
        <EmptyState
          eyebrow="Trace"
          title="No event invocations yet"
          description="Once this session fires middleware or lifecycle events, each invocation will show up here with timings and steps."
        />
      )}

      {selectedId != null && (
        <StepDetail invocationId={selectedId} onClose={() => setSelectedId(null)} />
      )}

      {selectedId == null && invocations.length > 0 && (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: "var(--font-size-xs)",
          }}
        >
          <thead>
            <tr
              style={{
                borderBottom: "1px solid var(--border)",
                color: "var(--text-muted)",
                fontWeight: 600,
                textAlign: "left",
              }}
            >
              <th style={{ padding: "4px 8px 6px 0", width: 120 }}>Time</th>
              <th style={{ padding: "4px 8px 6px 0" }}>Pattern</th>
              <th style={{ padding: "4px 8px 6px 0" }}>Event</th>
              <th style={{ padding: "4px 8px 6px 0", width: 60 }}>Status</th>
              <th style={{ padding: "4px 8px 6px 0", width: 70 }}>Duration</th>
            </tr>
          </thead>
          <tbody>
            {invocations.map((inv) => (
              <tr
                key={inv.id}
                onClick={() => setSelectedId(inv.id)}
                style={{ cursor: "pointer", borderBottom: "1px solid var(--border-faint)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "var(--state-hover)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLTableRowElement).style.background = "";
                }}
              >
                <td
                  style={{
                    padding: "5px 8px 5px 0",
                    fontFamily: "var(--font-mono)",
                    fontSize: "var(--font-size-2xs)",
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {new Date(inv.started_at).toLocaleTimeString()}
                </td>
                <td
                  style={{
                    padding: "5px 8px 5px 0",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-primary)",
                    maxWidth: 180,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {inv.pattern}
                </td>
                <td
                  style={{
                    padding: "5px 8px 5px 0",
                    color: "var(--text-secondary)",
                    maxWidth: 140,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {inv.event_name ?? "—"}
                </td>
                <td style={{ padding: "5px 8px 5px 0" }}>
                  <span style={{ display: "inline-flex", alignItems: "center" }}>
                    {statusDot(inv.status)}
                    {inv.status}
                  </span>
                </td>
                <td
                  style={{
                    padding: "5px 0",
                    fontFamily: "var(--font-mono)",
                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {durationMs(inv.started_at, inv.finished_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
