import { type ReactElement, useState } from "react";
import { Popover } from "../ui/Popover";
import { ROLES_SORT_LABEL, ROLES_SORT_VALUES, type RolesSort } from "./types";

const SORT_GLYPH: Record<RolesSort, ReactElement> = {
  title: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden>
      <text
        x="6.5"
        y="9"
        textAnchor="middle"
        fontFamily="var(--font-sans)"
        fontSize="8"
        fontWeight="700"
        letterSpacing="-0.04em"
        fill="currentColor"
      >
        A↓
      </text>
    </svg>
  ),
  recent: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="6.5" cy="6.5" r="4.5" strokeWidth="1.2" />
      <path d="M6.5 4 V6.5 L8.4 7.7" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  kind: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="4" cy="6.5" r="1.7" strokeWidth="1.1" />
      <circle cx="9" cy="6.5" r="1.7" strokeWidth="1.1" />
    </svg>
  ),
};

export interface RolesSortPopoverProps {
  sort: RolesSort;
  onChange: (next: RolesSort) => void;
}

export default function RolesSortPopover({ sort, onChange }: RolesSortPopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={`ideas-toolbar-btn${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Sort: ${ROLES_SORT_LABEL[sort]}`}
          title={`Sort: ${ROLES_SORT_LABEL[sort]}`}
        >
          {SORT_GLYPH[sort]}
        </button>
      }
    >
      <div className="ideas-filter-popover ideas-sort-popover" role="dialog" aria-label="Sort">
        <header className="ideas-filter-popover-head">
          <span className="ideas-filter-popover-label">sort by</span>
        </header>
        <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Sort">
          {ROLES_SORT_VALUES.map((m) => {
            const isActive = sort === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={isActive}
                className={`ideas-filter-row${isActive ? " active" : ""}`}
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
              >
                <span className="ideas-filter-row-mark" aria-hidden>
                  {SORT_GLYPH[m]}
                </span>
                <span className="ideas-filter-row-label">{ROLES_SORT_LABEL[m]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
