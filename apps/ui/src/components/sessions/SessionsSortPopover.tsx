import { useState } from "react";
import { Popover } from "../ui/Popover";

export type SessionsSort = "recent" | "oldest";

const SORT_LABELS: Record<SessionsSort, string> = {
  recent: "Recent",
  oldest: "Oldest first",
};

const SORT_OPTIONS: SessionsSort[] = ["recent", "oldest"];

// Clock glyph — matches the inbox sort glyph in weight + viewBox so the
// agent and inbox toolbars read as the same primitive.
const CLOCK_GLYPH = (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
    <circle cx="6.5" cy="6.5" r="4.5" strokeWidth="1.2" />
    <path d="M6.5 4 V6.5 L8.4 7.7" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const REVERSE_CLOCK_GLYPH = (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
    <circle cx="6.5" cy="6.5" r="4.5" strokeWidth="1.2" />
    <path d="M6.5 9 V6.5 L4.6 5.3" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

const SORT_GLYPH: Record<SessionsSort, React.ReactElement> = {
  recent: CLOCK_GLYPH,
  oldest: REVERSE_CLOCK_GLYPH,
};

export interface SessionsSortPopoverProps {
  sort: SessionsSort;
  onChange: (next: SessionsSort) => void;
}

/**
 * Sort popover for the agent-surface SessionsToolbar. Mirrors the inbox
 * sort popover's shape so both surfaces read as the same primitive in
 * the chrome zone — only the sort dimensions differ. Inbox sorts by
 * unread vs recent; agent sessions sort by recency direction only.
 */
export default function SessionsSortPopover({ sort, onChange }: SessionsSortPopoverProps) {
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
