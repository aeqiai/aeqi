import { useState, useEffect } from "react";
import { SegmentRenderer } from "./MessageItem";
import {
  type MessageSegment,
  formatDuration,
  formatTime,
  formatStepCount,
  countStepSegments,
  currentRunningToolName,
  splitTrailAndFinal,
  trailHasMeaningfulContent,
} from "./types";

export function ThinkingStatus({ toolName }: { toolName?: string }) {
  return (
    <div className="asv-thinking">
      <span className="asv-thinking-dot" />
      <span className="asv-thinking-text">{toolName ? `${toolName}...` : "thinking..."}</span>
    </div>
  );
}

export function ThinkingTimer({ start }: { start: number }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const interval = setInterval(() => setElapsed(Date.now() - start), 100);
    return () => clearInterval(interval);
  }, [start]);
  return <span className="session-msg-duration">{formatDuration(start, start + elapsed)}</span>;
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
}: {
  trail: MessageSegment[];
  thinkingStart: number | null;
  runningToolName?: string;
  showThinking: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const stepCount = countStepSegments(trail);
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
            {thinkingStart ? (
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
}

export default function StreamingMessage({
  agentName: _agentName,
  liveSegments,
  thinkingStart,
  streaming,
}: StreamingMessageProps) {
  if (!streaming) return null;

  const runningToolName = currentRunningToolName(liveSegments);
  const liveStepCount = countStepSegments(liveSegments);
  const liveLastSegment = liveSegments[liveSegments.length - 1];
  const showLiveThinking =
    runningToolName != null ||
    liveSegments.length === 0 ||
    liveLastSegment?.kind === "tool" ||
    liveLastSegment?.kind === "step" ||
    liveLastSegment?.kind === "event_fire";

  const { trail, final } = splitTrailAndFinal(liveSegments);
  const hasTrail = trailHasMeaningfulContent(trail);
  const showTrailBox = hasTrail || showLiveThinking;

  return (
    <div className="asv-msg asv-msg-assistant asv-msg-streaming">
      <div className="asv-msg-body">
        {showTrailBox ? (
          <LiveTrail
            trail={trail}
            thinkingStart={thinkingStart}
            runningToolName={runningToolName}
            showThinking={showLiveThinking}
          />
        ) : null}
        {final.length > 0 && <SegmentRenderer segments={final} live />}
        {thinkingStart && (
          <div className="asv-msg-chrome">
            <div className="asv-msg-chrome-meta">
              <span>{formatTime(thinkingStart)}</span>
              {!showTrailBox && <ThinkingTimer start={thinkingStart} />}
              {liveStepCount > 0 && <span>{formatStepCount(liveStepCount)}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
