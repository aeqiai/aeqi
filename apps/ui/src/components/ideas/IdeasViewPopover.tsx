import { type ReactElement, useState } from "react";
import { Popover } from "../ui/Popover";

export type IdeasView = "list" | "graph";

const VIEW_LABEL: Record<IdeasView, string> = {
  list: "list",
  graph: "graph",
};

const VIEW_GLYPH: Record<IdeasView, ReactElement> = {
  list: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path d="M2.5 4h8M2.5 6.5h8M2.5 9h8" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  graph: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <circle cx="3.4" cy="3.4" r="1.5" strokeWidth="1.2" />
      <circle cx="9.6" cy="3.4" r="1.5" strokeWidth="1.2" />
      <circle cx="6.5" cy="9.7" r="1.5" strokeWidth="1.2" />
      <path
        d="M3.4 3.4 L9.6 3.4 M3.4 3.4 L6.5 9.7 M9.6 3.4 L6.5 9.7"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  ),
};

export interface IdeasViewPopoverProps {
  view: IdeasView;
  onChange: (next: IdeasView) => void;
}

export default function IdeasViewPopover({ view, onChange }: IdeasViewPopoverProps) {
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
          title={`View: ${VIEW_LABEL[view]} (L / G)`}
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
          {(["list", "graph"] as IdeasView[]).map((v) => {
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
                  {v === "list" ? "L" : "G"}
                </kbd>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
