import { useId, useState } from "react";
import { Popover } from "@/components/ui";
import type { BlueprintCategory } from "@/lib/types";
import { CATEGORY_LABELS, CATEGORY_ORDER } from "./constants";

export interface BlueprintsFilterPopoverProps {
  tagCounts: [string, number][];
  selected: string[];
  onChange: (next: string[]) => void;
  activeCategory: BlueprintCategory | null;
  onCategoryChange: (cat: BlueprintCategory | null) => void;
}

/**
 * Combined tag + category filter popover. Tags: multi-select OR. Category: single
 * select (clicking again deselects). Both persist in URL.
 */
export default function BlueprintsFilterPopover({
  tagCounts,
  selected,
  onChange,
  activeCategory,
  onCategoryChange,
}: BlueprintsFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const activeTagCount = selected.length;
  const hasFilters = tagCounts.length > 0 || true; // category filter always available

  const toggleTag = (tag: string) => {
    if (selected.includes(tag)) onChange(selected.filter((t) => t !== tag));
    else onChange([...selected, tag]);
  };

  const toggleCategory = (cat: BlueprintCategory) => {
    onCategoryChange(activeCategory === cat ? null : cat);
  };

  const totalActive = activeTagCount + (activeCategory ? 1 : 0);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => hasFilters && setOpen(o)}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={`ideas-toolbar-btn${totalActive > 0 ? " active" : ""}${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          aria-label={totalActive > 0 ? `Filter — ${totalActive} active` : "Filter"}
          title={totalActive > 0 ? `Filter — ${totalActive} active` : "Filter"}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M2 3.25h9M3.5 6.5h6M5 9.75h3" />
          </svg>
          {totalActive > 0 && <span className="ideas-toolbar-btn-dot" aria-hidden />}
        </button>
      }
    >
      <div
        id={popoverId}
        className="ideas-filter-popover"
        role="dialog"
        aria-label="Filter templates"
      >
        <section className="ideas-filter-popover-section">
          <header className="ideas-filter-popover-head">
            <span className="ideas-filter-popover-label">category</span>
            {activeCategory && (
              <button
                type="button"
                className="ideas-filter-popover-reset"
                onClick={() => onCategoryChange(null)}
              >
                reset
              </button>
            )}
          </header>
          <div className="ideas-filter-popover-list" role="group" aria-label="Filter by category">
            {CATEGORY_ORDER.map((cat) => {
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={isActive}
                  className={`ideas-filter-row${isActive ? " active" : ""}`}
                  onClick={() => toggleCategory(cat)}
                >
                  <span className="ideas-filter-row-label">{CATEGORY_LABELS[cat]}</span>
                </button>
              );
            })}
          </div>
        </section>

        {tagCounts.length > 0 && (
          <section className="ideas-filter-popover-section">
            <header className="ideas-filter-popover-head">
              <span className="ideas-filter-popover-label">tags</span>
              {activeTagCount > 0 && (
                <button
                  type="button"
                  className="ideas-filter-popover-reset"
                  onClick={() => onChange([])}
                >
                  reset
                </button>
              )}
            </header>
            <div className="ideas-list-tags" role="group" aria-label="Filter by tag">
              {tagCounts.map(([tag, count]) => {
                const isActive = selected.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={isActive}
                    className={`ideas-tag-chip${isActive ? " active" : ""}`}
                    onClick={() => toggleTag(tag)}
                  >
                    #{tag}
                    <span className="ideas-tag-chip-count">{count}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </Popover>
  );
}
