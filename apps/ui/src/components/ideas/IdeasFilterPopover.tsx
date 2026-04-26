import { useId, useState } from "react";
import { Popover } from "../ui/Popover";
import { type FilterState, type IdeasFilter, IDEA_FILTER_VALUES } from "./types";

export interface IdeasFilterPopoverProps {
  filter: FilterState;
  scopeCounts: Record<IdeasFilter, number>;
  needsReviewCount: number;
  onChange: (patch: Partial<FilterState>) => void;
}

// Active-filter count drives the trigger badge — anything beyond the resting
// state ("all", no review toggle, no tag) earns a visible chip on the icon.
// `tag` and `search` are NOT counted here because they live in their own
// chips below the search row; the popover badge represents only what *this*
// surface owns.
function activeFilterCount(filter: FilterState): number {
  let n = 0;
  if (filter.scope !== "all") n += 1;
  if (filter.needsReview) n += 1;
  return n;
}

export default function IdeasFilterPopover({
  filter,
  scopeCounts,
  needsReviewCount,
  onChange,
}: IdeasFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const active = activeFilterCount(filter);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={`ideas-toolbar-btn${active > 0 ? " active" : ""}${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          title={active > 0 ? `Filter — ${active} active` : "Filter"}
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
          {active > 0 && <span className="ideas-toolbar-btn-dot" aria-hidden />}
        </button>
      }
    >
      <div id={popoverId} className="ideas-filter-popover" role="dialog" aria-label="Filter ideas">
        <section className="ideas-filter-popover-section">
          <header className="ideas-filter-popover-head">
            <span className="ideas-filter-popover-label">scope</span>
            {filter.scope !== "all" && (
              <button
                type="button"
                className="ideas-filter-popover-reset"
                onClick={() => onChange({ scope: "all" })}
              >
                reset
              </button>
            )}
          </header>
          <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Scope">
            {IDEA_FILTER_VALUES.map((s) => {
              const count = scopeCounts[s] ?? 0;
              const isActive = filter.scope === s;
              const isEmpty = count === 0 && s !== "all";
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className={`ideas-filter-row${isActive ? " active" : ""}${isEmpty ? " empty" : ""}`}
                  onClick={() => {
                    onChange({ scope: s });
                    setOpen(false);
                  }}
                >
                  <span className="ideas-filter-row-mark" aria-hidden>
                    {isActive && (
                      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                        <path
                          d="M2 5.2 L4.2 7.4 L8 3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="ideas-filter-row-label">{s}</span>
                  <span className="ideas-filter-row-count">{count}</span>
                </button>
              );
            })}
          </div>
        </section>
        <hr className="ideas-filter-popover-rule" />
        <section className="ideas-filter-popover-section">
          <header className="ideas-filter-popover-head">
            <span className="ideas-filter-popover-label">special</span>
          </header>
          <button
            type="button"
            role="switch"
            aria-checked={filter.needsReview}
            disabled={needsReviewCount === 0 && !filter.needsReview}
            className={`ideas-filter-row toggle${filter.needsReview ? " active" : ""}${
              needsReviewCount === 0 && !filter.needsReview ? " empty" : ""
            }`}
            onClick={() => onChange({ needsReview: !filter.needsReview })}
          >
            <span className="ideas-filter-row-mark" aria-hidden>
              <span className={`ideas-filter-row-switch${filter.needsReview ? " on" : ""}`}>
                <span className="ideas-filter-row-switch-knob" />
              </span>
            </span>
            <span className="ideas-filter-row-label">needs review</span>
            <span className="ideas-filter-row-count">{needsReviewCount}</span>
          </button>
        </section>
      </div>
    </Popover>
  );
}
