import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getChannelMessages,
  getChannelParticipants,
  postChannelMessage,
  type ChannelMessage,
  type ChannelParticipant,
} from "@/api/conversation-channels";
import { conversationChannelKeys } from "@/queries/keys";
import { Spinner } from "@/components/ui";
import RoundAvatar from "@/components/RoundAvatar";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useCurrentCompany } from "@/hooks/useCurrentCompany";
import { entityBasePath } from "@/lib/entityPath";
import ChannelComposer from "@/components/channels/ChannelComposer";

interface ChannelDetailPageProps {
  entityId: string;
  sessionId: string;
}

const BackIcon = () => (
  <svg
    width={12}
    height={12}
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M7.5 2L3 6l4.5 4" />
  </svg>
);

interface RenderMessage extends ChannelMessage {
  /** Whether this message starts a new author group (avatar + name shown). */
  groupStart: boolean;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function groupMessages(messages: ChannelMessage[]): RenderMessage[] {
  const out: RenderMessage[] = [];
  let prev: ChannelMessage | null = null;
  for (const m of messages) {
    const sameAuthor =
      prev !== null &&
      prev.role !== "system" &&
      m.role !== "system" &&
      (prev.sender?.id ?? prev.role) === (m.sender?.id ?? m.role);
    const within =
      prev !== null && Date.parse(m.created_at) - Date.parse(prev.created_at) < GROUP_WINDOW_MS;
    out.push({ ...m, groupStart: !sameAuthor || !within });
    prev = m;
  }
  return out;
}

function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatRelativeShort(iso: string | null): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const delta = Date.now() - t;
  if (delta < 60_000) return "just now";
  if (delta < 3600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3600_000)}h ago`;
  return new Date(t).toLocaleDateString();
}

/**
 * `/c/<entity>/channels/<sessionId>` — Slack-style channel detail.
 *
 * Three regions: header strip (name + participant chips + back), scrollable
 * message timeline (oldest top, grouped within 5-min window), composer
 * (Enter sends, Shift+Enter newline, @ mentions agents).
 *
 * Phase-1 simplifications: no inline-edit name, no archive/leave, no
 * threads/files/reactions, no unread state. Polls messages every 4s.
 */
export default function ChannelDetailPage({ entityId, sessionId }: ChannelDetailPageProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { entity } = useCurrentCompany();
  const base = entity ? entityBasePath(entity) : `/c/${entityId}`;

  const user = useAuthStore((s) => s.user);
  const agents = useDaemonStore((s) => s.agents);

  const messagesQuery = useQuery<ChannelMessage[]>({
    queryKey: conversationChannelKeys.messages(sessionId),
    queryFn: () => getChannelMessages(sessionId, 200),
    enabled: !!sessionId,
    refetchInterval: 4_000,
  });

  const participantsQuery = useQuery<ChannelParticipant[]>({
    queryKey: conversationChannelKeys.participants(sessionId),
    queryFn: () => getChannelParticipants(sessionId),
    enabled: !!sessionId,
    refetchInterval: 30_000,
  });

  const send = useMutation({
    mutationFn: (body: string) =>
      postChannelMessage({
        sessionId,
        body,
        fromKind: "user",
        fromId: user?.id ?? "",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: conversationChannelKeys.messages(sessionId),
      });
      void queryClient.invalidateQueries({
        queryKey: conversationChannelKeys.participants(sessionId),
      });
      void queryClient.invalidateQueries({
        queryKey: conversationChannelKeys.byEntity(entityId),
      });
    },
  });

  const messages = useMemo(() => groupMessages(messagesQuery.data ?? []), [messagesQuery.data]);

  // Resolve participant labels for the header chip strip + composer mention list.
  const participantsView = useMemo(() => {
    const ps = participantsQuery.data ?? [];
    const agentMap = new Map(agents.map((a) => [a.id, a]));
    return ps.map((p) => {
      if (p.identity_kind === "agent") {
        const a = agentMap.get(p.identity_id);
        return {
          ...p,
          label: a?.name ?? `agent:${p.identity_id.slice(0, 6)}`,
          avatar: a?.avatar ?? null,
          mentionToken: a?.name ?? p.identity_id,
        };
      }
      if (p.identity_kind === "user") {
        const isMe = p.identity_id === user?.id;
        return {
          ...p,
          label: isMe ? (user?.name ?? "You") : `user:${p.identity_id.slice(0, 6)}`,
          avatar: isMe ? (user?.avatar_url ?? null) : null,
          mentionToken: isMe ? (user?.name ?? "you") : p.identity_id,
        };
      }
      return {
        ...p,
        label: `${p.identity_kind}:${p.identity_id.slice(0, 6)}`,
        avatar: null,
        mentionToken: p.identity_id,
      };
    });
  }, [participantsQuery.data, agents, user]);

  const channelName = messagesQuery.data?.[0]?.metadata?.name as string | undefined;
  // We don't fetch the bare session row here; channel name comes from the
  // index-page cache. Fall back to "Channel" when not pre-cached.
  const cachedList = queryClient.getQueryData<
    {
      session_id: string;
      name: string;
      participant_count: number;
      last_message_at: string | null;
    }[]
  >(conversationChannelKeys.byEntity(entityId));
  const cachedRow = cachedList?.find((c) => c.session_id === sessionId);
  const displayName = channelName ?? cachedRow?.name ?? "Channel";

  // Auto-scroll to bottom on new messages, but only if the user was already at
  // the bottom (avoid yanking them when reading older history).
  const scrollRef = useRef<HTMLDivElement>(null);
  const wasAtBottomRef = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (wasAtBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    wasAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    document.title = `${displayName} · channels · æiq`;
  }, [displayName]);

  const handleSend = (body: string) => {
    const trimmed = body.trim();
    if (!trimmed) return;
    send.mutate(trimmed);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* Header strip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-3)",
          padding: "var(--space-3) var(--space-4)",
          background: "var(--color-card)",
        }}
      >
        <button
          type="button"
          onClick={() => navigate(`${base}/channels`)}
          aria-label="Back to channels"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 26,
            height: 26,
            background: "transparent",
            border: 0,
            cursor: "pointer",
            color: "var(--color-text-muted)",
            borderRadius: 999,
          }}
        >
          <BackIcon />
        </button>
        <span
          style={{
            fontSize: "var(--font-size-base)",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          {displayName}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginLeft: "var(--space-2)",
          }}
        >
          {participantsView.slice(0, 5).map((p) => (
            <span key={`${p.identity_kind}:${p.identity_id}`} title={p.label} aria-label={p.label}>
              <RoundAvatar name={p.label} size={20} src={p.avatar ?? undefined} />
            </span>
          ))}
          {participantsView.length > 5 && (
            <span
              style={{
                fontSize: "var(--font-size-xs)",
                color: "var(--color-text-muted)",
                marginLeft: 2,
              }}
            >
              +{participantsView.length - 5}
            </span>
          )}
        </span>
        <span style={{ flex: 1 }} />
      </div>

      {/* Message timeline */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "var(--space-4)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-1)",
          background: "var(--color-card)",
        }}
      >
        {messagesQuery.isLoading && (
          <div style={{ textAlign: "center", padding: "var(--space-6)" }}>
            <Spinner size="sm" />
          </div>
        )}
        {!messagesQuery.isLoading && messages.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "var(--space-6)",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
            }}
          >
            No messages yet. Say hi.
          </div>
        )}
        {messages.map((m) => {
          const isSystem = m.role === "system";
          const senderName =
            m.sender?.display_name ??
            (m.role === "assistant" ? "Agent" : m.role === "user" ? "User" : "System");
          if (isSystem) {
            return (
              <div
                key={m.id}
                style={{
                  fontSize: "var(--font-size-xs)",
                  color: "var(--color-text-muted)",
                  textAlign: "center",
                  margin: "var(--space-2) 0",
                }}
              >
                {m.content}
              </div>
            );
          }
          if (!m.groupStart) {
            return (
              <div
                key={m.id}
                style={{
                  paddingLeft: 36,
                  fontSize: "var(--font-size-sm)",
                  color: "var(--color-text-primary)",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {m.content}
              </div>
            );
          }
          return (
            <div
              key={m.id}
              style={{
                display: "flex",
                gap: "var(--space-2)",
                marginTop: "var(--space-3)",
              }}
            >
              <RoundAvatar name={senderName} size={28} src={m.sender?.avatar_url ?? undefined} />
              <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: "var(--space-2)",
                  }}
                >
                  <span
                    style={{
                      fontSize: "var(--font-size-sm)",
                      fontWeight: 600,
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {senderName}
                  </span>
                  <span
                    style={{
                      fontSize: "var(--font-size-xs)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {formatTime(m.created_at)}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "var(--font-size-sm)",
                    color: "var(--color-text-primary)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {m.content}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {send.error instanceof Error && (
        <div
          role="alert"
          style={{
            padding: "var(--space-2) var(--space-4)",
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-xs)",
          }}
        >
          {send.error.message}{" "}
          <button
            type="button"
            onClick={() => send.reset()}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--color-text-muted)",
              textDecoration: "underline",
              cursor: "pointer",
              fontSize: "inherit",
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      <ChannelComposer
        disabled={!user?.id || send.isPending}
        mentionables={participantsView.map((p) => ({
          kind: p.identity_kind,
          id: p.identity_id,
          label: p.label,
          token: p.mentionToken,
        }))}
        onSend={handleSend}
      />

      {/* Hidden activity announcer for screen readers */}
      <span aria-live="polite" style={{ position: "absolute", left: -9999 }}>
        {formatRelativeShort(messages[messages.length - 1]?.created_at ?? null)}
      </span>
    </div>
  );
}
