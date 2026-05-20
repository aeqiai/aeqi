import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useChatStore } from "@/store/chat";
import { useInboxStore } from "@/store/inbox";
import { sessionLabel, type SessionInfo } from "@/components/session/types";
import { recencyBucket, timeShort } from "@/lib/format";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";
import { useDaemonStore } from "@/store/daemon";
import SessionRail, { type SessionRailRow } from "@/components/sessions/SessionRail";
import SessionsToolbar from "@/components/sessions/SessionsToolbar";
import SessionsSortPopover, { type SessionsSort } from "@/components/sessions/SessionsSortPopover";
import SessionsFilterPopover, {
  type SessionsFilterState,
} from "@/components/sessions/SessionsFilterPopover";

const NO_SESSIONS: SessionInfo[] = [];

const DEFAULT_FILTER: SessionsFilterState = { status: "all" };

/**
 * Sessions rail — the left-adjacent index column for the drilled-agent
 * inbox. Renders the canonical `<SessionsToolbar>` (search + sort +
 * filter, slot-based) above the universal `<SessionRail>` primitive.
 * Adapts the chat-store sessions list into `SessionRailRow`s; awaiting
 * rows are flagged via the inbox store. The entity-scope inbox at
 * `/trust/<addr>/inbox` (MeInboxPage) mounts the same primitive pair
 * through `<InboxToolbar>` — both surfaces read as the same chrome shape.
 *
 * Sort: recent (default) / oldest first.
 * Filter: status — all / active / archived. Matches `s.status === "active"`.
 *
 * Row shape is single-line h=32 across both adopters — visual parity
 * with the inbox.
 */
export default function SessionsRail() {
  // Mounted under `/trust/<addr>/agents/<agent>/inbox[/...]`. The route
  // exposes `trustAddress` as the param; resolve it back to a trustId via
  // the daemon entities array so the URL builder can pick the canonical
  // base. Without this, clicks on the agent rail no-op'd on `/trust/...`
  // routes because `trustId` was undefined and the early return fired.
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

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SessionsSort>("recent");
  const [filter, setFilter] = useState<SessionsFilterState>(DEFAULT_FILTER);

  const patchFilter = useCallback((patch: Partial<SessionsFilterState>) => {
    setFilter((prev) => ({ ...prev, ...patch }));
  }, []);

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
    },
    [resolvedEntityId, agentId, entities, navigate],
  );

  // Empty-state copy distinguishes "no sessions yet" from "no matches"
  // so the surface speaks accurately in both shapes.
  const isFilteringEmpty = allRows.length > 0 && rows.length === 0;
  const emptyTitle = isFilteringEmpty ? "no matches" : "inbox is clear";
  const emptyHint = isFilteringEmpty ? "try a different search term." : "type below to start one";

  return (
    <>
      <SessionsToolbar
        query={query}
        onQuery={setQuery}
        searchPlaceholder="Search inbox"
        sort={<SessionsSortPopover sort={sort} onChange={setSort} />}
        filter={<SessionsFilterPopover filter={filter} onChange={patchFilter} />}
      />
      <SessionRail
        rows={rows}
        selectedId={itemId ?? null}
        onSelect={handleSelect}
        streamingIds={streamingSessions}
        emptyTitle={emptyTitle}
        emptyHint={emptyHint}
      />
    </>
  );
}
