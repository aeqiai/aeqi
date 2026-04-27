import { useState, useEffect } from "react";
import { ThinkingDot } from "@/components/ui";
import { SegmentRenderer } from "./MessageItem";
import {
  type MessageSegment,
  formatDuration,
  formatTime,
  formatStepCount,
  formatContinuingFromStep,
  countStepSegments,
  currentRunningToolName,
} from "./types";

export function ThinkingStatus({ toolName }: { toolName?: string }) {
  return (
    <div className="asv-thinking">
      <ThinkingDot size="sm" />
      <span className="asv-thinking-text">{toolName ? `${toolName}...` : "thinking..."}</span>
    </div>
  );
}

function ElapsedText({ start }: { start: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(interval);
  }, [start]);
  return <>{formatDuration(start, start + elapsed)}</>;
}

/**
 * Live counterpart to the collapsed trail. Renders the same shell as
 * `CollapsedTrail` in MessageItem but expanded by default and with a
 * ticking "Thinking for Xs" label — so tool calls, steps, and mid-turn
 * events stream INTO the box as they arrive instead of appearing flat
 * and only collapsing once the turn is complete.
 */
function LiveTrail({
  trail,
  thinkingStart,
  runningToolName,
  showThinking,
  stepOffset,
}: {
  trail: MessageSegment[];
  thinkingStart: number | null;
  runningToolName?: string;
  showThinking: boolean;
  stepOffset: number;
}) {
  const [expanded, setExpanded] = useState(true);
  const stepCount = countStepSegments(trail);
  const isContinuation = stepOffset > 0;
  return (
    <div className={`asv-trail asv-trail--live${expanded ? " asv-trail--expanded" : ""}`}>
      <button
        type="button"
        className="asv-trail-toggle"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="asv-trail-chevron" aria-hidden="true">
          {"▸"}
        </span>
        <span className="asv-trail-summary">
          <span>
            {isContinuation ? (
              formatContinuingFromStep(stepOffset)
            ) : thinkingStart ? (
              <>
                Thinking for <ElapsedText start={thinkingStart} />
              </>
            ) : (
              "Thinking"
            )}
          </span>
          {stepCount > 0 && <span>{formatStepCount(stepCount)}</span>}
        </span>
      </button>
      {expanded && (
        <div className="asv-trail-detail">
          {trail.length > 0 && <SegmentRenderer segments={trail} live />}
          {showThinking && <ThinkingStatus toolName={runningToolName} />}
        </div>
      )}
    </div>
  );
}

interface StreamingMessageProps {
  agentName: string;
  liveSegments: MessageSegment[];
  thinkingStart: number | null;
  streaming: boolean;
  /** Step offset carried forward from a UserInjected split. When > 0, the
   * LiveTrail label reads "Continuing from step N" instead of the elapsed
   * thinking timer. */
  stepOffset?: number;
}

export default function StreamingMessage({
  agentName: _agentName,
  liveSegments,
  thinkingStart,
  streaming,
  stepOffset = 0,
}: StreamingMessageProps) {
  if (!streaming) return null;

  const runningToolName = currentRunningToolName(liveSegments);
  const liveStepCount = countStepSegments(liveSegments);
  // Always show the "thinking" pulse during the live phase. Whether the
  // model is currently writing text, running a tool, or between steps,
  // the turn isn't done until Complete arrives — so the pulse stays.
  const showLiveThinking = true;

  // Live phase: every segment lives INSIDE the trail. Text the model
  // emits during a step is part of the traceable thinking; we don't yet
  // know if any of it is "the final answer" until the turn closes
  // (`finish_reason: stop` with no further tool calls). Promotion to a
  // visible response happens on commit, in MessageItem.
  return (
    <div className="asv-msg asv-msg-assistant asv-msg-streaming">
      <div className="asv-msg-body">
        <LiveTrail
          trail={liveSegments}
          thinkingStart={thinkingStart}
          runningToolName={runningToolName}
          showThinking={showLiveThinking}
          stepOffset={stepOffset}
        />
        {thinkingStart && (
          <div className="asv-msg-chrome">
            <div className="asv-msg-chrome-meta">
              <span>{formatTime(thinkingStart)}</span>
              {liveStepCount > 0 && <span>{formatStepCount(liveStepCount)}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
