import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { entityPathFromId } from "@/lib/entityPath";
import { recencyBucket, timeShort } from "@/lib/format";
import { inboxMessagesAdapter } from "@/components/inbox/inboxMessagesAdapter";
import {
  gatewayLabel,
  sessionLabel,
  type Message,
  type SessionInfo,
} from "@/components/session/types";
import SessionDetail from "@/components/sessions/SessionDetail";
import SessionRail, { type SessionRailRow } from "@/components/sessions/SessionRail";
import { Loading } from "@/components/ui";
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

export default function TrustSessionsTab({
  trustId,
  itemId,
}: {
  trustId: string;
  itemId?: string;
}) {
  const navigate = useNavigate();
  const entities = useDaemonStore((s) => s.entities);
  const agents = useDaemonStore((s) => s.agents);
  const streamingSessions = useChatStore((s) => s.streamingSessions);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);

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

  const rows = useMemo<SessionRailRow[]>(() => {
    return sessions
      .filter((session) => session.session_type !== "task")
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
      .sort((a, b) => b.sortKey - a.sortKey);
  }, [agentNameById, sessions]);

  const selectedId = itemId && rows.some((row) => row.id === itemId) ? itemId : rows[0]?.id;
  const selected = sessions.find((session) => session.id === selectedId) ?? null;
  const selectedAgentName =
    selected?.agent_name || (selected?.agent_id ? agentNameById.get(selected.agent_id) : null);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    let alive = true;
    setMessagesLoading(true);
    api
      .getSessionMessages(selectedId, 500, trustId)
      .then((data) => {
        if (!alive) return;
        setMessages(inboxMessagesAdapter(data, selectedAgentName ?? undefined));
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
  }, [selectedAgentName, selectedId, trustId]);

  const handleSelect = useCallback(
    (id: string) => {
      navigate(entityPathFromId(entities, trustId, "sessions", id), { replace: true });
    },
    [entities, navigate, trustId],
  );

  const empty = !loading && rows.length === 0;

  return (
    <div className="inbox-page trust-sessions-page">
      <div className="inbox-page-header">
        <div>
          <span className="inbox-page-heading">Trust</span>
          <h1 className="inbox-page-title">Sessions</h1>
          <p className="agent-settings-card-subtitle">
            All conversations in this trust, across every agent.
          </p>
        </div>
      </div>

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
                emptyTitle="no sessions yet"
                emptyHint="agent conversations will appear here"
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
            title={selected ? sessionLabel(selected) : "Sessions"}
            subtitle={
              selected
                ? sessionSecondaryLabel(selected, selectedAgentName ?? null)
                : "Choose a session from the rail."
            }
            messages={messages}
            isStreaming={!!selectedId && !!streamingSessions[selectedId]}
            onSend={() => {
              /* trust-wide session index is read-only for now */
            }}
            composerDisabled
            hideComposer
            surface="recessed"
            emptyTitle={messagesLoading ? "loading messages" : "no messages yet"}
            emptyHint={messagesLoading ? "fetching the transcript" : "select another session"}
          />
        </div>
      </div>
    </div>
  );
}
