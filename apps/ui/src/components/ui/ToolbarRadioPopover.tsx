import { useState, type ReactElement } from "react";
import { Popover } from ".";

export interface ToolbarRadioPopoverProps<T extends string> {
  label: string;
  current: string;
  glyph: ReactElement;
  options: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  /** When true, the trigger renders an active-state dot — used by filter
   * popovers to indicate that a non-resting selection is in play. */
  indicator?: boolean;
}

/**
 * Canonical toolbar popover: a `glyph`-only trigger that opens a radio list.
 * Shared by every "sort/view/filter/status" toolbar slot across the app
 * (Ideas, Blueprints, Agents, …). Previously each surface re-inlined a
 * near-copy of this component; promoted to a single source 2026-05-13.
 */
export default function ToolbarRadioPopover<T extends string>({
  label,
  current,
  glyph,
  options,
  value,
  onChange,
  indicator,
}: ToolbarRadioPopoverProps<T>) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={`ideas-toolbar-btn${indicator ? " active" : ""}${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label}: ${current}`}
          title={`${label}: ${current}`}
        >
          {glyph}
          {indicator && <span className="ideas-toolbar-btn-dot" aria-hidden />}
        </button>
      }
    >
      <div className="ideas-filter-popover" role="dialog" aria-label={label}>
        <header className="ideas-filter-popover-head">
          <span className="ideas-filter-popover-label">{label.toLowerCase()}</span>
        </header>
        <div className="ideas-filter-popover-list" role="radiogroup" aria-label={label}>
          {options.map((opt) => {
            const isActive = value === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                className={`ideas-filter-row${isActive ? " active" : ""}`}
                onClick={() => {
                  onChange(opt.id);
                  setOpen(false);
                }}
              >
                <span className="ideas-filter-row-label">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
