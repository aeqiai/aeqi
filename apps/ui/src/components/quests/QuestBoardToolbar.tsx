import type { RefObject } from "react";
import { PrimitiveSearchField } from "../ui";
import type { Quest } from "@/lib/types";
import type { QuestsView } from "./questView";
import QuestsSortPopover, { type QuestSort } from "./QuestsSortPopover";
import QuestsFilterPopover from "./QuestsFilterPopover";
import QuestViewToggle from "./QuestViewToggle";
import type { QuestFilter } from "./agentQuestsHelpers";

export default function QuestBoardToolbar({
  searchInputRef,
  search,
  onSearchChange,
  showSearchCount,
  searchCountLabel,
  view,
  onViewChange,
  sort,
  onSortChange,
  agentId,
  quests,
  filter,
  onFilterChange,
}: {
  searchInputRef: RefObject<HTMLInputElement | null>;
  search: string;
  onSearchChange: (next: string) => void;
  showSearchCount: boolean;
  searchCountLabel: string;
  view: QuestsView;
  onViewChange: (next: QuestsView) => void;
  sort: QuestSort;
  onSortChange: (next: QuestSort) => void;
  agentId: string;
  quests: Quest[];
  filter: QuestFilter;
  onFilterChange: (next: QuestFilter) => void;
}) {
  return (
    <div className="ideas-toolbar trust-quests-toolbar">
      <PrimitiveSearchField
        inputRef={searchInputRef}
        placeholder="Search quests"
        value={search}
        onChange={onSearchChange}
        showKbdHint
      />
      {showSearchCount && (
        <span className="ideas-toolbar-meta quest-search-result-count" aria-live="polite">
          {searchCountLabel}
        </span>
      )}
      <QuestViewToggle view={view} onChange={onViewChange} />
      <QuestsSortPopover sort={sort} searchActive={showSearchCount} onChange={onSortChange} />
      <QuestsFilterPopover
        agentId={agentId}
        quests={quests}
        filter={filter}
        onChange={onFilterChange}
      />
    </div>
  );
}
