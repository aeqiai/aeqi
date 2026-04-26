import { type ReactElement, useState } from "react";
import { Popover } from "../ui/Popover";

export type QuestSort = "updated" | "created" | "priority" | "subject";

export const QUEST_SORT_MODES: QuestSort[] = ["updated", "created", "priority", "subject"];

export const QUEST_SORT_LABELS: Record<QuestSort, string> = {
  updated: "recent",
  created: "created",
  priority: "priority",
  subject: "A → Z",
};

// One glyph per mode; trigger morphs to communicate the active sort
// at rest. Stroke-only 13×13 matches filter / view glyphs in the
// same toolbar.
//
// Quests deliberately does NOT disable sort under search the way Ideas
// does — Ideas search returns relevance-ranked results, but the Quests
// search at AgentQuestsTab is a plain substring filter, so the user's
// chosen sort still produces meaningful order during search.
const SORT_GLYPH: Record<QuestSort, ReactElement> = {
  updated: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="6.5" cy="6.5" r="4.5" strokeWidth="1.2" />
      <path d="M6.5 4 V6.5 L8.4 7.7" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  created: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <rect x="2.5" y="3" width="8" height="7.5" rx="1" strokeWidth="1.2" />
      <path d="M2.5 5.5 H10.5" strokeWidth="1.2" />
      <path d="M5 2 V4 M8 2 V4" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  priority: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path d="M3.5 9.5 L6.5 4 L9.5 9.5" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M5 7.5 H8" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  subject: (
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

export interface QuestsSortPopoverProps {
  sort: QuestSort;
  onChange: (next: QuestSort) => void;
}

export default function QuestsSortPopover({ sort, onChange }: QuestsSortPopoverProps) {
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
          title={`Sort: ${QUEST_SORT_LABELS[sort]}`}
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
          {QUEST_SORT_MODES.map((m) => {
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
                <span className="ideas-filter-row-label">{QUEST_SORT_LABELS[m]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
