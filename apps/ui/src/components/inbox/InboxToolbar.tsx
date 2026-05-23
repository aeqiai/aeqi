import SessionsToolbar from "@/components/sessions/SessionsToolbar";
import InboxFilterPopover from "./InboxFilterPopover";
import InboxSortPopover from "./InboxSortPopover";
import type { InboxFilterState, InboxSort } from "./types";

export interface InboxToolbarProps {
  search: string;
  filter: InboxFilterState;
  sort: InboxSort;
  entityOptions: { id: string; name: string }[];
  onSearch: (q: string) => void;
  onFilter: (patch: Partial<InboxFilterState>) => void;
  onSort: (s: InboxSort) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
  inline?: boolean;
}

/**
 * Inbox toolbar — search + sort (recent / unread first) + filter
 * (kind, entity, unread-only) above the inbox `<SessionRail>`. Thin
 * wrapper around `<SessionsToolbar>` that supplies the inbox-domain
 * sort + filter popovers as slots; the visual chrome (search field,
 * row, layout) is owned by the shared primitive so the agent surface
 * renders the same shell.
 */
export default function InboxToolbar({
  search,
  filter,
  sort,
  entityOptions,
  onSearch,
  onFilter,
  onSort,
  searchRef,
  inline = false,
}: InboxToolbarProps) {
  return (
    <SessionsToolbar
      inline={inline}
      query={search}
      onQuery={onSearch}
      searchPlaceholder="Search inbox"
      searchRef={searchRef}
      sort={<InboxSortPopover sort={sort} onChange={onSort} />}
      filter={
        <InboxFilterPopover filter={filter} entityOptions={entityOptions} onChange={onFilter} />
      }
    />
  );
}
