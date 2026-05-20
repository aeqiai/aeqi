import { useEffect, useRef, type ReactNode } from "react";
import EventsFilterPopover, {
  type EventsFilterPopoverProps,
  type EventsFilterState,
} from "./EventsFilterPopover";

export interface EventsToolbarProps {
  filter: EventsFilterState;
  onFilter: (patch: Partial<EventsFilterState>) => void;
  scopeCounts: EventsFilterPopoverProps["scopeCounts"];
  groupCounts: EventsFilterPopoverProps["groupCounts"];
  /** Bound to the `/` keyboard hint. The list-header owns the visible
   *  "+ New" button — the toolbar only listens for the `n` hotkey so
   *  power users can compose without lifting hands from the home row. */
  onNew: () => void;
  /** Optional left-side content (e.g. back link). Rendered before search. */
  lead?: ReactNode;
  /** Optional right-side content slotted after the filter popover. */
  rightExtra?: ReactNode;
}

export default function EventsToolbar({
  filter,
  onFilter,
  scopeCounts,
  groupCounts,
  onNew,
  lead,
  rightExtra,
}: EventsToolbarProps) {
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      const inInput =
        tgt?.tagName === "INPUT" || tgt?.tagName === "TEXTAREA" || tgt?.isContentEditable;
      if (inInput) return;
      if (e.key === "/") {
        e.preventDefault();
        e.stopImmediatePropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (e.key === "n") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onNew();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, [onNew]);

  return (
    <div className="ideas-list-head">
      <div className="ideas-toolbar">
        {lead}
        <span className="ideas-list-search-field">
          <svg
            className="ideas-list-search-glyph"
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
            ref={searchRef}
            className="ideas-list-search"
            type="text"
            placeholder="Search events"
            value={filter.search}
            onChange={(e) => onFilter({ search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (filter.search) onFilter({ search: "" });
                else (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {!filter.search && (
            <kbd className="ideas-list-search-kbd" aria-hidden>
              /
            </kbd>
          )}
          {filter.search && (
            <button
              type="button"
              className="ideas-list-search-clear"
              onClick={() => onFilter({ search: "" })}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </span>
        <EventsFilterPopover
          filter={filter}
          scopeCounts={scopeCounts}
          groupCounts={groupCounts}
          onChange={onFilter}
        />
        {rightExtra}
      </div>
    </div>
  );
}
