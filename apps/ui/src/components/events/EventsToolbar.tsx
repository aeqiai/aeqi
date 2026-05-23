import { useEffect, useRef, type ReactNode } from "react";
import EventsFilterPopover, {
  type EventsFilterPopoverProps,
  type EventsFilterState,
} from "./EventsFilterPopover";
import { PrimitiveSearchField } from "../ui";

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
  inline?: boolean;
}

export default function EventsToolbar({
  filter,
  onFilter,
  scopeCounts,
  groupCounts,
  onNew,
  lead,
  rightExtra,
  inline = false,
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

  const toolbar = (
    <div className={`ideas-toolbar${inline ? " ideas-toolbar--inline" : ""}`}>
      {lead}
      <PrimitiveSearchField
        inputRef={searchRef}
        placeholder="Search events"
        value={filter.search}
        onChange={(next) => onFilter({ search: next })}
        showKbdHint
        onEscapeEmpty={(event) => event.currentTarget.blur()}
      />
      <EventsFilterPopover
        filter={filter}
        scopeCounts={scopeCounts}
        groupCounts={groupCounts}
        onChange={onFilter}
      />
      {rightExtra}
    </div>
  );
  if (inline) return toolbar;
  return <div className="ideas-list-head">{toolbar}</div>;
}
