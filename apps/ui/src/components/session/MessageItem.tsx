import { useId, useMemo, useState, memo } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, CircleDot, CirclePlus, ExternalLink } from "lucide-react";
import { IconButton, Tooltip } from "@/components/ui";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { entityPathFromId } from "@/lib/entityPath";
import BlockAvatar from "@/components/BlockAvatar";
import MentionText from "@/components/MentionText";
import {
  type Message,
  type MessageSegment,
  type ResolvedAuthor,
  resolveAuthor,
  formatTransportLabel,
  formatTime,
  formatStepCount,
  countStepSegments,
  splitTrailAndFinal,
  trailHasFailure,
  trailHasMeaningfulContent,
} from "./types";
import { SegmentRenderer, EventFireItem, SessionMarkdown } from "./SegmentRenderer";
import { parseErrorContent } from "./parseErrorContent";

// ── Copy button ─────────────────────────────────────────────────────────

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

// ── Collapsed trail — assistant turn's intermediate work ─────────────────

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
  const detailId = useId();
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
        aria-controls={detailId}
        aria-label={`${expanded ? "Collapse" : "Expand"} agent thinking trail`}
      >
        <span className="asv-trail-chevron" aria-hidden="true">
          {"▸"}
        </span>
        <span className="asv-trail-summary">{label}</span>
      </button>
      {expanded && (
        <div id={detailId} className="asv-trail-detail">
          <SegmentRenderer segments={trail} />
        </div>
      )}
    </div>
  );
}

function PositionChip({ title }: { title: string }) {
  return <span className="asv-position-chip">{title}</span>;
}

// ── Error bubble ────────────────────────────────────────────────────────

function ErrorBubble({ msg }: { msg: Message }) {
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

// ── Quest activity card ─────────────────────────────────────────────────

function questEventTone(
  eventType: string | undefined,
): "create" | "complete" | "blocked" | "update" {
  const t = eventType ?? "";
  if (t.includes("create")) return "create";
  if (t.includes("complete") || t.includes("close") || t.includes("done")) return "complete";
  if (t.includes("block") || t.includes("fail") || t.includes("cancel")) return "blocked";
  return "update";
}

function QuestEventIcon({ tone }: { tone: ReturnType<typeof questEventTone> }) {
  if (tone === "create") return <CirclePlus size={16} strokeWidth={1.7} />;
  if (tone === "complete") return <CheckCircle2 size={16} strokeWidth={1.7} />;
  if (tone === "blocked") return <AlertTriangle size={16} strokeWidth={1.7} />;
  return <CircleDot size={16} strokeWidth={1.7} />;
}

function QuestEventBubble({ msg, trustId: contextTrustId }: { msg: Message; trustId?: string }) {
  const { trustId: routeTrustId, entityPath } = useNav();
  const trustId = contextTrustId ?? routeTrustId;
  const tone = questEventTone(msg.eventType);
  const title = msg.quest?.subject || msg.content || "Quest updated";
  const status = msg.quest?.status ? msg.quest.status.replace(/_/g, " ") : null;
  const summary = msg.quest?.outcomeSummary || (msg.quest?.subject ? msg.content : "");
  const questId = msg.quest?.id || msg.taskId;
  const href = questId && trustId ? entityPath(trustId, "quests", questId) : null;
  const className = `asv-quest-event asv-quest-event--${tone}${href ? " is-linked" : ""}`;
  const ariaLabel = `Quest ${status ? `${status}: ` : ""}${title}`;
  const body = (
    <>
      <span className="asv-quest-event-icon" aria-hidden="true">
        <QuestEventIcon tone={tone} />
      </span>
      <span className="asv-quest-event-body">
        <span className="asv-quest-event-kicker">
          <span>Quest update</span>
          {msg.timestamp && <span>{formatTime(msg.timestamp)}</span>}
        </span>
        <span className="asv-quest-event-title">{title}</span>
        {summary && summary !== title && <span className="asv-quest-event-summary">{summary}</span>}
        <span className="asv-quest-event-meta">
          {status && <span className="asv-quest-event-status">{status}</span>}
          {msg.quest?.runtime && <span>{msg.quest.runtime}</span>}
          {href && (
            <span className="asv-quest-event-open">
              Open quest <ExternalLink size={12} strokeWidth={1.7} aria-hidden="true" />
            </span>
          )}
        </span>
      </span>
    </>
  );

  if (href) {
    return (
      <Link className={className} to={href} aria-label={ariaLabel}>
        {body}
      </Link>
    );
  }

  return (
    <div className={className} aria-label={ariaLabel}>
      {body}
    </div>
  );
}

// ── Avatar resolution — shared by agent / position / user senders ────────

interface AvatarResolution {
  href: string | undefined;
  name: string;
  photoUrl: string;
  shape: "circle" | "rounded-square";
  authorLabel: string | null;
}

function resolveAvatar(
  author: ResolvedAuthor,
  ctx: {
    trustId: string | undefined;
    entitiesList: ReturnType<typeof useDaemonStore.getState>["entities"];
    currentUserId: string;
    currentUserName: string;
    currentUserAvatarUrl: string;
    userEmail: string;
  },
): AvatarResolution | null {
  const { trustId, entitiesList, currentUserId, currentUserName, currentUserAvatarUrl, userEmail } =
    ctx;
  if (author.kind === "system") return null;

  if (author.kind === "agent") {
    const href = trustId
      ? entityPathFromId(entitiesList, trustId, "agents", encodeURIComponent(author.id))
      : undefined;
    return {
      href,
      name: author.name,
      photoUrl: "",
      shape: "rounded-square",
      authorLabel: author.name,
    };
  }
  if (author.kind === "position") {
    const href = trustId
      ? entityPathFromId(entitiesList, trustId, "roles", encodeURIComponent(author.id))
      : undefined;
    return {
      href,
      name: author.title,
      photoUrl: "",
      shape: "rounded-square",
      authorLabel: author.title,
    };
  }
  // author.kind === "user"
  const isCurrentUser = !!(author.id && currentUserId && author.id === currentUserId);
  return {
    href: isCurrentUser ? "/account" : undefined,
    name: isCurrentUser
      ? currentUserName || author.name || userEmail || "You"
      : author.name || "User",
    photoUrl: isCurrentUser ? currentUserAvatarUrl || "" : "",
    shape: "circle",
    authorLabel: isCurrentUser ? "You" : author.name || "User",
  };
}

function AvatarCell({ avatar }: { avatar: AvatarResolution }) {
  const { href, name, photoUrl, shape } = avatar;
  const photoBorderRadius = shape === "circle" ? "999px" : "var(--radius-sm)";

  if (photoUrl) {
    const img = (
      <img
        src={photoUrl}
        alt={name}
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
    );
    return href ? (
      <Link
        to={href}
        className="block-avatar-link"
        aria-label={name}
        title={name}
        onClick={(e) => e.stopPropagation()}
      >
        {img}
      </Link>
    ) : (
      img
    );
  }
  return <BlockAvatar name={name} size={20} href={href} ariaLabel={name} shape={shape} />;
}

// ── Message meta + chrome actions ────────────────────────────────────────

function senderIdentity(msg: Message): { label: string; detail: string | null } | null {
  const sender = msg.sender;
  if (!sender) return null;
  const rawTransport = sender.transport ?? msg.transport;
  if (
    !rawTransport ||
    ["agent", "internal", "quest", "session", "user", "web"].includes(rawTransport)
  ) {
    return null;
  }
  const label =
    (typeof sender.display_name === "string" && sender.display_name.trim()) ||
    (typeof sender.transport_id === "string" && sender.transport_id.trim()) ||
    "";
  if (!label) return null;
  const transport = formatTransportLabel(rawTransport);
  const detail =
    transport && sender.transport_id && sender.transport_id !== label
      ? `${transport} · ${sender.transport_id}`
      : transport;
  return { label, detail };
}

function ForkButton({ messageId, onFork }: { messageId: number; onFork: (id: number) => void }) {
  return (
    <IconButton
      variant="ghost"
      size="xs"
      className="asv-msg-action-btn"
      onClick={() => onFork(messageId)}
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
  );
}

function ResendButton({ text, onResend }: { text: string; onResend: (text: string) => void }) {
  return (
    <IconButton
      variant="ghost"
      size="xs"
      className="asv-msg-action-btn"
      onClick={() => onResend(text)}
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
  );
}

function EditButton({
  messageId,
  text,
  onEdit,
}: {
  messageId: number;
  text: string;
  onEdit: (id: number, text: string) => void;
}) {
  return (
    <IconButton
      variant="ghost"
      size="xs"
      className="asv-msg-action-btn"
      onClick={() => onEdit(messageId, text)}
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
  );
}

// ── Message item — memoized to prevent re-rendering historical messages ──

const MessageItem = memo(function MessageItem({
  msg,
  onFork,
  onEdit,
  onResend,
  sessionAgentId,
  sessionTrustId,
}: {
  msg: Message;
  onFork?: (messageId: number) => void;
  onEdit?: (messageId: number, text: string) => void;
  onResend?: (text: string) => void;
  /** The agent ID for this session — used by resolveAuthor for legacy fallback. */
  sessionAgentId?: string;
  /** Entity scope for top-level inbox routes that are not under /trust/:id. */
  sessionTrustId?: string;
}) {
  const { trustId: routeTrustId } = useNav();
  const trustId = sessionTrustId ?? routeTrustId;
  const agents = useDaemonStore((s) => s.agents);
  const entitiesList = useDaemonStore((s) => s.entities);
  const userEmail = useAuthStore((s) => s.user?.email ?? "");
  const currentUserId = useAuthStore((s) => s.user?.id ?? "");
  const currentUserName = useAuthStore((s) => s.user?.name ?? "");
  const currentUserAvatarUrl = useAuthStore((s) => s.user?.avatar_url ?? "");

  const agentNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.name ?? a.id);
    return m;
  }, [agents]);

  const resolvedAgentId = sessionAgentId ?? trustId ?? "";
  const authorCtx = useMemo(
    () => ({ sessionAgentId: resolvedAgentId, agentNames, userName: userEmail }),
    [resolvedAgentId, agentNames, userEmail],
  );

  if (msg.role === "event_fire") return <EventFireItem msg={msg} />;
  if (msg.role === "quest_event") return <QuestEventBubble msg={msg} trustId={trustId} />;
  if (msg.role === "error") return <ErrorBubble msg={msg} />;

  const author = resolveAuthor(msg, authorCtx);
  const bubbleClass =
    author.kind === "user"
      ? "asv-msg-user"
      : author.kind === "system"
        ? "asv-msg-system"
        : "asv-msg-assistant";

  const isAssistantRole = msg.role === "assistant";
  const isUserRole = author.kind === "user";
  const sender = senderIdentity(msg);

  const stepCount = msg.stepCount || countStepSegments(msg.segments);
  const metaParts = [
    msg.timestamp && formatTime(msg.timestamp),
    sender?.detail,
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

  // Director-ask treatment: agent fired `question.ask` — drape an ink panel
  // around the bubble so the user reads it as a formal ask, not a chat reply.
  const isAsk = msg.source === "question.ask";

  const avatar = resolveAvatar(author, {
    trustId,
    entitiesList,
    currentUserId,
    currentUserName,
    currentUserAvatarUrl,
    userEmail,
  });
  const displayedAvatar =
    sender && avatar && author.kind === "user"
      ? {
          ...avatar,
          name: sender.label,
          authorLabel: sender.label,
        }
      : avatar;

  const showActionsAssistant =
    isAssistantRole && msg.status !== "split" && msg.content.trim().length > 0;
  const showActionsUser = isUserRole && msg.content.trim().length > 0;
  const showChrome =
    metaParts.length > 0 || (msg.content.trim().length > 0 && (isAssistantRole || isUserRole));

  return (
    <div
      className={`asv-msg ${bubbleClass}${msg.queued ? " asv-msg-queued" : ""}${isAsk ? " asv-msg-ask" : ""}${useSplit ? " asv-msg-has-trail" : ""}`}
    >
      <div className="asv-msg-body">
        {displayedAvatar?.authorLabel && (
          <div className="asv-msg-author">
            <AvatarCell avatar={displayedAvatar} />
            <span className="asv-msg-author-name">{displayedAvatar.authorLabel}</span>
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
          <div className="asv-msg-card">
            <CollapsedTrail
              trail={splitAssistant.trail}
              duration={msg.duration}
              stepCount={countStepSegments(splitAssistant.trail)}
              failed={trailHasFailure(splitAssistant.trail)}
            />
            <SegmentRenderer segments={splitAssistant.final} />
          </div>
        ) : msg.segments && msg.segments.length > 0 ? (
          <SegmentRenderer segments={msg.segments} />
        ) : (
          <div className="asv-msg-content">
            {isAssistantRole ? (
              <SessionMarkdown body={msg.content} />
            ) : (
              <MentionText body={msg.content} trustId={trustId ?? ""} />
            )}
          </div>
        )}
        {showChrome && (
          <div className="asv-msg-chrome">
            {metaParts.length > 0 && (
              <div className="asv-msg-chrome-meta">
                {metaParts.map((part, idx) => (
                  <span key={idx}>{part}</span>
                ))}
              </div>
            )}
            {showActionsAssistant && (
              <div className="asv-msg-chrome-actions">
                <CopyButton text={msg.content} />
                {msg.messageId && onFork && (
                  <ForkButton messageId={msg.messageId} onFork={onFork} />
                )}
              </div>
            )}
            {showActionsUser && (
              <div className="asv-msg-chrome-actions">
                <CopyButton text={msg.content} />
                {onResend && <ResendButton text={msg.content} onResend={onResend} />}
                {msg.messageId && onEdit && (
                  <EditButton messageId={msg.messageId} text={msg.content} onEdit={onEdit} />
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
