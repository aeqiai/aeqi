import { Button, Tooltip } from "../ui";
import IdeasFilterPopover from "./IdeasFilterPopover";
import IdeasSortPopover from "./IdeasSortPopover";
import IdeasViewPopover, { type IdeasView } from "./IdeasViewPopover";
import type { FilterState, IdeasFilter } from "./types";

/**
 * Shared toolbar for non-list Ideas views (Table, Kanban). Mirrors the
 * canonical search · sort · filter · view · +New row used by IdeasListView
 * so users land in any view with the same controls. List view keeps its
 * inline toolbar — it has list-specific keyboard bindings (Enter-to-create,
 * ArrowDown-to-rows) that don't belong here.
 */
export interface IdeasToolbarProps {
  filter: FilterState;
  scopeCounts: Record<IdeasFilter, number>;
  needsReviewCount: number;
  onFilter: (patch: Partial<FilterState>) => void;
  view: IdeasView;
  onViewChange: (next: IdeasView) => void;
  onNew: () => void;
}

export default function IdeasToolbar({
  filter,
  scopeCounts,
  needsReviewCount,
  onFilter,
  view,
  onViewChange,
  onNew,
}: IdeasToolbarProps) {
  const searchActive = filter.search.trim() !== "";
  return (
    <div className="ideas-list-head">
      <div className="ideas-toolbar">
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
            className="ideas-list-search"
            type="text"
            placeholder="Search ideas"
            value={filter.search}
            onChange={(e) => onFilter({ search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (filter.search) {
                  onFilter({ search: "" });
                } else {
                  (e.target as HTMLInputElement).blur();
                }
              }
            }}
          />
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
        <IdeasSortPopover
          sort={filter.sort}
          disabled={searchActive}
          onChange={(next) => onFilter({ sort: next })}
        />
        <IdeasFilterPopover
          filter={filter}
          scopeCounts={scopeCounts}
          needsReviewCount={needsReviewCount}
          onChange={onFilter}
        />
        <IdeasViewPopover view={view} onChange={onViewChange} />
        <Tooltip content="New idea (N)">
          <Button
            variant="primary"
            size="sm"
            onClick={onNew}
            leadingIcon={
              <svg
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M6.5 2.5v8M2.5 6.5h8" />
              </svg>
            }
          >
            New
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}
