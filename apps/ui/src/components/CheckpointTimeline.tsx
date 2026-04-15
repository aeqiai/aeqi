import type { Checkpoint } from "@/lib/types";

interface CheckpointTimelineProps {
  checkpoints: Checkpoint[];
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CheckpointTimeline({ checkpoints }: CheckpointTimelineProps) {
  if (checkpoints.length === 0) return null;

  return (
    <div className="checkpoint-timeline">
      {checkpoints.map((cp, i) => (
        <div key={i} className="checkpoint-entry">
          <div className="checkpoint-track">
            <span className="checkpoint-dot" />
            {i < checkpoints.length - 1 && <span className="checkpoint-line" />}
          </div>
          <div className="checkpoint-content">
            <div className="checkpoint-header">
              <span className="checkpoint-worker">{cp.agent_name}</span>
            </div>
            {cp.progress && <p className="checkpoint-summary">{cp.progress}</p>}
            <div className="checkpoint-meta">
              {cp.cost_usd != null && (
                <span className="checkpoint-cost">${cp.cost_usd.toFixed(2)}</span>
              )}
              {cp.steps_used != null && (
                <span className="checkpoint-steps">{cp.steps_used} steps</span>
              )}
              <span className="checkpoint-time">{formatTimestamp(cp.timestamp)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
