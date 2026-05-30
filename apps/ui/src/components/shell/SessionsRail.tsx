import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useInboxStore } from "@/store/inbox";
import { gatewayLabel, sessionLabel, type SessionInfo } from "@/components/session/types";
import { recencyBucket, timeShort } from "@/lib/format";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { useDaemonStore } from "@/store/daemon";
import SessionRail, { type SessionRailRow } from "@/components/sessions/SessionRail";
import { useAgentInboxControls } from "./AgentInboxControls";

const NO_SESSIONS: SessionInfo[] = [];

interface SessionsRailProps {
  onSelectSession?: () => void;
}

function sessionStatusLabel(status: string | undefined): string {
  if (!status) return "Session";
  if (status === "running") return "Active";
  const label = status.replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function messageCountLabel(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return `${count} message${count === 1 ? "" : "s"}`;
}

function sessionSecondaryLabel(s: SessionInfo): string {
  return [gatewayLabel(s) ?? sessionStatusLabel(s.status), messageCountLabel(s.message_count)]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Sessions rail — the left-adjacent index column for the drilled-agent
 * sessions surface. Adapts the chat-store sessions list into `SessionRailRow`s;
 * awaiting rows are flagged via the inbox store. Search, sort, and
 * filter live in the shared AppLayout-level sessions header so the
 * controls govern the whole master/detail surface, not only the rail.
 *
 * Sort: recent (default) / oldest first.
 * Filter: status — all / active / archived. Matches `s.status === "active"`.
 *
 * Row shape is single-line h=32 across both adopters — visual parity
 * with the trust Sessions view through the compact card rail variant.
 */
export default function SessionsRail({ onSelectSession }: SessionsRailProps = {}) {
  // Legacy adapter for the retired drilled-agent session rail. Kept for
  // mobile/session primitives that still render it directly; clicks now
  // resolve to the trust-level Sessions URL.
  const { trustId, trustAddress, agentId, itemId } = useParams<{
    trustId?: string;
    trustAddress?: string;
    agentId?: string;
    itemId?: string;
  }>();

  const sessions = useChatStore((s) =>
    agentId ? s.sessionsByAgent[agentId] || NO_SESSIONS : NO_SESSIONS,
  );
  const streamingSessions = useChatStore((s) => s.streamingSessions);
  const inboxItems = useInboxStore((s) => s.items);
  const awaitingSessionIds = useMemo(
    () => new Set(inboxItems.map((i) => i.session_id)),
    [inboxItems],
  );
  const { query, sort, filter } = useAgentInboxControls();

  const allRows = useMemo<SessionRailRow[]>(() => {
    const mapped = sessions
      .filter((s) => s.session_type !== "task")
      .filter((s) => {
        if (filter.status === "all") return true;
        const isActive = s.status === "active" || s.status === "running";
        return filter.status === "active" ? isActive : !isActive;
      })
      .map((s) => {
        const tsRaw = s.last_active || s.created_at;
        const ts = tsRaw ? new Date(tsRaw).getTime() : 0;
        return {
          id: s.id,
          primary: sessionLabel(s),
          secondary: sessionSecondaryLabel(s),
          wrapPrimary: true,
          time: timeShort(tsRaw ?? null),
          status: s.status,
          awaiting: awaitingSessionIds.has(s.id),
          group: recencyBucket(tsRaw ?? null),
          sortKey: ts,
        };
      });
    return mapped.sort((a, b) =>
      sort === "recent" ? b.sortKey - a.sortKey : a.sortKey - b.sortKey,
    );
  }, [sessions, awaitingSessionIds, filter, sort]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) => r.primary.toLowerCase().includes(q));
  }, [allRows, query]);

  const navigate = useNavigate();
  const entities = useDaemonStore((s) => s.entities);
  // Resolve a concrete trustId from the /trust/<addr> lookup against the
  // daemon entities array. `sessionDeepUrlFromId` then re-derives the
  // canonical /trust/<addr> base for the session URL.
  const resolvedEntityId =
    trustId ||
    (trustAddress ? entities.find((e) => e.trust_address === trustAddress)?.id : undefined);
  const handleSelect = useCallback(
    (id: string) => {
      if (!resolvedEntityId || !agentId) return;
      navigate(sessionDeepUrlFromId(entities, resolvedEntityId, agentId, id), { replace: true });
      onSelectSession?.();
    },
    [resolvedEntityId, agentId, entities, navigate, onSelectSession],
  );

  // Empty-state copy distinguishes "no sessions yet" from "no matches"
  // so the surface speaks accurately in both shapes.
  const isFilteringEmpty = allRows.length > 0 && rows.length === 0;
  const emptyTitle = isFilteringEmpty ? "no matches" : "no sessions yet";
  const emptyHint = isFilteringEmpty ? "try a different search term." : "type below to start one";

  return (
    <SessionRail
      rows={rows}
      selectedId={itemId ?? null}
      onSelect={handleSelect}
      density="comfortable"
      surface="card"
      tone="recessed"
      streamingIds={streamingSessions}
      emptyTitle={emptyTitle}
      emptyHint={emptyHint}
    />
  );
}
