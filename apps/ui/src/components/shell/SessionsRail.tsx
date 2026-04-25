import { memo, useCallback, useEffect, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import { useNav } from "@/hooks/useNav";
import { ThinkingDot } from "@/components/ui";
import { sessionLabel, type SessionInfo } from "@/components/session/types";
import { recencyBucket, timeShort, type RecencyBucket } from "@/lib/format";

const NO_SESSIONS: SessionInfo[] = [];

/**
 * Resolve a session's origin — the answer to "why does this session
 * exist?". Returns a short lowercase string when we can name it
 * confidently (telegram / whatsapp / web), or undefined for the
 * generic catchalls (`interactive`, `perpetual`) where the rail row
 * should stay single-line. Event- and agent-spawned origins would
 * need a richer backend signal; not surfaced today.
 */
function deriveOrigin(s: SessionInfo): string | undefined {
  const n = s.name?.toLowerCase() || "";
  if (n.includes("telegram")) return "telegram";
  if (n.includes("whatsapp")) return "whatsapp";
  if (s.session_type === "web") return "web";
  return undefined;
}

interface SessionRow {
  id: string;
  /** Bold body line — what the user is actually here to read. */
  primary: string;
  /** Optional whisper-meta line under the primary. Inbox uses it for
   *  agent · root; agent mode uses it for the channel name. */
  secondary?: string;
  /** When true, primary wraps to up to 2 lines instead of single-line
   *  ellipsis. Both modes opt in for visual consistency. */
  wrapPrimary?: boolean;
  time: string;
  status?: string;
  awaiting?: boolean;
  group: RecencyBucket;
  sortKey: number;
}

interface SessionsRailProps {
  /**
   * "agent" — per-agent rail at /:agentId/sessions; reads from chat
   * store. Default for agent-scope routes.
   *
   * "inbox" — user-scope rail at /sessions/:id (and /). Reads from
   * inbox store; rows are awaiting questions across every agent the
   * user has access to. Click navigates to /sessions/:id (no agent
   * prefix) so the same shell handles both flows.
   */
  mode: "agent" | "inbox";
  /** When mode="inbox", the currently-selected session_id from the URL. */
  selectedSessionId?: string | null;
}

/**
 * Sessions rail — the left-adjacent index column. Two modes:
 *   - agent: per-agent session list (chat store, default)
 *   - inbox: user-scope inbox items (awaiting questions across all
 *            agents). Inbox rows surface the subject as the primary
 *            line and the agent name as a secondary line below — the
 *            question is the unit of triage; truncating it would
 *            force a click just to read what's being asked.
 */
export default function SessionsRail({ mode, selectedSessionId }: SessionsRailProps) {
  if (mode === "inbox") return <InboxRail selectedSessionId={selectedSessionId ?? null} />;
  return <AgentRail />;
}

function AgentRail() {
  const { agentId, itemId } = useParams<{ agentId?: string; itemId?: string }>();
  const { goAgent } = useNav();

  const sessions = useChatStore((s) =>
    agentId ? s.sessionsByAgent[agentId] || NO_SESSIONS : NO_SESSIONS,
  );
  const streamingSessions = useChatStore((s) => s.streamingSessions);
  const inboxItems = useInboxStore((s) => s.items);
  const awaitingSessionIds = useMemo(
    () => new Set(inboxItems.map((i) => i.session_id)),
    [inboxItems],
  );

  const items = useMemo<SessionRow[]>(() => {
    return sessions
      .filter((s) => s.session_type !== "task")
      .map((s) => {
        // Origin = where the session came from. Only render when
        // it's something meaningful (real transport / event hook /
        // sub-agent chain). Sessions started by typing into the
        // composer leave this empty — the session label IS the row.
        // "interactive" and "perpetual" are internal catchalls and
        // tell the user nothing, so they're omitted.
        const origin = deriveOrigin(s);
        const tsRaw = s.last_active || s.created_at;
        const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
        return {
          id: s.id,
          primary: sessionLabel(s),
          secondary: origin,
          // Wrap only when there's a secondary line to balance —
          // otherwise the row stays single-line and tight.
          wrapPrimary: !!origin,
          time: timeShort(tsRaw ?? null),
          status: s.status,
          awaiting: awaitingSessionIds.has(s.id),
          group: recencyBucket(tsRaw ?? null),
          sortKey: ts,
        };
      })
      .sort((a, b) => b.sortKey - a.sortKey);
  }, [sessions, awaitingSessionIds]);

  const handleSelect = useCallback(
    (id: string) => {
      if (!agentId) return;
      goAgent(agentId, "sessions", id, { replace: true });
    },
    [agentId, goAgent],
  );

  return (
    <RailShell
      items={items}
      selectedId={itemId ?? null}
      onSelect={handleSelect}
      streamingSessions={streamingSessions}
      emptyTitle="no sessions yet"
      emptyHint="type below to start one"
    />
  );
}

function InboxRail({ selectedSessionId }: { selectedSessionId: string | null }) {
  const navigate = useNavigate();
  const rawItems = useInboxStore((s) => s.items);
  const pendingDismissal = useInboxStore((s) => s.pendingDismissal);
  const fetchInbox = useInboxStore((s) => s.fetchInbox);
  const wsConnected = useDaemonStore((s) => s.wsConnected);
  const streamingSessions = useChatStore((s) => s.streamingSessions);

  // Hydrate the inbox so deep links (e.g. directly opening
  // `/sessions/:id`) get a populated rail. Resync on WS reconnect for
  // any updates dropped while disconnected.
  useEffect(() => {
    void fetchInbox();
  }, [fetchInbox, wsConnected]);

  const items = useMemo<SessionRow[]>(() => {
    const visible = rawItems.filter((i) => !pendingDismissal.has(i.session_id));
    return visible
      .map((it) => {
        const ts = it.awaiting_at ? new Date(it.awaiting_at).getTime() : 0;
        const agentLabel = it.agent_name ?? "agent";
        const showRoot =
          it.root_agent_id != null && it.agent_id != null && it.root_agent_id !== it.agent_id;
        // Subject is the line the user reads to triage. Fall back to
        // the session name only if the join is missing (defensive —
        // backend always populates subject on awaiting rows).
        const subject = it.awaiting_subject || it.session_name || "(no subject)";
        const secondary = showRoot ? `${agentLabel} · ${it.root_agent_id}` : agentLabel;
        return {
          id: it.session_id,
          primary: subject,
          secondary,
          wrapPrimary: true,
          time: timeShort(it.awaiting_at ?? null),
          status: "awaiting",
          awaiting: true,
          group: recencyBucket(it.awaiting_at ?? null),
          sortKey: ts,
        };
      })
      .sort((a, b) => b.sortKey - a.sortKey);
  }, [rawItems, pendingDismissal]);

  const handleSelect = useCallback(
    (id: string) => {
      navigate(`/sessions/${encodeURIComponent(id)}`, { replace: true });
    },
    [navigate],
  );

  return (
    <RailShell
      items={items}
      selectedId={selectedSessionId}
      onSelect={handleSelect}
      streamingSessions={streamingSessions}
      emptyTitle="all caught up"
      emptyHint="agents will surface things here when they need you"
    />
  );
}

function RailShell({
  items,
  selectedId,
  onSelect,
  streamingSessions,
  emptyTitle,
  emptyHint,
}: {
  items: SessionRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  streamingSessions: Record<string, boolean>;
  emptyTitle: string;
  emptyHint: string;
}) {
  return (
    <div className="sessions-rail">
      <div className="sessions-rail-list">
        {items.length === 0 && (
          <div className="sessions-rail-empty">
            <div className="sessions-rail-empty-title">{emptyTitle}</div>
            <div className="sessions-rail-empty-hint">{emptyHint}</div>
          </div>
        )}
        {items.map((item, i) => {
          const showHeader = i === 0 || items[i - 1]?.group !== item.group;
          return (
            <div key={item.id}>
              {showHeader && (
                <div className="sessions-rail-group">
                  <span className="sessions-rail-group-label">{item.group}</span>
                  <span className="sessions-rail-group-rule" />
                </div>
              )}
              <RailRow
                item={item}
                isActive={item.id === selectedId}
                isStreaming={!!streamingSessions[item.id]}
                onSelect={onSelect}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Memoed row. Re-renders only when its own item / active / streaming
 * state changes — not when a sibling's WS update churns the parent's
 * `streamingSessions` record. With ~50 awaiting items in the inbox or
 * dozens of sessions in an active agent rail, this is the difference
 * between rendering one row on a stream tick and rendering all of them.
 *
 * `item` already arrives with stable identity via the parent's
 * `useMemo`; `onSelect` is wrapped in `useCallback` upstream. Both
 * invariants are required for the memo equality check to pay off.
 */
const RailRow = memo(function RailRow({
  item,
  isActive,
  isStreaming,
  onSelect,
}: {
  item: SessionRow;
  isActive: boolean;
  isStreaming: boolean;
  onSelect: (id: string) => void;
}) {
  const handleClick = useCallback(() => onSelect(item.id), [onSelect, item.id]);
  const isMulti = !!item.wrapPrimary || !!item.secondary;
  return (
    <button
      type="button"
      className={`sessions-rail-row${isMulti ? " sessions-rail-row--multi" : ""}${
        isActive ? " active" : ""
      }`}
      data-status={item.status}
      aria-current={isActive ? "true" : undefined}
      onClick={handleClick}
    >
      {isStreaming ? (
        <ThinkingDot size="md" className="sessions-rail-row-thinking" />
      ) : (
        <span
          className={`sessions-rail-row-status${
            item.status === "active" ? "" : " sessions-rail-row-status--idle"
          }`}
        />
      )}
      <span className="sessions-rail-row-body">
        <span className="sessions-rail-row-primary-line">
          <span
            className={`sessions-rail-row-primary${
              item.wrapPrimary ? " sessions-rail-row-primary--wrap" : ""
            }`}
          >
            {item.primary}
          </span>
          {item.awaiting && (
            <span className="sessions-rail-awaiting-dot" aria-label="awaiting your reply" />
          )}
        </span>
        {item.secondary && <span className="sessions-rail-row-secondary">{item.secondary}</span>}
      </span>
      <span className="sessions-rail-row-time">{item.time}</span>
    </button>
  );
});
