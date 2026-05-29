import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { entityPathFromId } from "@/lib/entityPath";
import { recencyBucket, timeAgo, timeShort } from "@/lib/format";
import { inboxMessagesAdapter } from "@/components/inbox/inboxMessagesAdapter";
import {
  gatewayLabel,
  sessionLabel,
  type Message,
  type SessionInfo,
} from "@/components/session/types";
import ParticipantStrip from "@/components/sessions/ParticipantStrip";
import SessionDetail from "@/components/sessions/SessionDetail";
import SessionRail, { type SessionRailRow } from "@/components/sessions/SessionRail";
import SessionsFilterPopover, {
  type SessionsFilterState,
} from "@/components/sessions/SessionsFilterPopover";
import SessionsSortPopover, { type SessionsSort } from "@/components/sessions/SessionsSortPopover";
import SessionsToolbar from "@/components/sessions/SessionsToolbar";
import { Button, Icon, Loading, PrimitivePageHeader, ToolbarRadioPopover } from "@/components/ui";
import { useRelativeNow } from "@/hooks/useRelativeNow";
import { useChatStore } from "@/store/chat";
import { useDaemonStore } from "@/store/daemon";

function sessionStatusLabel(status: string | undefined): string {
  if (!status) return "Session";
  if (status === "running") return "Active";
  const label = status.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function sessionSecondaryLabel(session: SessionInfo, agentName: string | null): string {
  return [
    agentName,
    gatewayLabel(session) ?? sessionStatusLabel(session.status),
    session.message_count ? `${session.message_count} messages` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function formatRelative(ms: number): string {
  return timeAgo(new Date(ms).toISOString());
}

export default function TrustSessionsTab({
  trustId,
  itemId,
}: {
  trustId: string;
  itemId?: string;
}) {
  const navigate = useNavigate();
  useRelativeNow();
  const entities = useDaemonStore((s) => s.entities);
  const agents = useDaemonStore((s) => s.agents);
  const streamingSessions = useChatStore((s) => s.streamingSessions);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SessionsSort>("recent");
  const [filter, setFilter] = useState<SessionsFilterState>({ status: "all" });
  const [agentFilter, setAgentFilter] = useState("all");
  const [creatingSession, setCreatingSession] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const agentNameById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getSessions(undefined, trustId)
      .then((data) => {
        if (!alive) return;
        setSessions(((data.sessions as SessionInfo[]) || []).filter((s) => s.id));
      })
      .catch(() => {
        if (alive) setSessions([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [trustId]);

  const agentOptions = useMemo(() => {
    const ids = new Set(sessions.map((session) => session.agent_id).filter(Boolean) as string[]);
    const options = [...ids]
      .map((id) => ({ id, label: agentNameById.get(id) ?? "Unknown agent" }))
      .sort((a, b) => a.label.localeCompare(b.label));
    return [{ id: "all", label: "All agents" }, ...options];
  }, [agentNameById, sessions]);

  useEffect(() => {
    if (agentFilter === "all") return;
    if (!agentOptions.some((option) => option.id === agentFilter)) {
      setAgentFilter("all");
    }
  }, [agentFilter, agentOptions]);

  const rows = useMemo<SessionRailRow[]>(() => {
    const q = query.trim().toLowerCase();
    return sessions
      .filter((session) => session.session_type !== "task")
      .filter((session) => {
        if (agentFilter !== "all" && session.agent_id !== agentFilter) return false;
        if (filter.status === "all") return true;
        const isActive = session.status === "active" || session.status === "running";
        return filter.status === "active" ? isActive : !isActive;
      })
      .map((session) => {
        const tsRaw = session.last_active || session.created_at;
        const ts = tsRaw ? Date.parse(tsRaw) : 0;
        const agentName =
          session.agent_name || (session.agent_id ? agentNameById.get(session.agent_id) : null);
        return {
          id: session.id,
          primary: sessionLabel(session),
          secondary: sessionSecondaryLabel(session, agentName ?? null),
          wrapPrimary: true,
          time: timeShort(tsRaw ?? null),
          status: session.status,
          group: recencyBucket(tsRaw ?? null),
          sortKey: Number.isFinite(ts) ? ts : 0,
        };
      })
      .filter((row) => {
        if (!q) return true;
        return `${row.primary} ${row.secondary}`.toLowerCase().includes(q);
      })
      .sort((a, b) => (sort === "recent" ? b.sortKey - a.sortKey : a.sortKey - b.sortKey));
  }, [agentFilter, agentNameById, filter.status, query, sessions, sort]);

  const selectedId = itemId && rows.some((row) => row.id === itemId) ? itemId : rows[0]?.id;
  const selected = sessions.find((session) => session.id === selectedId) ?? null;
  const selectedAgentName =
    selected?.agent_name || (selected?.agent_id ? agentNameById.get(selected.agent_id) : null);
  const selectedTitle = selected ? sessionLabel(selected) : "Sessions";
  const selectedSubtitle = selected
    ? sessionSecondaryLabel(selected, selectedAgentName ?? null)
    : "Choose a session from the rail.";
  const selectedStreaming = !!selectedId && !!streamingSessions[selectedId];
  const lastMessageTimestamp = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const timestamp = messages[i]?.timestamp;
      if (typeof timestamp === "number" && timestamp > 0) return timestamp;
    }
    return null;
  }, [messages]);
  const selectedLastActiveTimestamp = selected?.last_active
    ? Date.parse(selected.last_active)
    : NaN;
  const activityTimestamp =
    lastMessageTimestamp ??
    (Number.isFinite(selectedLastActiveTimestamp) ? selectedLastActiveTimestamp : null);
  const selectedActivityLabel = selectedStreaming
    ? "Streaming…"
    : activityTimestamp != null
      ? `Active ${formatRelative(activityTimestamp)}`
      : null;

  const loadMessages = useCallback(
    async (sessionId: string, agentName?: string | null) => {
      const data = await api.getSessionMessages(sessionId, 500, trustId);
      return inboxMessagesAdapter(data, agentName ?? undefined);
    },
    [trustId],
  );

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let alive = true;
    setMessagesLoading(true);
    loadMessages(selectedId, selectedAgentName)
      .then((next) => {
        if (alive) setMessages(next);
      })
      .catch(() => {
        if (alive) setMessages([]);
      })
      .finally(() => {
        if (alive) setMessagesLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadMessages, selectedAgentName, selectedId]);

  const handleSelect = useCallback(
    (id: string) => {
      navigate(entityPathFromId(entities, trustId, "sessions", id), { replace: true });
    },
    [entities, navigate, trustId],
  );

  const targetAgentId =
    selected?.agent_id ||
    (agentFilter !== "all" ? agentFilter : null) ||
    agents.find((agent) => agent.trust_id === trustId)?.id ||
    agents[0]?.id ||
    null;

  const handleNewSession = useCallback(async () => {
    if (!targetAgentId || creatingSession) return;
    setCreatingSession(true);
    setSendError(null);
    try {
      const data = await api.createSession(targetAgentId, trustId);
      const sessionId = (data.session_id as string | undefined) ?? null;
      if (!sessionId) throw new Error("No session id returned");
      const agentName = agentNameById.get(targetAgentId) ?? "Agent";
      const createdAt = new Date().toISOString();
      setSessions((prev) => [
        {
          id: sessionId,
          agent_id: targetAgentId,
          agent_name: agentName,
          status: "active",
          created_at: createdAt,
          last_active: createdAt,
          first_message: "New session",
          message_count: 0,
        } as SessionInfo,
        ...prev,
      ]);
      navigate(entityPathFromId(entities, trustId, "sessions", sessionId));
    } catch {
      setSendError("Could not start a new session.");
    } finally {
      setCreatingSession(false);
    }
  }, [agentNameById, creatingSession, entities, navigate, targetAgentId, trustId]);

  const handleSend = useCallback(
    async (body: string) => {
      if (!selectedId) return;
      setSending(true);
      setSendError(null);
      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          from_kind: "user",
          content: body,
          timestamp: Date.now(),
        },
      ]);
      try {
        await api.sendSessionMessage(
          {
            message: body,
            agent_id: selected?.agent_id || undefined,
            session_id: selectedId,
          },
          trustId,
        );
        const now = new Date().toISOString();
        setSessions((prev) =>
          prev.map((session) =>
            session.id === selectedId
              ? {
                  ...session,
                  last_active: now,
                  message_count: (session.message_count ?? 0) + 1,
                  first_message: session.first_message || body.slice(0, 60),
                }
              : session,
          ),
        );
      } catch {
        setSendError("Message was not sent.");
      } finally {
        setSending(false);
      }
    },
    [selected?.agent_id, selectedId, trustId],
  );

  const empty = !loading && rows.length === 0;
  const visibleConversationCount = rows.length;
  const filtering = query.trim() !== "" || filter.status !== "all" || agentFilter !== "all";
  const emptyTitle = filtering ? "no matching sessions" : "no sessions yet";
  const emptyHint = filtering
    ? "clear a filter or search term"
    : "agent conversations will appear here";

  return (
    <div className="inbox-page trust-sessions trust-sessions-page">
      <PrimitivePageHeader
        className="trust-sessions-page-header"
        title={
          <span className="trust-sessions-title">
            <span className="trust-sessions-title-text">Sessions</span>
            <span className="trust-sessions-count" aria-label={`${visibleConversationCount} shown`}>
              {visibleConversationCount}
            </span>
          </span>
        }
        aria-label="Session controls"
        actions={
          <Button
            className="trust-top-rail-cta"
            variant="primary"
            size="md"
            onClick={() => void handleNewSession()}
            disabled={!targetAgentId}
            loading={creatingSession}
            leadingIcon={<Plus size={14} strokeWidth={1.6} />}
          >
            New Session
          </Button>
        }
      >
        <SessionsToolbar
          inline
          query={query}
          onQuery={setQuery}
          searchPlaceholder="Search sessions"
          sort={<SessionsSortPopover sort={sort} onChange={setSort} />}
          filter={
            <>
              <SessionsFilterPopover
                filter={filter}
                onChange={(patch) => setFilter((prev) => ({ ...prev, ...patch }))}
              />
              <ToolbarRadioPopover
                label="Agent"
                current={agentOptions.find((option) => option.id === agentFilter)?.label ?? "Agent"}
                glyph={<Icon icon={Bot} size="sm" />}
                options={agentOptions}
                value={agentFilter}
                onChange={setAgentFilter}
                indicator={agentFilter !== "all"}
              />
            </>
          }
        />
      </PrimitivePageHeader>

      <main className="trust-sessions-main">
        {selectedId && (
          <div className="trust-session-detail-strip">
            <div className="session-detail-header trust-session-detail-header">
              <div className="session-detail-header-from">
                <span className="session-detail-header-title">{selectedTitle}</span>
                <div className="session-detail-header-meta">
                  <span className="session-detail-header-subtitle">{selectedSubtitle}</span>
                  {selectedActivityLabel && (
                    <span className="session-detail-header-meta-sep" aria-hidden>
                      ·
                    </span>
                  )}
                  {selectedActivityLabel && (
                    <span
                      className={`session-detail-header-activity${
                        selectedStreaming ? " is-streaming" : ""
                      }`}
                      role="status"
                      aria-live="polite"
                    >
                      {selectedActivityLabel}
                    </span>
                  )}
                </div>
              </div>
              <div className="session-detail-header-extras">
                <ParticipantStrip sessionId={selectedId} trustId={trustId} />
              </div>
            </div>
          </div>
        )}

        <div
          className={["inbox-shell", empty ? "is-empty" : "", selectedId ? "has-selection" : ""]
            .filter(Boolean)
            .join(" ")}
        >
          <div className="inbox-pane-list">
            <div className="inbox-pane-list-scroll">
              {loading ? (
                <div className="inbox-list-loading">
                  <Loading label="Loading sessions" />
                </div>
              ) : (
                <SessionRail
                  rows={rows}
                  selectedId={selectedId ?? null}
                  onSelect={handleSelect}
                  density="comfortable"
                  surface="card"
                  tone="recessed"
                  streamingIds={streamingSessions}
                  emptyTitle={emptyTitle}
                  emptyHint={emptyHint}
                  emptyStateClassName="sessions-rail-empty--compact"
                />
              )}
            </div>
          </div>

          <div className="inbox-pane-detail">
            <SessionDetail
              sessionId={selectedId ?? null}
              trustId={trustId}
              agentId={selected?.agent_id}
              title={selectedTitle}
              subtitle={selectedSubtitle}
              messages={messages}
              isStreaming={selectedStreaming}
              onSend={handleSend}
              composerDisabled={sending || !selectedId}
              composerPlaceholder={`Message ${selectedAgentName || "session"}...`}
              errorMessage={sendError}
              hideHeader
              surface="recessed"
              emptyTitle={messagesLoading ? "loading messages" : "no messages yet"}
              emptyHint={messagesLoading ? "fetching the transcript" : "select another session"}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
