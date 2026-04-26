import { useId, useState } from "react";
import { Popover } from "../ui/Popover";
import type { ScopeValue } from "@/lib/types";
import { IDEA_SCOPE_VALUES } from "./types";

const SCOPE_HINT: Record<ScopeValue, string> = {
  self: "this agent only",
  siblings: "agents that share a parent",
  children: "agents nested under this one",
  branch: "this agent and everything below",
  global: "every agent in every company",
};

export interface IdeasScopePopoverProps {
  scope: ScopeValue;
  /** Set when the idea is fixed (already created). Trigger still opens but
   *  rows render as read-only and a footnote explains why. */
  locked?: boolean;
  onChange?: (next: ScopeValue) => void;
}

export default function IdeasScopePopover({
  scope,
  locked = false,
  onChange,
}: IdeasScopePopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      trigger={
        <button
          type="button"
          className={`ideas-scope-btn${open ? " open" : ""}${locked ? " locked" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          title={locked ? "Scope is set at creation and can't be changed" : `Scope: ${scope}`}
        >
          <span className={`scope-dot scope-dot--${scope}`} aria-hidden />
          <span className="ideas-scope-btn-label">{scope}</span>
          <svg
            className="ideas-scope-btn-chevron"
            width="9"
            height="9"
            viewBox="0 0 9 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M2 3.5 L4.5 6 L7 3.5" />
          </svg>
        </button>
      }
    >
      <div id={popoverId} className="ideas-filter-popover ideas-scope-popover" role="dialog">
        <header className="ideas-filter-popover-head">
          <span className="ideas-filter-popover-label">scope</span>
        </header>
        <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Scope">
          {IDEA_SCOPE_VALUES.map((s) => {
            const isActive = scope === s;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={isActive}
                disabled={locked && !isActive}
                className={`ideas-filter-row${isActive ? " active" : ""}${locked && !isActive ? " empty" : ""}`}
                onClick={() => {
                  if (locked || !onChange) return;
                  onChange(s);
                  setOpen(false);
                }}
              >
                <span className="ideas-filter-row-mark" aria-hidden>
                  <span className={`scope-dot scope-dot--${s}`} />
                </span>
                <span className="ideas-filter-row-label">{s}</span>
                <span className="ideas-filter-row-hint">{SCOPE_HINT[s]}</span>
              </button>
            );
          })}
        </div>
        {locked && (
          <p className="ideas-scope-popover-note">
            Scope is set when the idea is first written and is locked after that.
          </p>
        )}
      </div>
    </Popover>
  );
}
