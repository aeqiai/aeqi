import { type ReactElement, useState } from "react";
import { Popover } from "../ui/Popover";

export type QuestsView = "board" | "list";

const VIEW_LABEL: Record<QuestsView, string> = {
  board: "board",
  list: "list",
};

// Glyphs morph the trigger so the user can read the active view at rest
// without opening the popover. Stroke-only 13×13 to match filter / sort
// glyphs in the same toolbar.
const VIEW_GLYPH: Record<QuestsView, ReactElement> = {
  board: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <rect x="2" y="2.5" width="3.5" height="8" rx="0.6" strokeWidth="1.2" />
      <rect x="7.5" y="2.5" width="3.5" height="5" rx="0.6" strokeWidth="1.2" />
    </svg>
  ),
  list: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path d="M2.5 4h8M2.5 6.5h8M2.5 9h8" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
};

export interface QuestsViewPopoverProps {
  view: QuestsView;
  onChange: (next: QuestsView) => void;
}

export default function QuestsViewPopover({ view, onChange }: QuestsViewPopoverProps) {
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
          title={`View: ${VIEW_LABEL[view]} (B / L)`}
        >
          {VIEW_GLYPH[view]}
        </button>
      }
    >
      <div className="ideas-filter-popover ideas-view-popover" role="dialog" aria-label="View">
        <header className="ideas-filter-popover-head">
          <span className="ideas-filter-popover-label">view as</span>
        </header>
        <div className="ideas-filter-popover-list" role="radiogroup" aria-label="View">
          {(["board", "list"] as QuestsView[]).map((v) => {
            const isActive = view === v;
            return (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={isActive}
                className={`ideas-filter-row${isActive ? " active" : ""}`}
                onClick={() => {
                  onChange(v);
                  setOpen(false);
                }}
              >
                <span className="ideas-filter-row-mark" aria-hidden>
                  {VIEW_GLYPH[v]}
                </span>
                <span className="ideas-filter-row-label">{VIEW_LABEL[v]}</span>
                <kbd className="ideas-filter-row-kbd" aria-hidden>
                  {v === "board" ? "B" : "L"}
                </kbd>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
