import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThinkingDot } from "@/components/ui";
import { recencyBucket, type RecencyBucket } from "@/lib/format";

/**
 * Canonical row shape every Session-rail surface adapts its data into.
 * Data fetch / store / query stays surface-local; the rail is pure
 * presentation. This is the contract that lets agent-sessions, inbox,
 * and (future) channels share one rail primitive.
 */
export interface SessionRailRow {
  /** Stable selection identifier — the session ID in every adopting surface. */
  id: string;
  /** Bold body line — what the user reads. */
  primary: string;
  /** Optional whisper-meta line under the primary. Inbox uses "agent · root";
   * agent mode uses the session origin (telegram / whatsapp / web). */
  secondary?: string;
  /** When true, primary wraps to up to 2 lines. Single-line ellipsis when false. */
  wrapPrimary?: boolean;
  /** Right-pinned tabular timestamp (e.g. "5m" / "2d" / "May 4"). */
  time: string;
  /** Drives the data-status hook for variant styling (active vs idle). */
  status?: string;
  /** When true, paint the awaiting dot — urgency cue (decision required, etc). */
  awaiting?: boolean;
  /** Time bucket for group separators ("today" / "yesterday" / etc). */
  group: RecencyBucket;
  /** Sort key — descending = newest first. */
  sortKey: number;
  /** When true, pulse-in animation on next render (for real-time arrival
   *  feedback in adopters that track newly-arrived rows). */
  pulseNew?: boolean;
}

export interface SessionRailProps {
  rows: SessionRailRow[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Sessions that are currently streaming — drive the ThinkingDot. */
  streamingIds?: Record<string, boolean>;
  /** Empty-state title (e.g. "no sessions yet" / "inbox is clear"). */
  emptyTitle: string;
  /** Empty-state hint underneath. */
  emptyHint?: string;
  /** Listen on `window` for `<eventName>` `CustomEvent<{direction}>` to drive
   * j/k traversal from a parent keyboard handler. Inbox owns its own keyboard
   * handler today; agent-rail uses URL navigation, no keyboard handler. */
  traversalEventName?: string;
  /** Opt out of the built-in search input. Default is on — every adopter gets
   * search by virtue of mounting the primitive. */
  enableSearch?: boolean;
}

/**
 * Universal session rail — the left-adjacent index column for every
 * conversation surface (agent sessions, inbox, channels). Owns its own
 * recencyBucket grouping + memoization + j/k traversal bridge; reads
 * data via props so the surface picks its transport (chat-store WS,
 * inbox-store polling, react-query, etc).
 *
 * Adopters today:
 *  - shell/SessionsRail.tsx — agent surface, drives from useChatStore
 *  - pages/MeInboxPage.tsx — inbox, drives from useInboxStore
 *
 * Channels surface (ChannelsListPage + ChannelDetailPage) is a different
 * row shape (last_message_preview + member count) and does not adopt
 * this rail today.
 */
export default function SessionRail({
  rows,
  selectedId,
  onSelect,
  streamingIds,
  emptyTitle,
  emptyHint,
  traversalEventName,
  enableSearch = true,
}: SessionRailProps) {
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [query, setQuery] = useState("");

  // Case-insensitive substring match against primary (and secondary if
  // present). Filter applies to whatever rows array the parent passes in
  // — pure client-side, no server query.
  const filteredRows = useMemo(() => {
    if (!enableSearch) return rows;
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      if (r.primary.toLowerCase().includes(q)) return true;
      if (r.secondary && r.secondary.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [rows, query, enableSearch]);

  // j/k traversal bridge — only listens when a parent registers an event
  // name. The parent's keyboard handler dispatches a CustomEvent and we
  // pick the next/previous row. Traversal walks the *filtered* set so
  // typing a query narrows j/k to the matches.
  useEffect(() => {
    if (!traversalEventName) return;
    const handler = (e: Event) => {
      const { direction } = (e as CustomEvent).detail as { direction: "next" | "prev" };
      if (!filteredRows.length) return;
      const currentIdx = selectedId ? filteredRows.findIndex((r) => r.id === selectedId) : -1;
      let nextIdx: number;
      if (direction === "next") {
        nextIdx = currentIdx < filteredRows.length - 1 ? currentIdx + 1 : currentIdx;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : 0;
      }
      const next = filteredRows[nextIdx];
      if (next) {
        onSelect(next.id);
        rowRefs.current.get(next.id)?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener(traversalEventName, handler);
    return () => window.removeEventListener(traversalEventName, handler);
  }, [filteredRows, selectedId, onSelect, traversalEventName]);

  const searchHeader = enableSearch ? (
    <div className="sessions-rail-search-row">
      <span className="sessions-rail-search-field">
        <svg
          className="sessions-rail-search-glyph"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          aria-hidden
        >
          <circle cx="5.2" cy="5.2" r="3.2" />
          <path d="M7.6 7.6 L10 10" />
        </svg>
        <input
          className="sessions-rail-search"
          type="text"
          placeholder="Search sessions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (query) {
                setQuery("");
              } else {
                (e.target as HTMLInputElement).blur();
              }
            }
          }}
          aria-label="Search sessions"
        />
        {query && (
          <button
            type="button"
            className="sessions-rail-search-clear"
            onClick={() => setQuery("")}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
      </span>
    </div>
  ) : null;

  // Empty state branches:
  //  (a) parent passed zero rows → show parent-supplied empty copy.
  //  (b) parent passed rows but the active query has zero matches →
  //      show "no matches" copy specific to filtering.
  if (rows.length === 0) {
    return (
      <div className="sessions-rail">
        {searchHeader}
        <div className="sessions-rail-list">
          <div className="sessions-rail-empty">
            <div className="sessions-rail-empty-title">{emptyTitle}</div>
            {emptyHint && <div className="sessions-rail-empty-hint">{emptyHint}</div>}
          </div>
        </div>
      </div>
    );
  }

  if (filteredRows.length === 0) {
    return (
      <div className="sessions-rail">
        {searchHeader}
        <div className="sessions-rail-list">
          <div className="sessions-rail-empty">
            <div className="sessions-rail-empty-title">no matches</div>
            <div className="sessions-rail-empty-hint">try a different search term.</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sessions-rail">
      {searchHeader}
      <div className="sessions-rail-list">
        {filteredRows.map((item, i) => {
          const showHeader = i === 0 || filteredRows[i - 1]?.group !== item.group;
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
                isStreaming={!!streamingIds?.[item.id]}
                onSelect={onSelect}
                refSetter={(el) => {
                  if (el) rowRefs.current.set(item.id, el);
                  else rowRefs.current.delete(item.id);
                }}
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
 * `streamingIds` record. With ~50 awaiting items in the inbox or
 * dozens of sessions in an active agent rail, this is the difference
 * between rendering one row on a stream tick and rendering all of them.
 */
const RailRow = memo(function RailRow({
  item,
  isActive,
  isStreaming,
  onSelect,
  refSetter,
}: {
  item: SessionRailRow;
  isActive: boolean;
  isStreaming: boolean;
  onSelect: (id: string) => void;
  refSetter: (el: HTMLButtonElement | null) => void;
}) {
  const handleClick = useCallback(() => onSelect(item.id), [onSelect, item.id]);
  const isMulti = !!item.wrapPrimary || !!item.secondary;
  return (
    <button
      ref={refSetter}
      type="button"
      className={[
        "sessions-rail-row",
        isMulti ? "sessions-rail-row--multi" : "",
        isActive ? "active" : "",
        item.pulseNew ? "is-new" : "",
      ]
        .filter(Boolean)
        .join(" ")}
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

/**
 * Helper: build a SessionRailRow from a basic ISO timestamp + label set.
 * Adopters typically have richer source data (session_type / awaiting_at /
 * status / origin) and should construct the row inline; this helper covers
 * the common case where only the basics are in scope.
 */
export function makeRailRow(args: {
  id: string;
  primary: string;
  secondary?: string;
  wrapPrimary?: boolean;
  time: string;
  status?: string;
  awaiting?: boolean;
  isoTimestamp: string | null;
}): SessionRailRow {
  return {
    id: args.id,
    primary: args.primary,
    secondary: args.secondary,
    wrapPrimary: args.wrapPrimary,
    time: args.time,
    status: args.status,
    awaiting: args.awaiting,
    group: recencyBucket(args.isoTimestamp),
    sortKey: args.isoTimestamp ? Date.parse(args.isoTimestamp) : 0,
  };
}

// Re-export the row-grouping helper so adopters can build rows without
// importing from format directly.
export type { RecencyBucket };
