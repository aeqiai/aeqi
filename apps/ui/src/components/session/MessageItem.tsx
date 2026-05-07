import { useMemo, useState, memo } from "react";
import { Link } from "react-router-dom";
import { IconButton, Tooltip } from "@/components/ui";
import { useNav } from "@/hooks/useNav";
import { useAgentIdeas } from "@/queries/ideas";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { entityPathFromId } from "@/lib/entityPath";
import { RichMarkdown, buildIdeasByName } from "@/components/markdown/RichMarkdown";
import BlockAvatar from "@/components/BlockAvatar";
import MentionText from "@/components/MentionText";
import {
  type Message,
  type MessageSegment,
  type ToolEvent,
  type FileChangedEvent,
  type FileDeletedEvent,
  type ToolSummarizedEvent,
  type EventFire,
  type ResolvedAuthor,
  resolveAuthor,
  formatMs,
  formatTime,
  formatStepCount,
  countStepSegments,
  toolLabel,
  shouldRenderStatus,
  splitTrailAndFinal,
  trailHasFailure,
  trailHasMeaningfulContent,
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

/**
 * Parse a runtime error string into a humane shape for the chat error bubble.
 *
 * The runtime emits raw upstream errors verbatim (OpenRouter/DeepInfra JSON,
 * generic JSON-RPC envelopes, plain strings). Rendering those raw is
 * unreadable. This helper recognises the common shapes and lifts the
 * relevant signal to a one-line headline + optional detail + optional hint.
 *
 * Falls through to `headline = content` for unknown shapes so we never lose
 * information.
 */
function parseErrorContent(content: string): {
  headline: string;
  detail?: string;
  hint?: string;
} {
  const text = (content || "").trim();
  if (!text) return { headline: "Something went wrong." };

  // Try to extract any embedded JSON object so we can read structured fields.
  let parsed: unknown = null;
  const braceStart = text.indexOf("{");
  if (braceStart >= 0) {
    const candidate = text.slice(braceStart);
    try {
      parsed = JSON.parse(candidate);
    } catch {
      // not JSON or not at the tail; ignore
    }
  } else {
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON
    }
  }

  const errObj =
    parsed && typeof parsed === "object" && parsed !== null
      ? ((parsed as Record<string, unknown>).error ?? parsed)
      : null;
  const errMsg =
    errObj && typeof errObj === "object" && errObj !== null
      ? typeof (errObj as Record<string, unknown>).message === "string"
        ? ((errObj as Record<string, unknown>).message as string)
        : null
      : null;
  const errCode =
    errObj && typeof errObj === "object" && errObj !== null
      ? typeof (errObj as Record<string, unknown>).code === "number"
        ? ((errObj as Record<string, unknown>).code as number)
        : null
      : null;
  const errMetadataRaw =
    errObj && typeof errObj === "object" && errObj !== null
      ? (() => {
          const m = (errObj as Record<string, unknown>).metadata;
          if (m && typeof m === "object" && m !== null) {
            const raw = (m as Record<string, unknown>).raw;
            return typeof raw === "string" ? raw : null;
          }
          return null;
        })()
      : null;

  // OpenRouter / provider HTTP error envelope, e.g.
  //   "OpenRouter API error (429 Too Many Requests): {...}"
  //   "Anthropic API error (529 Overloaded): {...}"
  const httpEnvelope = text.match(/^([A-Za-z0-9_ -]+?) (?:API )?error \((\d{3})[^)]*\)/);
  if (httpEnvelope) {
    const provider = httpEnvelope[1].trim();
    const status = parseInt(httpEnvelope[2], 10);
    // Try to surface the upstream model name from metadata.raw if present
    const modelMatch = errMetadataRaw?.match(/([\w./:-]+)\s+is\s+(?:temporarily\s+)?rate-limited/i);
    const modelName = modelMatch ? modelMatch[1] : null;

    if (status === 429) {
      return {
        headline: "Upstream is rate-limited",
        detail: modelName
          ? `${provider} returned 429 for ${modelName}`
          : `${provider} returned 429`,
        hint: "Retrying or add your own OpenRouter key in Settings → Integrations",
      };
    }
    if (status === 401 || status === 403) {
      return {
        headline: "Upstream rejected the request",
        detail: `${provider} returned ${status}${errMsg ? `: ${errMsg}` : ""}`,
        hint: "Check the API key in Settings → Integrations",
      };
    }
    if (status === 402) {
      return {
        headline: "Upstream is out of credit",
        detail: `${provider} returned 402${errMsg ? `: ${errMsg}` : ""}`,
        hint: "Add credit or switch provider in Settings → Integrations",
      };
    }
    if (status === 408 || status === 504) {
      return {
        headline: "Upstream timed out",
        detail: `${provider} returned ${status}`,
        hint: "Retrying — if this persists try a different model",
      };
    }
    if (status >= 500) {
      return {
        headline: "Upstream service is down",
        detail: `${provider} returned ${status}${errMsg ? `: ${errMsg}` : ""}`,
        hint: "Try again in a moment or switch model",
      };
    }
    if (status >= 400) {
      return {
        headline: `${provider} returned ${status}`,
        detail: errMsg ?? undefined,
      };
    }
  }

  // Generic JSON-shaped error with .error.message
  if (errMsg) {
    const codeNote = errCode ? ` (${errCode})` : "";
    return {
      headline: `${errMsg}${codeNote}`,
    };
  }

  // Fallthrough: unknown shape — render as-is, capped to one readable line.
  return { headline: text };
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
          <span className="asv-tools-chevron">{expanded ? "▾" : "▸"}</span>
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

function SessionMarkdown({ body }: { body: string }) {
  const { entityId } = useNav();
  const { data: ideas } = useAgentIdeas(entityId);
  const ideasByName = useMemo(() => buildIdeasByName(ideas), [ideas]);
  return (
    <RichMarkdown body={body} variant="session" ideasByName={ideasByName} agentId={entityId} />
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Tooltip content={copied ? "Copied" : "Copy"}>
      <IconButton
        variant="ghost"
        size="xs"
        className="asv-copy"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : "Copy message"}
      >
        {copied ? (
          <svg
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
      </IconButton>
    </Tooltip>
  );
}

/** Returns the filename portion of a path, or the full path if no separator. */
function shortPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || p;
}

/** Formats a byte count as a human-readable size string (e.g. "2.4 KB"). */
function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

/** Chip for a FileChanged event. */
function FileChangedChip({ event }: { event: FileChangedEvent }) {
  const isCreated = event.operation === "created";
  return (
    <div className={`asv-file-chip asv-file-chip--${isCreated ? "created" : "modified"}`}>
      <span className="asv-file-chip-dot" aria-hidden="true" />
      <span className="asv-file-chip-op">{isCreated ? "wrote" : "edited"}</span>
      <span className="asv-file-chip-path" title={event.path}>
        {shortPath(event.path)}
      </span>
      <span className="asv-file-chip-size">({formatBytes(event.bytes)})</span>
    </div>
  );
}

/** Chip for a FileDeleted event. */
function FileDeletedChip({ event }: { event: FileDeletedEvent }) {
  return (
    <div className="asv-file-chip asv-file-chip--deleted">
      <span className="asv-file-chip-dot" aria-hidden="true" />
      <span className="asv-file-chip-op">deleted</span>
      <span className="asv-file-chip-path" title={event.path}>
        {shortPath(event.path)}
      </span>
    </div>
  );
}

/** Chip for a ToolSummarized event — shows tool name + size, expandable summary. */
function ToolSummarizedChip({ event }: { event: ToolSummarizedEvent }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="asv-tool-summarized-chip">
      <button
        type="button"
        className="asv-tool-summarized-header"
        onClick={() => setExpanded((e) => !e)}
        title={expanded ? "Hide summary" : "Show summary"}
      >
        <span className="asv-tool-summarized-dot" aria-hidden="true" />
        <span className="asv-tool-summarized-name">{event.tool_name}</span>
        <span className="asv-tool-summarized-label">summarized</span>
        <span className="asv-tool-summarized-size">({formatBytes(event.original_bytes)})</span>
        <span className="asv-tool-summarized-chevron">{expanded ? "▾" : "▸"}</span>
      </button>
      {expanded && event.summary && <div className="asv-tool-summarized-body">{event.summary}</div>}
    </div>
  );
}

/**
 * Collapsed grey row summarising an assistant turn's intermediate work.
 * Clicking expands into the full segment trace.
 */
function CollapsedTrail({
  trail,
  duration,
  stepCount,
  failed,
}: {
  trail: MessageSegment[];
  duration?: string;
  stepCount: number;
  failed: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const label = duration
    ? `Thought for ${duration}`
    : stepCount > 0
      ? `Thought for ${stepCount} step${stepCount === 1 ? "" : "s"}`
      : "Thought";

  return (
    <div
      className={`asv-trail${failed ? " asv-trail--fail" : ""}${expanded ? " asv-trail--expanded" : ""}`}
    >
      <button
        type="button"
        className="asv-trail-toggle"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <span className="asv-trail-chevron" aria-hidden="true">
          {"▸"}
        </span>
        <span className="asv-trail-summary">{label}</span>
      </button>
      {expanded && (
        <div className="asv-trail-detail">
          <SegmentRenderer segments={trail} />
        </div>
      )}
    </div>
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
    | { kind: "event_fire"; fire: EventFire }
    | { kind: "tools"; items: MessageSegment[] }
    | { kind: "file_changed"; event: FileChangedEvent }
    | { kind: "file_deleted"; event: FileDeletedEvent }
    | { kind: "tool_summarized"; event: ToolSummarizedEvent };
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
    } else if (seg.kind === "event_fire") {
      groups.push({ kind: "event_fire", fire: seg.fire });
    } else if (seg.kind === "file_changed") {
      groups.push({ kind: "file_changed", event: seg.event });
    } else if (seg.kind === "file_deleted") {
      groups.push({ kind: "file_deleted", event: seg.event });
    } else if (seg.kind === "tool_summarized") {
      groups.push({ kind: "tool_summarized", event: seg.event });
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
            <SessionMarkdown body={group.text} />
          </div>
        ) : group.kind === "step" ? (
          <div key={gi} className="asv-step-sep">
            <span>{`Step ${group.step}`}</span>
          </div>
        ) : group.kind === "status" ? (
          <div key={gi} className="asv-status-line">
            {group.text}
          </div>
        ) : group.kind === "event_fire" ? (
          <EventFireItem
            key={gi}
            msg={{ role: "event_fire", content: "", eventFire: group.fire }}
          />
        ) : group.kind === "file_changed" ? (
          <FileChangedChip key={gi} event={group.event} />
        ) : group.kind === "file_deleted" ? (
          <FileDeletedChip key={gi} event={group.event} />
        ) : group.kind === "tool_summarized" ? (
          <ToolSummarizedChip key={gi} event={group.event} />
        ) : (
          <ToolBlock key={gi} items={group.items} live={live} />
        ),
      )}
    </>
  );
}

// ── Position author chip — shown for position-kind senders ──

function PositionChip({ title }: { title: string }) {
  return <span className="asv-position-chip">{title}</span>;
}

function EventFireItem({ msg }: { msg: Message }) {
  const { goEntity, entityId } = useNav();
  const fire = msg.eventFire;

  if (!fire) return null;

  return (
    <div className="asv-event-fire">
      <button
        type="button"
        className="asv-event-fire-name"
        onClick={() => entityId && goEntity(entityId, "events", fire.eventId)}
        title={fire.pattern}
      >
        {fire.eventName || fire.pattern || "event"}
      </button>
      {fire.scope && fire.scope !== "self" && (
        <span className="asv-event-fire-scope">{`(${fire.scope})`}</span>
      )}
      {msg.timestamp && <span className="asv-event-fire-time">{formatTime(msg.timestamp)}</span>}
    </div>
  );
}

// ── Memoized message item — prevents re-rendering historical messages during streaming ──

const MessageItem = memo(function MessageItem({
  msg,
  onFork,
  onEdit,
  onResend,
  sessionAgentId,
}: {
  msg: Message;
  onFork?: (messageId: number) => void;
  onEdit?: (messageId: number, text: string) => void;
  onResend?: (text: string) => void;
  /** The agent ID for this session — used by resolveAuthor for legacy fallback. */
  sessionAgentId?: string;
}) {
  const { entityId } = useNav();
  const agents = useDaemonStore((s) => s.agents);
  const entitiesList = useDaemonStore((s) => s.entities);
  const userEmail = useAuthStore((s) => s.user?.email ?? "");
  const currentUserId = useAuthStore((s) => s.user?.id ?? "");
  const currentUserName = useAuthStore((s) => s.user?.name ?? "");
  const currentUserAvatarUrl = useAuthStore((s) => s.user?.avatar_url ?? "");

  const agentNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) {
      m.set(a.id, a.name ?? a.id);
    }
    return m;
  }, [agents]);

  const resolvedAgentId = sessionAgentId ?? entityId ?? "";
  const authorCtx = useMemo(
    () => ({
      sessionAgentId: resolvedAgentId,
      agentNames,
      userName: userEmail,
    }),
    [resolvedAgentId, agentNames, userEmail],
  );

  if (msg.role === "event_fire") {
    return <EventFireItem msg={msg} />;
  }
  if (msg.role === "quest_event") {
    return (
      <div className="asv-quest-event">
        <span className="asv-quest-event-icon">
          {(msg.eventType || "").includes("create")
            ? "+"
            : (msg.eventType || "").includes("complete") || (msg.eventType || "").includes("close")
              ? "✓"
              : (msg.eventType || "").includes("block")
                ? "!"
                : "→"}
        </span>
        <span className="asv-quest-event-text">{msg.content}</span>
        {msg.timestamp && <span className="asv-quest-event-time">{formatTime(msg.timestamp)}</span>}
      </div>
    );
  }
  if (msg.role === "error") {
    const parsed = parseErrorContent(msg.content || "");
    return (
      <div className="asv-msg asv-msg-error">
        <div className="asv-msg-header">
          {msg.duration && <span className="asv-msg-duration">{msg.duration}</span>}
        </div>
        <div className="asv-msg-error-body">
          <div className="asv-msg-error-headline">{parsed.headline}</div>
          {parsed.detail && <div className="asv-msg-error-detail">{parsed.detail}</div>}
          {parsed.hint && <div className="asv-msg-error-hint">{parsed.hint}</div>}
        </div>
      </div>
    );
  }

  const author: ResolvedAuthor = resolveAuthor(msg, authorCtx);

  // Map resolved author kind to the CSS bubble class.
  // "position" renders left-aligned like "assistant".
  const bubbleClass =
    author.kind === "user"
      ? "asv-msg-user"
      : author.kind === "system"
        ? "asv-msg-system"
        : "asv-msg-assistant";

  const isAssistantRole = msg.role === "assistant";
  // User-role check covers both explicit from_kind="user" and legacy role="user"
  const isUserRole = author.kind === "user";

  const stepCount = msg.stepCount || countStepSegments(msg.segments);
  const metaParts = [
    msg.timestamp && formatTime(msg.timestamp),
    msg.duration,
    isAssistantRole && stepCount > 0 && formatStepCount(stepCount),
    msg.costUsd != null && msg.costUsd > 0 && `$${msg.costUsd.toFixed(4)}`,
    msg.tokenUsage &&
      (msg.tokenUsage.prompt > 0 || msg.tokenUsage.completion > 0) &&
      `${msg.tokenUsage.prompt}→${msg.tokenUsage.completion} tok`,
    msg.queued && "queued",
  ].filter(Boolean) as string[];

  const splitAssistant =
    isAssistantRole && msg.segments && msg.segments.length > 0
      ? splitTrailAndFinal(msg.segments)
      : null;
  const useSplit = splitAssistant != null && trailHasMeaningfulContent(splitAssistant.trail);

  // Director-ask treatment: when the agent fired `question.ask`, the
  // assistant message carries `source = "question.ask"` and (optionally) a
  // subject. Drape the bubble in an ink panel so the chat user reads it as
  // "this is a formal ask, not a chat reply".
  const isAsk = msg.source === "question.ask";

  // Avatar + author header row: agent / position / user senders all render a
  // small avatar inline with the sender name in `.asv-msg-author`. The row's
  // direction flips for user messages so name/avatar mirror the right-aligned
  // bubble. System messages render no avatar and no header.
  const showAvatar =
    author.kind === "agent" || author.kind === "position" || author.kind === "user";
  const avatarName =
    author.kind === "agent"
      ? author.name
      : author.kind === "position"
        ? author.title
        : author.kind === "user"
          ? author.id && currentUserId && author.id === currentUserId
            ? currentUserName || author.name || userEmail || "You"
            : author.name || "User"
          : "";
  // Photo URL — only for the current user's own avatar (we don't have other
  // users' photos in the session message payload yet).
  const avatarPhotoUrl =
    author.kind === "user" && author.id && currentUserId && author.id === currentUserId
      ? currentUserAvatarUrl || ""
      : "";

  // Author header label — names the sender next to the avatar. "You" for
  // the current user, real name for others; suppressed for system messages.
  const authorLabel =
    author.kind === "agent"
      ? author.name
      : author.kind === "position"
        ? author.title
        : author.kind === "user"
          ? author.id && currentUserId && author.id !== currentUserId
            ? author.name || "User"
            : "You"
          : null;

  // Resolve a navigation target for the avatar so clicking jumps to the
  // sender's identity surface. Agents → /<entityBase>/agents/<id>. Positions
  // → /<entityBase>/roles/<id>. The current user → /account. Other users
  // have no public surface today, so leave their avatar unlinked.
  const avatarHref = (() => {
    if (!entityId) return undefined;
    if (author.kind === "agent" && author.id) {
      return entityPathFromId(entitiesList, entityId, "agents", encodeURIComponent(author.id));
    }
    if (author.kind === "position" && author.id) {
      return entityPathFromId(entitiesList, entityId, "roles", encodeURIComponent(author.id));
    }
    if (author.kind === "user" && author.id && currentUserId && author.id === currentUserId) {
      return "/account";
    }
    return undefined;
  })();

  // Avatar shape is determined by KIND, not by whether a photo URL exists.
  // Humans/users render as full circles; agents (and agent-adjacent kinds
  // like positions) render as slight-rounded squares.
  const avatarShape: "circle" | "rounded-square" =
    author.kind === "user" ? "circle" : "rounded-square";
  const photoBorderRadius = avatarShape === "circle" ? "999px" : "var(--radius-sm)";

  const avatarEl = showAvatar ? (
    avatarPhotoUrl ? (
      avatarHref ? (
        <Link
          to={avatarHref}
          className="block-avatar-link"
          aria-label={avatarName}
          title={avatarName}
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={avatarPhotoUrl}
            alt={avatarName}
            width={20}
            height={20}
            style={{
              width: 20,
              height: 20,
              borderRadius: photoBorderRadius,
              objectFit: "cover",
              display: "block",
            }}
          />
        </Link>
      ) : (
        <img
          src={avatarPhotoUrl}
          alt={avatarName}
          width={20}
          height={20}
          style={{
            width: 20,
            height: 20,
            borderRadius: photoBorderRadius,
            objectFit: "cover",
            display: "block",
          }}
        />
      )
    ) : (
      <BlockAvatar
        name={avatarName}
        size={20}
        href={avatarHref}
        ariaLabel={avatarName}
        shape={avatarShape}
      />
    )
  ) : null;

  return (
    <div
      className={`asv-msg ${bubbleClass}${msg.queued ? " asv-msg-queued" : ""}${isAsk ? " asv-msg-ask" : ""}`}
    >
      <div className="asv-msg-body">
        {authorLabel && (
          <div className="asv-msg-author">
            {avatarEl}
            <span className="asv-msg-author-name">{authorLabel}</span>
            {author.kind === "position" && <PositionChip title={author.title} />}
          </div>
        )}
        {isAsk && (
          <div className="asv-msg-ask-header" aria-label="Asking the director">
            <span className="asv-msg-ask-eyebrow">ASKING THE DIRECTOR</span>
            {msg.askSubject && msg.askSubject !== msg.content && (
              <span className="asv-msg-ask-subject">{msg.askSubject}</span>
            )}
          </div>
        )}
        {useSplit && splitAssistant ? (
          <>
            <CollapsedTrail
              trail={splitAssistant.trail}
              duration={msg.duration}
              stepCount={countStepSegments(splitAssistant.trail)}
              failed={trailHasFailure(splitAssistant.trail)}
            />
            <SegmentRenderer segments={splitAssistant.final} />
          </>
        ) : msg.segments && msg.segments.length > 0 ? (
          <SegmentRenderer segments={msg.segments} />
        ) : (
          <div className="asv-msg-content">
            {isAssistantRole ? (
              <SessionMarkdown body={msg.content} />
            ) : (
              <MentionText body={msg.content} entityId={entityId ?? ""} />
            )}
          </div>
        )}
        {(metaParts.length > 0 ||
          (msg.content.trim().length > 0 && (isAssistantRole || isUserRole))) && (
          <div className="asv-msg-chrome">
            {metaParts.length > 0 && (
              <div className="asv-msg-chrome-meta">
                {metaParts.map((part, idx) => (
                  <span key={idx}>{part}</span>
                ))}
              </div>
            )}
            {isAssistantRole && msg.status !== "split" && msg.content.trim().length > 0 && (
              <div className="asv-msg-chrome-actions">
                <CopyButton text={msg.content} />
                {msg.messageId && onFork && (
                  <IconButton
                    variant="ghost"
                    size="xs"
                    className="asv-msg-action-btn"
                    onClick={() => onFork(msg.messageId!)}
                    aria-label="Fork from here"
                    title="Fork from here"
                  >
                    <svg
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
                  </IconButton>
                )}
              </div>
            )}
            {isUserRole && msg.content.trim().length > 0 && (
              <div className="asv-msg-chrome-actions">
                <CopyButton text={msg.content} />
                {onResend && (
                  <IconButton
                    variant="ghost"
                    size="xs"
                    className="asv-msg-action-btn"
                    onClick={() => onResend(msg.content)}
                    aria-label="Resend"
                    title="Resend this message"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
                      <path d="M2.5 3v3h3" />
                    </svg>
                  </IconButton>
                )}
                {msg.messageId && onEdit && (
                  <IconButton
                    variant="ghost"
                    size="xs"
                    className="asv-msg-action-btn"
                    onClick={() => onEdit(msg.messageId!, msg.content)}
                    aria-label="Edit and resend"
                    title="Edit and resend (forks the session)"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M11.5 1.8l2.7 2.7-8.5 8.5L2 14l1-3.7 8.5-8.5z" />
                      <path d="M10.2 3.1l2.7 2.7" />
                    </svg>
                  </IconButton>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});

export default MessageItem;
