import type React from "react";
import { Button, Tooltip } from "../ui";
import { ImportMenu } from "@/components/blueprints/ImportMenu";
import IdeasFilterPopover from "./IdeasFilterPopover";
import IdeasSortPopover from "./IdeasSortPopover";
import IdeasViewPopover, { type IdeasView } from "./IdeasViewPopover";
import type { FilterState } from "./types";

export interface IdeasListToolbarProps {
  filter: FilterState;
  onFilter: (next: Partial<FilterState>) => void;
  view: IdeasView;
  onViewChange: (next: IdeasView) => void;
  searchActive: boolean;
  scopeCounts: Record<string, number>;
  needsReviewCount: number;
  entityId: string;
  filteredCount: number;
  rankedFirstId: string | null;
  noMatchTrimmed: string | null;
  searchRef: React.RefObject<HTMLInputElement | null>;
  rowRefs: React.RefObject<(HTMLAnchorElement | null)[]>;
  goEntity: (entityId: string, scope: string, id?: string) => void;
  fireNew: (preset?: string) => void;
  onMarkdownPicked: (files: FileList) => void;
  onBlueprintSpawned: () => void;
}

export default function IdeasListToolbar({
  filter,
  onFilter,
  view,
  onViewChange,
  searchActive,
  scopeCounts,
  needsReviewCount,
  entityId,
  filteredCount,
  rankedFirstId,
  noMatchTrimmed,
  searchRef,
  rowRefs,
  goEntity,
  fireNew,
  onMarkdownPicked,
  onBlueprintSpawned,
}: IdeasListToolbarProps) {
  return (
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
          ref={searchRef}
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
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (filteredCount > 0 && rankedFirstId) {
                goEntity(entityId, "ideas", rankedFirstId);
              } else if (noMatchTrimmed) {
                fireNew(noMatchTrimmed);
              }
            } else if (e.key === "ArrowDown" && filteredCount > 0) {
              e.preventDefault();
              rowRefs.current?.[0]?.focus();
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
      <ImportMenu
        entityId={entityId}
        parts={["ideas"]}
        blueprintTitle="Import ideas from a Blueprint"
        onMarkdownPicked={onMarkdownPicked}
        onBlueprintSpawned={onBlueprintSpawned}
      />
      <Tooltip content="New idea (N)">
        <Button
          variant="primary"
          size="sm"
          onClick={() => fireNew()}
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
  );
}
