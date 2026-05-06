import { useId, useState } from "react";
import { Popover } from "../ui/Popover";
import {
  OCCUPANT_FILTER_LABEL,
  OCCUPANT_FILTER_VALUES,
  type OccupantFilter,
  type RolesFilterState,
} from "./types";

export interface RolesFilterPopoverProps {
  filter: RolesFilterState;
  occupantCounts: Record<OccupantFilter, number>;
  onChange: (patch: Partial<RolesFilterState>) => void;
}

function activeFilterCount(filter: RolesFilterState): number {
  return filter.occupant !== "all" ? 1 : 0;
}

export default function RolesFilterPopover({
  filter,
  occupantCounts,
  onChange,
}: RolesFilterPopoverProps) {
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
          aria-label={active > 0 ? `Filter — ${active} active` : "Filter"}
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
      <div id={popoverId} className="ideas-filter-popover" role="dialog" aria-label="Filter roles">
        <section className="ideas-filter-popover-section">
          <header className="ideas-filter-popover-head">
            <span className="ideas-filter-popover-label">occupant</span>
            {filter.occupant !== "all" && (
              <button
                type="button"
                className="ideas-filter-popover-reset"
                onClick={() => onChange({ occupant: "all" })}
              >
                reset
              </button>
            )}
          </header>
          <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Occupant">
            {OCCUPANT_FILTER_VALUES.map((s) => {
              const count = occupantCounts[s] ?? 0;
              const isActive = filter.occupant === s;
              const isEmpty = count === 0 && s !== "all";
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className={`ideas-filter-row${isActive ? " active" : ""}${isEmpty ? " empty" : ""}`}
                  onClick={() => {
                    onChange({ occupant: s });
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
                  <span className="ideas-filter-row-label">{OCCUPANT_FILTER_LABEL[s]}</span>
                  <span className="ideas-filter-row-count">{count}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Popover>
  );
}
