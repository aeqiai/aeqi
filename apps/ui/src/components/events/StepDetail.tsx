import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Loading, Tooltip } from "@/components/ui";
import type { EventInvocationRow, InvocationStepRow } from "@/lib/types";

export function durationMs(started: string, finished: string | null): string {
  if (!finished) return "…";
  const ms = new Date(finished).getTime() - new Date(started).getTime();
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function StatusDot({ status }: { status: string }) {
  const cls =
    status === "ok"
      ? "events-fires-dot events-fires-dot--ok"
      : status === "error"
        ? "events-fires-dot events-fires-dot--err"
        : "events-fires-dot events-fires-dot--idle";
  return <span className={cls} aria-label={status} />;
}

function countLabel(count: number | null): string {
  if (count == null) return "unknown";
  return `${count} call${count === 1 ? "" : "s"}`;
}

function stepCountLabel(count: number): string {
  return `${count} step${count === 1 ? "" : "s"}`;
}

function toolCallNames(toolCallsJson: string): string[] | null {
  try {
    const parsed = JSON.parse(toolCallsJson) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.map((call, i) => {
      if (
        call != null &&
        typeof call === "object" &&
        "tool" in call &&
        typeof call.tool === "string" &&
        call.tool.trim()
      ) {
        return call.tool.trim();
      }
      return `step ${i + 1}`;
    });
  } catch {
    return null;
  }
}

function planLabel(names: string[] | null): string {
  if (names == null) return "unknown";
  if (names.length === 0) return "observer";
  if (names.length <= 2) return names.join(" -> ");
  return `${names.slice(0, 2).join(" -> ")} +${names.length - 2}`;
}

interface StepDetailProps {
  invocationId: number;
  onClose: () => void;
}

export default function StepDetail({ invocationId, onClose }: StepDetailProps) {
  const [inv, setInv] = useState<EventInvocationRow | null>(null);
  const [steps, setSteps] = useState<InvocationStepRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const plannedToolNames = inv ? toolCallNames(inv.tool_calls_json) : null;

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
    <div className="events-step-detail">
      <div className="events-step-detail-head">
        <span className="events-step-detail-title">
          step
          <span className="events-step-detail-count">{steps.length}</span>
        </span>
        <Tooltip content="Back to fires">
          <button
            type="button"
            className="events-step-detail-back"
            onClick={onClose}
            aria-label="Close step detail"
          >
            ←
          </button>
        </Tooltip>
      </div>
      {inv && (
        <div className="events-step-detail-sub">
          <span className="events-step-detail-pattern">{inv.pattern}</span>
          {inv.event_name && <span className="events-step-detail-event">{inv.event_name}</span>}
          <span className="events-step-detail-session">
            session <code>{inv.session_id.slice(0, 8)}</code>
          </span>
        </div>
      )}

      {inv && (
        <div className="events-step-summary" aria-label="Trace summary">
          <TraceMetric label="Status" value={inv.status} tone={inv.status} />
          <TraceMetric label="Caller" value={inv.caller_kind} />
          <TraceMetric label="Duration" value={durationMs(inv.started_at, inv.finished_at)} />
          <TraceMetric label="Tool Calls" value={countLabel(plannedToolNames?.length ?? null)} />
          <TraceMetric label="Trace Steps" value={stepCountLabel(steps.length)} />
          <TraceMetric label="Plan" value={planLabel(plannedToolNames)} />
        </div>
      )}

      {loading && (
        <div className="events-step-detail-loading">
          <Loading size="sm" />
          Loading…
        </div>
      )}
      {error && <div className="events-step-detail-error">{error}</div>}

      {!loading && !error && steps.length === 0 && (
        <div className="events-step-detail-empty event-empty-block event-empty-block--compact">
          <span className="event-empty-eyebrow">No steps</span>
          <span className="event-empty-title">This fire didn't run any tools</span>
          <span className="event-empty-hint">
            The trigger matched but the pipeline was empty — wire a step on the canvas.
          </span>
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
          <div key={step.id} className="events-step-row">
            <div className="events-step-row-head">
              <StatusDot status={step.status} />
              <code className="events-step-row-tool">{step.tool_name}</code>
              <span className="events-step-row-dur">
                {durationMs(step.started_at, step.finished_at)}
              </span>
            </div>
            {argsTrunc && <pre className="events-step-row-pre">{argsTrunc}</pre>}
            {summaryTrunc && <div className="events-step-row-pre">{summaryTrunc}</div>}
            {step.error && <div className="events-step-row-error">{step.error}</div>}
          </div>
        );
      })}
    </div>
  );
}

function TraceMetric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const classes = [
    "events-step-summary-item",
    tone === "ok" ? "events-step-summary-item--ok" : null,
    tone === "error" ? "events-step-summary-item--error" : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes}>
      <span className="events-step-summary-label">{label}</span>
      <span className="events-step-summary-value">{value}</span>
    </span>
  );
}
