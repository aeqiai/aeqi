import type { ReactNode } from "react";
import { PrimitiveSearchField } from "@/components/ui";

export interface SessionsToolbarProps {
  /** Current search query — controlled by the parent surface. */
  query: string;
  /** Search input change handler. */
  onQuery: (q: string) => void;
  /** Placeholder + aria-label for the search input. Inbox uses "Search inbox";
   *  agent surface uses "Search sessions". */
  searchPlaceholder?: string;
  /** Sort control — typically a `<Popover>`-based glyph button. Slot-based so
   *  each surface owns its own sort dimensions (inbox: recent / unread; agent:
   *  recent only) without forcing this primitive to know the domain. */
  sort?: ReactNode;
  /** Filter control — typically a `<Popover>` with active-count dot. Slot-based
   *  same as `sort`; inbox passes kind+entity filters, agent surface passes
   *  status filters or omits entirely. */
  filter?: ReactNode;
  /** Forwarded to the search input so a parent keyboard handler (e.g. inbox's
   *  `/`-to-focus shortcut) can target it directly. */
  searchRef?: React.RefObject<HTMLInputElement | null>;
  inline?: boolean;
}

/**
 * Canonical toolbar for every conversation surface that mounts a
 * `<SessionRail>`: search + sort + filter, in the chrome zone above the
 * row list. Search is mandatory; sort and filter are slot-based so the
 * domain semantics (inbox kind/entity vs agent status, etc.) live with
 * the surface, not in this primitive.
 *
 * Adopters today (both render search + sort + filter for parity):
 *  - components/inbox/InboxToolbar.tsx — wraps this with inbox kind +
 *    entity popovers.
 *  - components/shell/SessionsRail.tsx — wraps this with sessions sort
 *    + status popovers on the drilled-agent surface.
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
