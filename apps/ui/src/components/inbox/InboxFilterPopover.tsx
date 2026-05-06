import { useId, useState } from "react";
import { Popover } from "../ui/Popover";
import type { InboxFilterState, InboxKind } from "./types";

export interface InboxFilterPopoverProps {
  filter: InboxFilterState;
  entityOptions: { id: string; name: string }[];
  onChange: (patch: Partial<InboxFilterState>) => void;
}

const KIND_LABELS: Record<InboxKind | "all", string> = {
  all: "All",
  decision_request: "Decisions",
  system: "System",
};

const KIND_OPTIONS: (InboxKind | "all")[] = ["all", "decision_request", "system"];

function activeCount(f: InboxFilterState): number {
  let n = 0;
  if (f.entityId !== null) n += 1;
  if (f.kind !== "all") n += 1;
  if (f.unreadOnly) n += 1;
  return n;
}

export default function InboxFilterPopover({
  filter,
  entityOptions,
  onChange,
}: InboxFilterPopoverProps) {
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
      <div id={popoverId} className="ideas-filter-popover" role="dialog" aria-label="Filter inbox">
        {/* Kind filter */}
        <section className="ideas-filter-popover-section">
          <header className="ideas-filter-popover-head">
            <span className="ideas-filter-popover-label">kind</span>
            {filter.kind !== "all" && (
              <button
                type="button"
                className="ideas-filter-popover-reset"
                onClick={() => onChange({ kind: "all" })}
              >
                reset
              </button>
            )}
          </header>
          <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Kind">
            {KIND_OPTIONS.map((k) => {
              const isActive = filter.kind === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  className={`ideas-filter-row${isActive ? " active" : ""}`}
                  onClick={() => {
                    onChange({ kind: k });
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
                  <span className="ideas-filter-row-label">{KIND_LABELS[k]}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Entity filter — only when there's more than one company */}
        {entityOptions.length > 1 && (
          <>
            <hr className="ideas-filter-popover-rule" />
            <section className="ideas-filter-popover-section">
              <header className="ideas-filter-popover-head">
                <span className="ideas-filter-popover-label">company</span>
                {filter.entityId !== null && (
                  <button
                    type="button"
                    className="ideas-filter-popover-reset"
                    onClick={() => onChange({ entityId: null })}
                  >
                    reset
                  </button>
                )}
              </header>
              <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Company">
                <button
                  type="button"
                  role="radio"
                  aria-checked={filter.entityId === null}
                  className={`ideas-filter-row${filter.entityId === null ? " active" : ""}`}
                  onClick={() => {
                    onChange({ entityId: null });
                    setOpen(false);
                  }}
                >
                  <span className="ideas-filter-row-mark" aria-hidden>
                    {filter.entityId === null && (
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
                  <span className="ideas-filter-row-label">All companies</span>
                </button>
                {entityOptions.map((e) => {
                  const isActive = filter.entityId === e.id;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      className={`ideas-filter-row${isActive ? " active" : ""}`}
                      onClick={() => {
                        onChange({ entityId: e.id });
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
                      <span className="ideas-filter-row-label">{e.name}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </>
        )}
      </div>
    </Popover>
  );
}
