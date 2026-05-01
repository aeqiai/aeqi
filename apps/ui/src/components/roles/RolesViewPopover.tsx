import { type ReactElement, useState } from "react";
import { Popover } from "../ui/Popover";
import { ROLES_VIEW_LABEL, ROLES_VIEW_VALUES, type RolesView } from "./types";

const VIEW_GLYPH: Record<RolesView, ReactElement> = {
  chart: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <rect x="5" y="1.5" width="3" height="2.5" strokeWidth="1.1" rx="0.4" />
      <rect x="1.5" y="8.5" width="3" height="2.5" strokeWidth="1.1" rx="0.4" />
      <rect x="8.5" y="8.5" width="3" height="2.5" strokeWidth="1.1" rx="0.4" />
      <path d="M6.5 4 V6 M3 6 H10 M3 6 V8.5 M10 6 V8.5" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  ),
  cards: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <rect x="2" y="2" width="4" height="4" strokeWidth="1.1" rx="0.5" />
      <rect x="7" y="2" width="4" height="4" strokeWidth="1.1" rx="0.5" />
      <rect x="2" y="7" width="4" height="4" strokeWidth="1.1" rx="0.5" />
      <rect x="7" y="7" width="4" height="4" strokeWidth="1.1" rx="0.5" />
    </svg>
  ),
  list: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path d="M2.5 4h8M2.5 6.5h8M2.5 9h8" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
};

export interface RolesViewPopoverProps {
  view: RolesView;
  onChange: (next: RolesView) => void;
}

export default function RolesViewPopover({ view, onChange }: RolesViewPopoverProps) {
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
          title={`View: ${ROLES_VIEW_LABEL[view]}`}
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
          {ROLES_VIEW_VALUES.map((v) => {
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
                <span className="ideas-filter-row-label">{ROLES_VIEW_LABEL[v]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
