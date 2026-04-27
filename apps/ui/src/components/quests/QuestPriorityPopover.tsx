import { useId, useState } from "react";
import { Popover } from "../ui/Popover";
import { Button } from "../ui";
import type { QuestPriority } from "@/lib/types";

const PRIORITY_VALUES: QuestPriority[] = ["critical", "high", "normal", "low"];

const PRIORITY_LABEL: Record<QuestPriority, string> = {
  critical: "Critical",
  high: "High",
  normal: "Normal",
  low: "Low",
};

export interface QuestPriorityPopoverProps {
  priority: QuestPriority;
  onChange: (next: QuestPriority) => void;
}

/**
 * QuestPriorityPopover — header-tier priority picker, mirrors
 * IdeasScopePopover / QuestStatusPopover. Trigger: secondary pill
 * with the canonical `quest-priority-dot` glyph + label + chevron.
 * Popover rows reuse the shared `.ideas-filter-popover` shell.
 */
export default function QuestPriorityPopover({ priority, onChange }: QuestPriorityPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-start"
      trigger={
        <Button
          variant="secondary"
          size="sm"
          className={`ideas-scope-btn${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          title={`Priority: ${PRIORITY_LABEL[priority]}`}
        >
          <span className={`quest-priority-dot quest-priority-dot--${priority}`} aria-hidden />
          {PRIORITY_LABEL[priority]}
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
        </Button>
      }
    >
      <div id={popoverId} className="ideas-filter-popover ideas-scope-popover" role="dialog">
        <header className="ideas-filter-popover-head">
          <span className="ideas-filter-popover-label">priority</span>
        </header>
        <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Priority">
          {PRIORITY_VALUES.map((p) => {
            const isActive = priority === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={isActive}
                className={`ideas-filter-row${isActive ? " active" : ""}`}
                onClick={() => {
                  onChange(p);
                  setOpen(false);
                }}
              >
                <span className="ideas-filter-row-mark" aria-hidden>
                  <span className={`quest-priority-dot quest-priority-dot--${p}`} />
                </span>
                <span className="ideas-filter-row-label">{PRIORITY_LABEL[p]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
