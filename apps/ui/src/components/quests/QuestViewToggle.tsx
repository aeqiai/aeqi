import { Columns3, List, type LucideIcon } from "lucide-react";
import { Icon, ToolbarRadioPopover } from "../ui";
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
  const glyphs: Record<QuestsView, LucideIcon> = {
    board: Columns3,
    list: List,
  };
  const options: Array<{ id: QuestsView; label: string }> = [
    { id: "board", label: QUEST_VIEW_LABELS.board },
    { id: "list", label: QUEST_VIEW_LABELS.list },
  ];

  return (
    <ToolbarRadioPopover
      label="View"
      current={QUEST_VIEW_LABELS[view]}
      glyph={<Icon icon={glyphs[view]} size="sm" />}
      options={options}
      value={view}
      onChange={onChange}
      indicator={view !== "board"}
    />
  );
}
