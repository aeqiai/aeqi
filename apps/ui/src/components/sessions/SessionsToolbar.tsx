import type { ReactNode } from "react";

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
}: SessionsToolbarProps) {
  return (
    <div className="ideas-list-head inbox-head">
      <div className="ideas-toolbar">
        {/* Search */}
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
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (query) {
                  onQuery("");
                } else {
                  (e.target as HTMLInputElement).blur();
                }
              }
            }}
          />
          {!query && (
            <kbd className="ideas-list-search-kbd" aria-hidden>
              /
            </kbd>
          )}
          {query && (
            <button
              type="button"
              className="ideas-list-search-clear"
              onClick={() => onQuery("")}
              aria-label="Clear search"
            >
              ×
            </button>
          )}
        </span>

        {/* Sort + Filter slots — each surface composes its own popovers */}
        {sort}
        {filter}
      </div>
    </div>
  );
}
