import type React from "react";
import { PrimitiveSearchField } from "../ui";
import IdeasFilterPopover from "./IdeasFilterPopover";
import IdeasSortPopover from "./IdeasSortPopover";
import IdeasViewPopover, { type IdeasView } from "./IdeasViewPopover";
import type { FilterState, IdeasFilter } from "./types";

/**
 * Canonical toolbar for every Ideas view (List, Table, Kanban, Graph).
 *
 * Required surface is the locked search · sort · filter · view row. The
 * primary "New idea" CTA lives in the page header above the toolbar
 * (mirrors Quests / Events), so the toolbar stays focused on
 * find / narrow / switch-view affordances. The `n` keyboard hotkey is
 * owned by each view's own window listener.
 * View-specific extensions land via optional slots:
 *
 * - `searchInputRef` + `onSearchKeyDown` — list-style keyboard navigation
 *   (Enter-to-create, ArrowDown-to-rows) without coupling the toolbar to a
 *   particular view's handlers. Escape-to-clear is universal and handled
 *   internally before delegating.
 * - `showKbdHint` — render the "/" focus-hint kbd (list-only today).
 * - `toolbarMeta` — inline meta slot between search and sort (graph uses it
 *   for the "N nodes · M links" pill).
 * - `importMenu` — extra primary-row affordance for the list view's
 *   markdown / blueprint import surface.
 *
 * Replaces the prior `IdeasListToolbar` + `IdeasToolbar` + inline graph
 * shell trio so every view stays in lockstep on chrome + design tokens.
 */
export interface IdeasToolbarProps {
  filter: FilterState;
  scopeCounts: Record<IdeasFilter, number>;
  needsReviewCount: number;
  onFilter: (patch: Partial<FilterState>) => void;
  view: IdeasView;
  onViewChange: (next: IdeasView) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  onSearchKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  showKbdHint?: boolean;
  toolbarMeta?: React.ReactNode;
  importMenu?: React.ReactNode;
}

export default function IdeasToolbar({
  filter,
  scopeCounts,
  needsReviewCount,
  onFilter,
  view,
  onViewChange,
  searchInputRef,
  onSearchKeyDown,
  showKbdHint = false,
  toolbarMeta,
  importMenu,
}: IdeasToolbarProps) {
  const searchActive = filter.search.trim() !== "";
  return (
    <div className="ideas-list-head">
      <div className="ideas-toolbar">
        <PrimitiveSearchField
          inputRef={searchInputRef}
          placeholder="Search ideas"
          value={filter.search}
          onChange={(next) => onFilter({ search: next })}
          showKbdHint={showKbdHint}
          onKeyDown={onSearchKeyDown}
        />
        {toolbarMeta}
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
        {importMenu}
      </div>
    </div>
  );
}
