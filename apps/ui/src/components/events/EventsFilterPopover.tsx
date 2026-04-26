import { useId, useState } from "react";
import { Popover } from "../ui/Popover";
import { type LifecycleGroup, LIFECYCLE_HINT, LIFECYCLE_LABEL, LIFECYCLE_ORDER } from "./lifecycle";

export type EventsScope = "all" | "self" | "inherited" | "global";
export const EVENTS_SCOPE_VALUES: EventsScope[] = ["all", "self", "inherited", "global"];

export type EventsGroup = "all" | LifecycleGroup;
export const EVENTS_GROUP_VALUES: EventsGroup[] = ["all", ...LIFECYCLE_ORDER];

export interface EventsFilterState {
  scope: EventsScope;
  group: EventsGroup;
  search: string;
}

export interface EventsFilterPopoverProps {
  filter: EventsFilterState;
  scopeCounts: Record<EventsScope, number>;
  groupCounts: Record<EventsGroup, number>;
  onChange: (patch: Partial<EventsFilterState>) => void;
}

function activeFilterCount(f: EventsFilterState): number {
  let n = 0;
  if (f.scope !== "all") n += 1;
  if (f.group !== "all") n += 1;
  return n;
}

const SCOPE_HINT: Record<EventsScope, string> = {
  all: "everything visible on this agent",
  self: "anchored on this agent",
  inherited: "fired on this agent, defined elsewhere",
  global: "shared by every agent",
};

export default function EventsFilterPopover({
  filter,
  scopeCounts,
  groupCounts,
  onChange,
}: EventsFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const active = activeFilterCount(filter);

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
      <div id={popoverId} className="ideas-filter-popover" role="dialog" aria-label="Filter events">
        <section className="ideas-filter-popover-section">
          <header className="ideas-filter-popover-head">
            <span className="ideas-filter-popover-label">scope</span>
            {filter.scope !== "all" && (
              <button
                type="button"
                className="ideas-filter-popover-reset"
                onClick={() => onChange({ scope: "all" })}
              >
                reset
              </button>
            )}
          </header>
          <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Scope">
            {EVENTS_SCOPE_VALUES.map((s) => {
              const count = scopeCounts[s] ?? 0;
              const isActive = filter.scope === s;
              const isEmpty = count === 0 && s !== "all";
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  title={SCOPE_HINT[s]}
                  className={`ideas-filter-row${isActive ? " active" : ""}${isEmpty ? " empty" : ""}`}
                  onClick={() => {
                    onChange({ scope: s });
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
                  <span className="ideas-filter-row-label">{s}</span>
                  <span className="ideas-filter-row-count">{count}</span>
                </button>
              );
            })}
          </div>
        </section>
        <hr className="ideas-filter-popover-rule" />
        <section className="ideas-filter-popover-section">
          <header className="ideas-filter-popover-head">
            <span className="ideas-filter-popover-label">lifecycle</span>
            {filter.group !== "all" && (
              <button
                type="button"
                className="ideas-filter-popover-reset"
                onClick={() => onChange({ group: "all" })}
              >
                reset
              </button>
            )}
          </header>
          <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Lifecycle group">
            {EVENTS_GROUP_VALUES.map((g) => {
              const count = groupCounts[g] ?? 0;
              const isActive = filter.group === g;
              const isEmpty = count === 0 && g !== "all";
              const label = g === "all" ? "all" : LIFECYCLE_LABEL[g];
              const hint =
                g === "all" ? "every lifecycle group" : LIFECYCLE_HINT[g as LifecycleGroup];
              return (
                <button
                  key={g}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  title={hint}
                  className={`ideas-filter-row${isActive ? " active" : ""}${isEmpty ? " empty" : ""}`}
                  onClick={() => {
                    onChange({ group: g });
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
                  <span className="ideas-filter-row-label">{label}</span>
                  <span className="ideas-filter-row-count">{count}</span>
                </button>
              );
            })}
          </div>
        </section>
      </div>
    </Popover>
  );
}
