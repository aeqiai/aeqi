import { useState, memo } from "react";
import Markdown from "react-markdown";
import RoundAvatar from "../RoundAvatar";
import {
  type Message,
  type MessageSegment,
  type ToolEvent,
  formatMs,
  formatTime,
  formatStepCount,
  countStepSegments,
  toolLabel,
  shouldRenderStatus,
} from "./types";

// ── Sub-components ──

function ExpandableOutput({ text, limit = 100 }: { text: string; limit?: number }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = text.length > limit;
  return (
    <div className="session-tool-output">
      {expanded || !needsExpand ? text : text.slice(0, limit) + "..."}
      {needsExpand && (
        <span
          className="session-tool-expand"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          {expanded ? "less" : "more"}
        </span>
      )}
    </div>
  );
}

/** A single collapsible tool block with its own expand state. */
function ToolBlock({ items, live = false }: { items: MessageSegment[]; live?: boolean }) {
  const [expanded, setExpanded] = useState(live);
  const tools = items.filter((s): s is { kind: "tool"; event: ToolEvent } => s.kind === "tool");
  const count = tools.length;
  const cats = [
    ...new Set(
      tools.map((t) => {
        const n = t.event.name;
        if (n.startsWith("agents_")) return "agents";
        if (n.startsWith("quests_")) return "quests";
        if (n.startsWith("events_")) return "events";
        if (n.startsWith("ideas_")) return "ideas";
        if (n.startsWith("prompts_")) return "prompts";
        if (n.startsWith("web_")) return "web";
        return "system";
      }),
    ),
  ];
  const hasFail = tools.some((t) => t.event.success === false);
  const showDetail = live || expanded;

  return (
    <div
      className={`asv-tools-group${live ? " asv-tools-group--live" : ""}${hasFail ? " asv-tools-group--fail" : ""}`}
    >
      {!live && (
        <button className="asv-tools-toggle" onClick={() => setExpanded(!expanded)}>
          <span className="asv-tools-chevron">{expanded ? "\u25BE" : "\u25B8"}</span>
          <span className="asv-tools-count">
            {count} tool{count !== 1 ? "s" : ""}
          </span>
          {!expanded && cats.length > 0 && (
            <span className="asv-tools-cats">{cats.join(", ")}</span>
          )}
        </button>
      )}
      {showDetail && (
        <div className="asv-tools-detail">
          {items.map((seg, si) =>
            seg.kind === "tool" ? (
              <div key={si} className={`asv-tool-row${seg.event.success === false ? " fail" : ""}`}>
                <span className={`asv-tool-dot ${seg.event.type}`} />
                <span className="asv-tool-name">{toolLabel(seg.event.name)}</span>
                {seg.event.duration_ms != null && (
                  <span className="asv-tool-dur">{formatMs(seg.event.duration_ms)}</span>
                )}
                {!live && seg.event.output_preview && (
                  <ExpandableOutput text={seg.event.output_preview} />
                )}
              </div>
            ) : seg.kind === "status" ? (
              <div key={si} className="asv-tool-status-msg">
                {seg.text}
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

/** Code block with language label + copy button */
function CodeBlock({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = className?.replace("language-", "") || "";
  const code = String(children).replace(/\n$/, "");
  return (
    <div className="asv-codeblock">
      <div className="asv-codeblock-header">
        <span className="asv-codeblock-lang">{lang}</span>
        <button
          className="asv-codeblock-copy"
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

/** Custom markdown components — code blocks get headers */
const markdownComponents: any = {
  code({ className, children, ...props }: { className?: string; children?: React.ReactNode }) {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return <CodeBlock className={className}>{children}</CodeBlock>;
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  pre({ children }: { children?: React.ReactNode }) {
    return <>{children}</>;
  },
};

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button className="asv-copy" onClick={handleCopy} title={copied ? "Copied" : "Copy"}>
      {copied ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M3 8.5l3 3 7-7" />
        </svg>
      ) : (
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="5" y="5" width="9" height="9" rx="2" />
          <path d="M5 11H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

/** Renders segments, grouping consecutive tool items into blocks. */
export function SegmentRenderer({
  segments,
  live = false,
}: {
  segments: MessageSegment[];
  live?: boolean;
}) {
  type SegGroup =
    | { kind: "text"; text: string }
    | { kind: "step"; step: number }
    | { kind: "status"; text: string }
    | { kind: "tools"; items: MessageSegment[] };
  const groups: SegGroup[] = [];
  for (const seg of segments) {
    if (seg.kind === "text") {
      groups.push({ kind: "text", text: seg.text });
    } else if (seg.kind === "step") {
      groups.push({ kind: "step", step: seg.step });
    } else if (seg.kind === "status") {
      const stepMatch = seg.text.trim().match(/^step\s+(\d+)$/i);
      if (stepMatch) {
        groups.push({ kind: "step", step: Number(stepMatch[1]) });
      } else if (shouldRenderStatus(seg.text)) {
        groups.push({ kind: "status", text: seg.text });
      }
    } else {
      const last = groups[groups.length - 1];
      if (last && last.kind === "tools") {
        last.items.push(seg);
      } else {
        groups.push({ kind: "tools", items: [seg] });
      }
    }
  }

  return (
    <>
      {groups.map((group, gi) =>
        group.kind === "text" ? (
          <div key={gi} className="asv-msg-content">
            <Markdown components={markdownComponents}>{group.text}</Markdown>
          </div>
        ) : group.kind === "step" ? (
          <div key={gi} className="asv-step-sep">
            <span>{`Step ${group.step}`}</span>
          </div>
        ) : group.kind === "status" ? (
          <div key={gi} className="asv-status-line">
            {group.text}
          </div>
        ) : (
          <ToolBlock key={gi} items={group.items} live={live} />
        ),
      )}
    </>
  );
}

// ── Memoized message item — prevents re-rendering historical messages during streaming ──

const MessageItem = memo(function MessageItem({
  msg,
  agentName,
  userName: _userName,
  userAvatarUrl: _userAvatarUrl,
  onFork,
}: {
  msg: Message;
  agentName: string;
  userName: string;
  userAvatarUrl: string | null;
  onFork?: (messageId: number) => void;
}) {
  if (msg.role === "quest_event") {
    return (
      <div className="asv-quest-event">
        <span className="asv-quest-event-icon">
          {(msg.eventType || "").includes("create")
            ? "+"
            : (msg.eventType || "").includes("complete") || (msg.eventType || "").includes("close")
              ? "\u2713"
              : (msg.eventType || "").includes("block")
                ? "!"
                : "\u2192"}
        </span>
        <span className="asv-quest-event-text">{msg.content}</span>
        {msg.timestamp && <span className="asv-quest-event-time">{formatTime(msg.timestamp)}</span>}
      </div>
    );
  }
  if (msg.role === "error") {
    return (
      <div className="asv-msg asv-msg-error">
        <div className="asv-msg-header">
          {msg.duration && <span className="asv-msg-duration">{msg.duration}</span>}
        </div>
        <div className="asv-msg-content">{msg.content}</div>
      </div>
    );
  }
  const stepCount = msg.stepCount || countStepSegments(msg.segments);
  const metaParts = [
    msg.timestamp && formatTime(msg.timestamp),
    msg.duration,
    msg.role === "assistant" && stepCount > 0 && formatStepCount(stepCount),
    msg.costUsd != null && msg.costUsd > 0 && `$${msg.costUsd.toFixed(4)}`,
    msg.tokenUsage &&
      (msg.tokenUsage.prompt > 0 || msg.tokenUsage.completion > 0) &&
      `${msg.tokenUsage.prompt}\u2192${msg.tokenUsage.completion} tok`,
    msg.queued && "queued",
  ].filter(Boolean) as string[];
  return (
    <div className={`asv-msg asv-msg-${msg.role}${msg.queued ? " asv-msg-queued" : ""}`}>
      {msg.role === "assistant" && (
        <div className="asv-msg-avatar">
          <RoundAvatar name={agentName} size={24} />
        </div>
      )}
      <div className="asv-msg-body">
        {msg.segments && msg.segments.length > 0 ? (
          <SegmentRenderer segments={msg.segments} />
        ) : (
          <div className="asv-msg-content">
            {msg.role === "assistant" ? (
              <Markdown components={markdownComponents}>{msg.content}</Markdown>
            ) : (
              <span>{msg.content}</span>
            )}
          </div>
        )}
        {msg.role === "assistant" && msg.content.trim().length > 0 && (
          <div className="asv-msg-actions">
            <CopyButton text={msg.content} />
            {msg.messageId && onFork && (
              <button
                className="asv-msg-action-btn"
                onClick={() => onFork(msg.messageId!)}
                title="Fork from here"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                >
                  <circle cx="4" cy="4" r="1.5" />
                  <circle cx="12" cy="4" r="1.5" />
                  <circle cx="4" cy="12" r="1.5" />
                  <path d="M4 5.5V10.5M5.5 4H10.5" />
                </svg>
              </button>
            )}
          </div>
        )}
        {metaParts.length > 0 && (
          <div className="asv-msg-footer">
            {metaParts.map((part, idx) => (
              <span key={idx}>{part}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

export default MessageItem;
