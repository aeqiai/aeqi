import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Loading, Tooltip } from "@/components/ui";
import { formatInteger, formatShortDate } from "@/lib/i18n";
import type { EventInvocationRow, ToolCall } from "@/lib/types";
import StepDetail, { StatusDot, durationMs } from "./StepDetail";
import {
  LIFECYCLE_HINT,
  LIFECYCLE_LABEL,
  lifecycleGroup,
  routineWhenLabel,
  type LifecycleGroup,
} from "./lifecycle";

interface FiresPanelProps {
  eventName: string;
  pattern: string;
  /** Hint count from the agent event row — used while the network call is
   *  in flight so the empty state doesn't flicker. */
  fireCountHint: number;
  lastFired: string | null;
  cooldownSecs: number;
  toolCalls: ToolCall[];
}

function relativeWhen(ts: string): string {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return ts;
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return formatShortDate(t, { fallback: ts });
}

function runWhen(pattern: string, lifecycle: LifecycleGroup): string {
  if (lifecycle === "routines") {
    return routineWhenLabel(pattern);
  }
  if (lifecycle === "webhooks") {
    const payload = pattern.includes(":") ? pattern.slice(pattern.indexOf(":") + 1) : pattern;
    return payload ? payload.replaceAll("_", " ") : "incoming request";
  }
  return pattern || "(none)";
}

function latestFireState(
  rows: EventInvocationRow[],
  fireCountHint: number,
  lastFired: string | null,
): { value: string; tone: LifecycleGroup | "ready" | "pending" | "empty" } {
  const latest = rows[0];
  if (latest) {
    const when = relativeWhen(latest.started_at);
    if (!latest.finished_at) return { value: `running · ${when}`, tone: "runtime" };
    if (latest.status === "error") return { value: `failed · ${when}`, tone: "pending" };
    if (latest.status === "ok") return { value: `ok · ${when}`, tone: "ready" };
    return { value: `${latest.status} · ${when}`, tone: "runtime" };
  }
  if (lastFired) {
    return { value: `traces pending · ${relativeWhen(lastFired)}`, tone: "pending" };
  }
  return {
    value: fireCountHint > 0 ? "traces pending" : "not fired",
    tone: fireCountHint > 0 ? "pending" : "empty",
  };
}

function toolCallCount(toolCallsJson: string): number | null {
  try {
    const parsed = JSON.parse(toolCallsJson) as unknown;
    return Array.isArray(parsed) ? parsed.length : null;
  } catch {
    return null;
  }
}

function toolCallPlanLabel(toolCalls: ToolCall[]): string {
  if (toolCalls.length === 0) return "observer only";
  const names = toolCalls.map((call, i) => call.tool?.trim() || `step ${i + 1}`);
  if (names.length <= 2) return names.join(" -> ");
  return `${names.slice(0, 2).join(" -> ")} +${names.length - 2}`;
}

function cooldownLabel(cooldownSecs: number): string {
  if (cooldownSecs <= 0) return "none";
  if (cooldownSecs < 60) return `${formatInteger(cooldownSecs)}s`;
  const minutes = cooldownSecs / 60;
  if (Number.isInteger(minutes) && minutes < 60) return `${formatInteger(minutes)}m`;
  const hours = cooldownSecs / 3600;
  if (Number.isInteger(hours)) return `${formatInteger(hours)}h`;
  return `${formatInteger(cooldownSecs)}s`;
}

function cooldownGate(
  lastFired: string | null,
  cooldownSecs: number,
): { value: string; tone: "ready" | "pending" | "empty" } {
  if (cooldownSecs <= 0) return { value: "open", tone: "ready" };
  if (!lastFired) return { value: "open until first fire", tone: "empty" };
  const last = Date.parse(lastFired);
  if (!Number.isFinite(last)) return { value: "cooldown unknown", tone: "pending" };
  const opensAt = last + cooldownSecs * 1000;
  const remainingMs = opensAt - Date.now();
  if (remainingMs <= 0) return { value: "open", tone: "ready" };
  if (remainingMs < 60_000) return { value: "opens in <1m", tone: "pending" };
  if (remainingMs < 3_600_000) {
    return { value: `opens in ${Math.ceil(remainingMs / 60_000)}m`, tone: "pending" };
  }
  return { value: `opens in ${Math.ceil(remainingMs / 3_600_000)}h`, tone: "pending" };
}

function displayKind(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export default function FiresPanel({
  eventName,
  pattern,
  fireCountHint,
  lastFired,
  cooldownSecs,
  toolCalls,
}: FiresPanelProps) {
  const [rows, setRows] = useState<EventInvocationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const lifecycle = lifecycleGroup(pattern);
  const fireState = latestFireState(rows, fireCountHint, lastFired);
  const gate = cooldownGate(lastFired, cooldownSecs);

  const load = useCallback(() => {
    if (!eventName || !pattern) return;
    setLoading(true);
    setError(null);
    api
      .listInvocationsForEvent(eventName, pattern, 50)
      .then((res) => setRows(res.invocations))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [eventName, pattern]);

  useEffect(() => {
    load();
  }, [load]);

  if (selected != null) {
    return <StepDetail invocationId={selected} onClose={() => setSelected(null)} />;
  }

  return (
    <div className="events-fires">
      <div className="events-fires-head">
        <span className="events-fires-title">
          fires
          <span className="events-fires-count">{rows.length || fireCountHint || 0}</span>
        </span>
        <Tooltip content="Refresh">
          <button type="button" className="events-fires-refresh" onClick={load}>
            ↻
          </button>
        </Tooltip>
      </div>

      <div className="events-fires-context" aria-label="Run context">
        <ContextItem label="Lifecycle" value={LIFECYCLE_LABEL[lifecycle]} tone={lifecycle} />
        <ContextItem label="When" value={runWhen(pattern, lifecycle)} wide />
        <ContextItem label="Why" value={LIFECYCLE_HINT[lifecycle]} wide />
        <ContextItem
          label="Tool Calls"
          value={toolCallPlanLabel(toolCalls)}
          tone={toolCalls.length > 0 ? "runtime" : "empty"}
          wide
        />
        <ContextItem label="Cooldown" value={cooldownLabel(cooldownSecs)} />
        <ContextItem label="Gate" value={gate.value} tone={gate.tone} />
        <ContextItem label="Fire State" value={fireState.value} tone={fireState.tone} />
      </div>

      {loading && (
        <div className="events-fires-loading">
          <Loading size="sm" />
          loading…
        </div>
      )}

      {error && <div className="events-fires-error">{error}</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="events-fires-empty event-empty-block">
          <span className="event-empty-eyebrow">
            {fireCountHint > 0 ? "Traces pending" : "Standing by"}
          </span>
          <span className="event-empty-title">
            {fireCountHint > 0
              ? "Recent fires haven't logged traces yet"
              : "This trigger hasn't fired"}
          </span>
          <span className="event-empty-hint">
            {fireCountHint > 0
              ? "Hit refresh in a moment, or open a fire above once it appears."
              : "Use Test in the toolbar to dry-run the pipeline and seed the log."}
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <ul className="events-fires-list" role="list">
          {rows.map((r) => {
            const callCount = toolCallCount(r.tool_calls_json);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  className="events-fires-row"
                  onClick={() => setSelected(r.id)}
                  aria-label={`Open invocation ${r.id}: ${r.status}, ${displayKind(r.caller_kind)}, ${relativeWhen(r.started_at)}`}
                >
                  <StatusDot status={r.status} />
                  <span className="events-fires-row-status">{displayKind(r.status)}</span>
                  <span className="events-fires-row-when">{relativeWhen(r.started_at)}</span>
                  <span className="events-fires-row-caller">{displayKind(r.caller_kind)}</span>
                  <span className="events-fires-row-session">
                    <span className="events-fires-row-session-label">session</span>
                    <code>{r.session_id.slice(0, 8)}</code>
                  </span>
                  {callCount != null && (
                    <span className="events-fires-row-calls">
                      {formatInteger(callCount)} call{callCount === 1 ? "" : "s"}
                    </span>
                  )}
                  <span className="events-fires-row-dur">
                    {durationMs(r.started_at, r.finished_at)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ContextItem({
  label,
  value,
  tone,
  wide = false,
}: {
  label: string;
  value: string;
  tone?: LifecycleGroup | "ready" | "pending" | "empty";
  wide?: boolean;
}) {
  const classes = [
    "events-fires-context-item",
    wide ? "events-fires-context-item--wide" : null,
    tone ? `events-fires-context-item--${tone}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      <span className="events-fires-context-label">{label}</span>
      <span className="events-fires-context-value">{value}</span>
    </span>
  );
}
