import { useState } from "react";
import { Popover } from "../ui/Popover";
import type { InboxSort } from "./types";

const SORT_LABELS: Record<InboxSort, string> = {
  recent: "Recent",
  unread: "Unread first",
};

const SORT_OPTIONS: InboxSort[] = ["recent", "unread"];

// Clock glyph — matches the Ideas "recent" glyph in weight + viewBox.
const CLOCK_GLYPH = (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
    <circle cx="6.5" cy="6.5" r="4.5" strokeWidth="1.2" />
    <path d="M6.5 4 V6.5 L8.4 7.7" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

// Dot-stack glyph for "unread first".
const UNREAD_GLYPH = (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
    <circle cx="4" cy="4.5" r="1.2" fill="currentColor" stroke="none" />
    <path d="M7 4.5h4" strokeWidth="1.2" strokeLinecap="round" />
    <circle cx="4" cy="8.5" r="1.2" stroke="currentColor" strokeWidth="1.1" fill="none" />
    <path d="M7 8.5h4" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const SORT_GLYPH: Record<InboxSort, React.ReactElement> = {
  recent: CLOCK_GLYPH,
  unread: UNREAD_GLYPH,
};

export interface InboxSortPopoverProps {
  sort: InboxSort;
  onChange: (next: InboxSort) => void;
}

export default function InboxSortPopover({ sort, onChange }: InboxSortPopoverProps) {
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
          aria-label={`Sort: ${SORT_LABELS[sort]}`}
          title={`Sort: ${SORT_LABELS[sort]}`}
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
          {SORT_OPTIONS.map((s) => {
            const isActive = sort === s;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={isActive}
                className={`ideas-filter-row${isActive ? " active" : ""}`}
                onClick={() => {
                  onChange(s);
                  setOpen(false);
                }}
              >
                <span className="ideas-filter-row-mark" aria-hidden>
                  {SORT_GLYPH[s]}
                </span>
                <span className="ideas-filter-row-label">{SORT_LABELS[s]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
