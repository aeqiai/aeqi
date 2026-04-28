import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Spinner, Tooltip } from "@/components/ui";
import type { EventInvocationRow } from "@/lib/types";
import StepDetail, { StatusDot, durationMs } from "./StepDetail";

interface FiresPanelProps {
  eventName: string;
  pattern: string;
  /** Hint count from the agent event row — used while the network call is
   *  in flight so the empty state doesn't flicker. */
  fireCountHint: number;
}

function relativeWhen(ts: string): string {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return ts;
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return new Date(t).toLocaleDateString();
}

export default function FiresPanel({ eventName, pattern, fireCountHint }: FiresPanelProps) {
  const [rows, setRows] = useState<EventInvocationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

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

      {loading && (
        <div className="events-fires-loading">
          <Spinner size="sm" />
          loading…
        </div>
      )}

      {error && <div className="events-fires-error">{error}</div>}

      {!loading && !error && rows.length === 0 && (
        <div className="events-fires-empty">
          {fireCountHint > 0
            ? "No traces recorded for recent fires yet."
            : "Never fired. Use Test trigger to dry-run this pipeline."}
        </div>
      )}

      {rows.length > 0 && (
        <ul className="events-fires-list" role="list">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="events-fires-row"
                onClick={() => setSelected(r.id)}
                aria-label={`Open invocation ${r.id}`}
              >
                <StatusDot status={r.status} />
                <span className="events-fires-row-when">{relativeWhen(r.started_at)}</span>
                <span className="events-fires-row-session">
                  session <code>{r.session_id.slice(0, 8)}</code>
                </span>
                <span className="events-fires-row-dur">
                  {durationMs(r.started_at, r.finished_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
