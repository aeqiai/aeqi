import type { ReactNode } from "react";
import { PrimitiveSearchField } from "@/components/ui";

export interface SessionsToolbarProps {
  /** Current search query — controlled by the parent surface. */
  query: string;
  /** Search input change handler. */
  onQuery: (q: string) => void;
  /** Placeholder + aria-label for the search input. */
  searchPlaceholder?: string;
  /** Sort control — typically a `<Popover>`-based glyph button. Slot-based so
   *  each surface owns its own sort dimensions without forcing this primitive
   *  to know the domain. */
  sort?: ReactNode;
  /** Filter control — typically a `<Popover>` with active-count dot. Slot-based
   *  same as `sort`; each surface passes its domain filters or omits entirely. */
  filter?: ReactNode;
  /** Forwarded to the search input so a parent keyboard handler can target it directly. */
  searchRef?: React.RefObject<HTMLInputElement | null>;
  inline?: boolean;
}

/**
 * Canonical toolbar for every conversation surface that mounts a
 * `<SessionRail>`: search + sort + filter, in the chrome zone above the
 * row list. Search is mandatory; sort and filter are slot-based so the
 * domain semantics live with the surface, not in this primitive.
 *
 * Adopters render search + sort + filter for parity while owning their
 * status/view semantics locally.
 */
export default function SessionsToolbar({
  query,
  onQuery,
  searchPlaceholder = "Search",
  sort,
  filter,
  searchRef,
  inline = false,
}: SessionsToolbarProps) {
  const toolbar = (
    <div className={`ideas-toolbar${inline ? " ideas-toolbar--inline" : ""}`}>
      <PrimitiveSearchField
        inputRef={searchRef}
        placeholder={searchPlaceholder}
        value={query}
        onChange={onQuery}
        showKbdHint
        onEscapeEmpty={(event) => event.currentTarget.blur()}
      />

      {/* Sort + Filter slots — each surface composes its own popovers */}
      {sort}
      {filter}
    </div>
  );
  if (inline) return toolbar;
  return <div className="ideas-list-head inbox-head">{toolbar}</div>;
}
