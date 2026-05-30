import { Columns3, List, type LucideIcon } from "lucide-react";
import { Icon } from "../ui";
import type { QuestsView } from "./questView";

const QUEST_VIEW_LABELS: Record<QuestsView, string> = {
  board: "Board",
  list: "List",
};

export default function QuestViewToggle({
  view,
  onChange,
}: {
  view: QuestsView;
  onChange: (next: QuestsView) => void;
}) {
  const options: Array<{ value: QuestsView; icon: LucideIcon }> = [
    { value: "board", icon: Columns3 },
    { value: "list", icon: List },
  ];

  return (
    <div className="quest-view-toggle" role="radiogroup" aria-label="View mode">
      {options.map(({ value, icon }) => {
        const isActive = view === value;
        return (
          <button
            key={value}
            type="button"
            className="quest-view-toggle-btn"
            role="radio"
            aria-checked={isActive}
            data-active={isActive || undefined}
            onClick={() => onChange(value)}
            title={`${QUEST_VIEW_LABELS[value]} view`}
          >
            <Icon icon={icon} size="xs" />
            <span>{QUEST_VIEW_LABELS[value]}</span>
          </button>
        );
      })}
    </div>
  );
}
