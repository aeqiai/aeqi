import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bot } from "lucide-react";
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
import SessionsFilterPopover, {
  type SessionsFilterState,
} from "@/components/sessions/SessionsFilterPopover";
import SessionsSortPopover, { type SessionsSort } from "@/components/sessions/SessionsSortPopover";
import SessionsToolbar from "@/components/sessions/SessionsToolbar";
import { Icon, Loading, ToolbarRadioPopover } from "@/components/ui";
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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SessionsSort>("recent");
  const [filter, setFilter] = useState<SessionsFilterState>({ status: "all" });
  const [agentFilter, setAgentFilter] = useState("all");

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
  const totalConversationCount = sessions.filter(
    (session) => session.session_type !== "task",
  ).length;
  const filtering = query.trim() !== "" || filter.status !== "all" || agentFilter !== "all";
  const emptyTitle = filtering ? "no matching sessions" : "no sessions yet";
  const emptyHint = filtering
    ? "clear a filter or search term"
    : "agent conversations will appear here";

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
        <span className="trust-sessions-count">
          {totalConversationCount} {totalConversationCount === 1 ? "session" : "sessions"}
        </span>
      </div>

      <SessionsToolbar
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
