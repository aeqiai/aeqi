import { useState, useEffect } from "react";
import RoundAvatar from "../RoundAvatar";
import { SegmentRenderer } from "./MessageItem";
import {
  type MessageSegment,
  formatDuration,
  formatTime,
  formatStepCount,
  countStepSegments,
  currentRunningToolName,
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

interface StreamingMessageProps {
  agentName: string;
  liveSegments: MessageSegment[];
  thinkingStart: number | null;
  streaming: boolean;
}

export default function StreamingMessage({
  agentName,
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
    liveLastSegment?.kind === "step";

  return (
    <div className="asv-msg asv-msg-assistant asv-msg-streaming">
      <div className="asv-msg-avatar">
        <RoundAvatar name={agentName} size={24} />
      </div>
      <div className="asv-msg-body">
        <SegmentRenderer segments={liveSegments} live />
        {showLiveThinking && <ThinkingStatus toolName={runningToolName} />}
        {thinkingStart && (
          <div className="asv-msg-footer">
            <span>{formatTime(thinkingStart)}</span>
            <ThinkingTimer start={thinkingStart} />
            {liveStepCount > 0 && <span>{formatStepCount(liveStepCount)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
