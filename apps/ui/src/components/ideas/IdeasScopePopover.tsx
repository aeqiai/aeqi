import { useId, useState } from "react";
import { Popover } from "../ui/Popover";
import { Button } from "../ui";
import type { ScopeValue } from "@/lib/types";
import {
  PUBLIC_VISIBILITY_HINT,
  PUBLIC_VISIBILITY_LABEL,
  SCOPE_HINT,
  SCOPE_LABEL,
  SCOPE_PICKER_VALUES,
} from "./types";

export interface IdeasScopePopoverProps {
  scope: ScopeValue;
  /** Set when the idea is fixed (already created). Trigger still opens
   *  but rows render as read-only. The scope is set at creation and
   *  can't be migrated server-side today; the popover is informational
   *  in this mode. */
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
  const scopeOptions = locked
    ? Array.from(new Set<ScopeValue>([scope, ...SCOPE_PICKER_VALUES]))
    : SCOPE_PICKER_VALUES;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      trigger={
        <Button
          variant="secondary"
          size="sm"
          className={`ideas-scope-btn${open ? " open" : ""}${locked ? " locked" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          title={locked ? "Visibility (set at creation)" : `Visibility: ${SCOPE_LABEL[scope]}`}
          leadingIcon={<span className={`scope-dot scope-dot--${scope}`} />}
          trailingIconMode="inline"
          trailingIcon={
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
          }
        >
          {SCOPE_LABEL[scope]}
        </Button>
      }
    >
      <div id={popoverId} className="ideas-filter-popover ideas-scope-popover" role="dialog">
        <header className="ideas-filter-popover-head">
          <span className="ideas-filter-popover-label">visibility</span>
        </header>
        <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Visibility">
          {scopeOptions.map((s) => {
            const isActive = scope === s;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={isActive}
                disabled={locked && !isActive}
                title={SCOPE_HINT[s]}
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
                <span className="ideas-filter-row-label">{SCOPE_LABEL[s]}</span>
              </button>
            );
          })}
          <button
            key="public"
            type="button"
            role="radio"
            aria-checked={false}
            disabled
            title={PUBLIC_VISIBILITY_HINT}
            className="ideas-filter-row empty"
          >
            <span className="ideas-filter-row-mark" aria-hidden />
            <span className="ideas-filter-row-leading" aria-hidden>
              <span className="scope-dot scope-dot--global" />
            </span>
            <span className="ideas-filter-row-label">{PUBLIC_VISIBILITY_LABEL}</span>
          </button>
        </div>
      </div>
    </Popover>
  );
}
