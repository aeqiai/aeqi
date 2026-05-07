import { useId, useState } from "react";
import { Popover } from "../ui/Popover";

export type SessionsStatusFilter = "all" | "active" | "archived";

export interface SessionsFilterState {
  status: SessionsStatusFilter;
}

const STATUS_LABELS: Record<SessionsStatusFilter, string> = {
  all: "All",
  active: "Active",
  archived: "Archived",
};

const STATUS_OPTIONS: SessionsStatusFilter[] = ["all", "active", "archived"];

function activeCount(f: SessionsFilterState): number {
  return f.status !== "all" ? 1 : 0;
}

export interface SessionsFilterPopoverProps {
  filter: SessionsFilterState;
  onChange: (patch: Partial<SessionsFilterState>) => void;
}

/**
 * Filter popover for the agent-surface SessionsToolbar. Status filter
 * is the natural agent-rail dimension — sessions are either active
 * (running, awaiting reply) or archived (completed, cancelled). The
 * inbox surface filters by kind + entity instead; both toolbars look
 * identical from the chrome zone outward.
 */
export default function SessionsFilterPopover({ filter, onChange }: SessionsFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const active = activeCount(filter);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={`ideas-toolbar-btn${active > 0 ? " active" : ""}${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          aria-label={active > 0 ? `Filter — ${active} active` : "Filter"}
          title={active > 0 ? `Filter — ${active} active` : "Filter"}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M2 3.25h9M3.5 6.5h6M5 9.75h3" />
          </svg>
          {active > 0 && <span className="ideas-toolbar-btn-dot" aria-hidden />}
        </button>
      }
    >
      <div
        id={popoverId}
        className="ideas-filter-popover"
        role="dialog"
        aria-label="Filter sessions"
      >
        <section className="ideas-filter-popover-section">
          <header className="ideas-filter-popover-head">
            <span className="ideas-filter-popover-label">status</span>
            {filter.status !== "all" && (
              <button
                type="button"
                className="ideas-filter-popover-reset"
                onClick={() => onChange({ status: "all" })}
              >
                reset
              </button>
            )}
          </header>
          <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Status">
            {STATUS_OPTIONS.map((s) => {
              const isActive = filter.status === s;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className={`ideas-filter-row${isActive ? " active" : ""}`}
                  onClick={() => {
                    onChange({ status: s });
                    setOpen(false);
                  }}
                >
                  <span className="ideas-filter-row-mark" aria-hidden>
                    {isActive && (
                      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
                        <path
                          d="M2 5.2 L4.2 7.4 L8 3"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                  <span className="ideas-filter-row-label">{STATUS_LABELS[s]}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Popover>
  );
}
