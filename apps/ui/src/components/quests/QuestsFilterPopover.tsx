import { useId, useMemo, useState } from "react";
import { Popover } from "../ui";
import type { Quest } from "@/lib/types";
import {
  QUEST_FILTER_VALUES,
  QUEST_SCOPE_VALUES,
  isQuestInherited,
  type QuestFilter,
} from "./agentQuestsHelpers";
import { SCOPE_HINT, SCOPE_LABEL, visibilityBucket } from "../ideas/types";

/**
 * Single Filter button + popover. Mirrors IdeasFilterPopover so Quests
 * reads as visually parallel to Ideas in the toolbar. Counts move
 * inside the popover rows; the trigger gets a dot when a non-default
 * scope is active.
 */
export default function QuestsFilterPopover({
  agentId,
  quests,
  filter,
  onChange,
}: {
  agentId: string;
  quests: Quest[];
  filter: QuestFilter;
  onChange: (next: QuestFilter) => void;
}) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const counts = useMemo(() => {
    const c = Object.fromEntries(QUEST_FILTER_VALUES.map((f) => [f, 0])) as Record<
      QuestFilter,
      number
    >;
    for (const q of quests) {
      c.all += 1;
      if (isQuestInherited(q, agentId)) c.inherited += 1;
      if (q.scope != null && QUEST_SCOPE_VALUES.includes(q.scope)) {
        c[visibilityBucket(q.scope)] += 1;
      } else if (q.agent_id === agentId) {
        c.self += 1;
      } else if (q.agent_id == null) {
        c.global += 1;
      }
    }
    return c;
  }, [quests, agentId]);

  const active = filter !== "all";

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={`ideas-toolbar-btn quest-toolbar-popover-btn${active ? " active" : ""}${
            open ? " open" : ""
          }`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          title={active ? `Filter — ${SCOPE_LABEL[filter]}` : "Filter"}
          aria-label={active ? `Filter: ${SCOPE_LABEL[filter]}` : "Filter: All"}
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
          <span className="quest-toolbar-trigger-label">{SCOPE_LABEL[filter]}</span>
          {active && <span className="ideas-toolbar-btn-dot" aria-hidden />}
        </button>
      }
    >
      <div id={popoverId} className="ideas-filter-popover" role="dialog" aria-label="Filter quests">
        <section className="ideas-filter-popover-section">
          <header className="ideas-filter-popover-head">
            <span className="ideas-filter-popover-label">visibility</span>
            {filter !== "all" && (
              <button
                type="button"
                className="ideas-filter-popover-reset"
                onClick={() => onChange("all")}
              >
                reset
              </button>
            )}
          </header>
          <div className="ideas-filter-popover-list" role="radiogroup" aria-label="Visibility">
            {QUEST_FILTER_VALUES.map((s) => {
              const count = counts[s] ?? 0;
              const isActive = filter === s;
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
                    onChange(s);
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
                  <span className="ideas-filter-row-label">{SCOPE_LABEL[s]}</span>
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
