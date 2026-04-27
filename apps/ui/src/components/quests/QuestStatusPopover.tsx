import { useId, useState } from "react";
import { Popover } from "../ui/Popover";
import { Button } from "../ui";
import type { QuestStatus } from "@/lib/types";

const STATUS_VALUES: QuestStatus[] = ["pending", "in_progress", "blocked", "done", "cancelled"];

const STATUS_LABEL: Record<QuestStatus, string> = {
  pending: "Pending",
  in_progress: "In Progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

export interface QuestStatusPopoverProps {
  status: QuestStatus;
  onChange: (next: QuestStatus) => void;
}

/**
 * QuestStatusPopover — header-tier status picker, mirrors
 * IdeasScopePopover. Trigger: secondary pill with the canonical
 * `quest-status-dot` glyph + label + chevron. Popover rows reuse
 * the shared `.ideas-filter-popover` shell.
 */
export default function QuestStatusPopover({ status, onChange }: QuestStatusPopoverProps) {
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
          title={`Status: ${STATUS_LABEL[status]}`}
        >
          <span className={`quest-status-dot quest-status-dot--${status}`} aria-hidden />
          {STATUS_LABEL[status]}
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
          <span className="ideas-filter-popover-label">status</span>
        </header>
        <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Status">
          {STATUS_VALUES.map((s) => {
            const isActive = status === s;
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
                  <span className={`quest-status-dot quest-status-dot--${s}`} />
                </span>
                <span className="ideas-filter-row-label">{STATUS_LABEL[s]}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}
