import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Spinner } from "@/components/ui";
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

interface StepDetailProps {
  invocationId: number;
  onClose: () => void;
}

export default function StepDetail({ invocationId, onClose }: StepDetailProps) {
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
    <div className="events-step-detail">
      <div className="events-step-detail-head">
        <button
          type="button"
          className="events-step-detail-back"
          onClick={onClose}
          aria-label="Close step detail"
        >
          ← back
        </button>
        {inv && (
          <span className="events-step-detail-meta">
            {inv.pattern}
            {inv.event_name ? ` · ${inv.event_name}` : ""}
            {" · session "}
            <code>{inv.session_id.slice(0, 8)}</code>
          </span>
        )}
      </div>

      {loading && (
        <div className="events-step-detail-loading">
          <Spinner size="sm" />
          Loading…
        </div>
      )}
      {error && <div className="events-step-detail-error">{error}</div>}

      {!loading && !error && steps.length === 0 && (
        <div className="events-step-detail-empty">No steps recorded.</div>
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
