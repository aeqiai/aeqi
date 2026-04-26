import { type ReactElement, useState } from "react";
import { Popover } from "../ui/Popover";
import { type SortMode, SORT_MODES, SORT_LABELS } from "./types";

// One glyph per sort mode — the trigger icon morphs to match the active
// mode so the user can tell the current order at rest, without opening
// the popover. Stroke-only, 13px viewBox, matches the filter/view glyph
// scale so the toolbar reads as a single typographic system.
const SORT_GLYPH: Record<SortMode, ReactElement> = {
  recent: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="6.5" cy="6.5" r="4.5" strokeWidth="1.2" />
      <path d="M6.5 4 V6.5 L8.4 7.7" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  tag: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path
        d="M2 6.5 L6 2.5 H10 V6.5 L6 10.5 Z"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="8" cy="4.5" r="0.55" fill="currentColor" stroke="none" />
    </svg>
  ),
  alpha: (
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
};

export interface IdeasSortPopoverProps {
  sort: SortMode;
  disabled: boolean;
  onChange: (next: SortMode) => void;
}

export default function IdeasSortPopover({ sort, disabled, onChange }: IdeasSortPopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => !disabled && setOpen(o)}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={`ideas-toolbar-btn${open ? " open" : ""}${disabled ? " disabled" : ""}`}
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={disabled ? "Sort suspended under search" : `Sort: ${SORT_LABELS[sort]}`}
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
          {SORT_MODES.map((m) => {
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
                <span className="ideas-filter-row-label">{SORT_LABELS[m]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
