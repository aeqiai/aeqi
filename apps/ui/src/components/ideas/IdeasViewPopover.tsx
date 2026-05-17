import { type ReactElement, useState } from "react";
import { Popover } from "../ui/Popover";

// Tables-in-Ideas Phase 2 — `table` and `kanban` join the existing
// `list` / `graph` view modes. Hierarchy now lives inside List rows via
// parent_idea_id disclosure, so there is no separate Tree view.
export type IdeasView = "list" | "table" | "kanban" | "graph";

const VIEW_LABEL: Record<IdeasView, string> = {
  list: "List",
  table: "Table",
  kanban: "Kanban",
  graph: "Graph",
};

const VIEW_GLYPH: Record<IdeasView, ReactElement> = {
  list: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path d="M2.5 4h8M2.5 6.5h8M2.5 9h8" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  table: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <rect x="2" y="3" width="9" height="7" strokeWidth="1.1" />
      <path d="M2 6.5h9M5 3v7" strokeWidth="1.1" />
    </svg>
  ),
  kanban: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <rect x="2" y="3" width="2.5" height="7" strokeWidth="1.1" />
      <rect x="5.25" y="3" width="2.5" height="5" strokeWidth="1.1" />
      <rect x="8.5" y="3" width="2.5" height="6" strokeWidth="1.1" />
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

const VIEW_KBD: Record<IdeasView, string> = {
  list: "L",
  table: "T",
  kanban: "K",
  graph: "G",
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
          {(["list", "table", "kanban", "graph"] as IdeasView[]).map((v) => {
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
                  {VIEW_KBD[v]}
                </kbd>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
