import { memo, useCallback, useEffect, useRef } from "react";
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
  /** Visual density: compact for persistent agent rails, comfortable for Inbox/Home cards. */
  density?: "compact" | "comfortable";
  /** Surface treatment: plain legacy rail, or card rows on a recessed lane. */
  surface?: "plain" | "card";
  /** Sessions that are currently streaming — drive the ThinkingDot. */
  streamingIds?: Record<string, boolean>;
  /** Empty-state title (e.g. "no sessions yet" / "inbox is clear"). */
  emptyTitle: string;
  /** Empty-state hint underneath. */
  emptyHint?: string;
  /** Optional class for surface-specific empty-state tuning. */
  emptyStateClassName?: string;
  /** Listen on `window` for `<eventName>` `CustomEvent<{direction}>` to drive
   * j/k traversal from a parent keyboard handler. Inbox owns its own keyboard
   * handler today; agent-rail uses URL navigation, no keyboard handler. */
  traversalEventName?: string;
}

export interface SessionRailEmptyStateProps {
  title: string;
  hint?: string;
  /** Panel fills cards such as Home; rail stays quieter inside a list column. */
  variant?: "rail" | "panel";
  signal?: "idle" | "progress" | "review";
  className?: string;
}

export function SessionRailEmptyState({
  title,
  hint,
  variant = "rail",
  signal = "idle",
  className,
}: SessionRailEmptyStateProps) {
  return (
    <div
      className={["sessions-rail-empty", `sessions-rail-empty--${variant}`, className ?? ""]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className={`sessions-rail-empty-mark sessions-rail-empty-mark--${signal}`}
        aria-hidden="true"
      />
      <span className="sessions-rail-empty-copy">
        <span className="sessions-rail-empty-title">{title}</span>
        {hint && <span className="sessions-rail-empty-hint">{hint}</span>}
      </span>
    </div>
  );
}

/**
 * Universal session rail — the left-adjacent index column for every
 * conversation surface (agent sessions, inbox, channels). Owns row
 * grouping + memoization + j/k traversal bridge; reads data via props
 * so the surface picks its transport (chat-store WS, inbox-store
 * polling, react-query, etc).
 *
 * Search / sort / filter live ABOVE the rail in `<SessionsToolbar>`,
 * which both shipping adopters mount as the canonical chrome. The rail
 * itself renders whatever rows the parent passes — no internal filtering.
 *
 * Adopters today:
 *  - shell/SessionsRail.tsx — agent surface, drives from useChatStore
 *  - pages/MeInboxPage.tsx — inbox, drives from useInboxStore
 */
export default function SessionRail({
  rows,
  selectedId,
  onSelect,
  density = "compact",
  surface = "plain",
  streamingIds,
  emptyTitle,
  emptyHint,
  emptyStateClassName,
  traversalEventName,
}: SessionRailProps) {
  const rowRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const railClassName = [
    "sessions-rail",
    `sessions-rail--${density}`,
    `sessions-rail--${surface}`,
  ].join(" ");

  // j/k traversal bridge — only listens when a parent registers an event
  // name. The parent's keyboard handler dispatches a CustomEvent and we
  // pick the next/previous row. The parent is responsible for filtering
  // rows before passing them in; traversal walks the rendered set.
  useEffect(() => {
    if (!traversalEventName) return;
    const handler = (e: Event) => {
      const { direction } = (e as CustomEvent).detail as { direction: "next" | "prev" };
      if (!rows.length) return;
      const currentIdx = selectedId ? rows.findIndex((r) => r.id === selectedId) : -1;
      let nextIdx: number;
      if (direction === "next") {
        nextIdx = currentIdx < rows.length - 1 ? currentIdx + 1 : currentIdx;
      } else {
        nextIdx = currentIdx > 0 ? currentIdx - 1 : 0;
      }
      const next = rows[nextIdx];
      if (next) {
        onSelect(next.id);
        rowRefs.current.get(next.id)?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener(traversalEventName, handler);
    return () => window.removeEventListener(traversalEventName, handler);
  }, [rows, selectedId, onSelect, traversalEventName]);

  // Empty state — parent passed zero rows. The "no matches" sub-state is
  // owned by the parent surface (which knows whether the empty stems
  // from a query or a genuine zero-row inbox) and passed in via
  // emptyTitle / emptyHint.
  if (rows.length === 0) {
    return (
      <div className={railClassName}>
        <div className="sessions-rail-list">
          <SessionRailEmptyState
            title={emptyTitle}
            hint={emptyHint}
            className={emptyStateClassName}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={railClassName}>
      <div className="sessions-rail-list">
        {rows.map((item, i) => {
          const showHeader = i === 0 || rows[i - 1]?.group !== item.group;
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
      <SessionRailRowContent item={item} isStreaming={isStreaming} />
    </button>
  );
});

export function SessionRailRowContent({
  item,
  isStreaming = false,
}: {
  item: SessionRailRow;
  isStreaming?: boolean;
}) {
  const statusClass = item.awaiting
    ? " sessions-rail-row-status--awaiting"
    : item.status === "active"
      ? " sessions-rail-row-status--active"
      : " sessions-rail-row-status--idle";

  return (
    <>
      {isStreaming ? (
        <ThinkingDot size="md" className="sessions-rail-row-thinking" />
      ) : (
        <span className={`sessions-rail-row-status${statusClass}`} aria-hidden="true" />
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
    </>
  );
}

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
