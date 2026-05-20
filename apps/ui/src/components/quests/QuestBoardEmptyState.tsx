import { Plus } from "lucide-react";
import { Button, Icon } from "../ui";

interface QuestBoardEmptyStateProps {
  isFiltered: boolean;
  onCompose: () => void;
  onReset: () => void;
}

export default function QuestBoardEmptyState({
  isFiltered,
  onCompose,
  onReset,
}: QuestBoardEmptyStateProps) {
  return (
    <div className="quest-board-empty-state">
      <div className="empty-state-hero quest-board-empty-hero">
        <h3 className="empty-state-hero-title">
          {isFiltered ? "No quests in this view." : "No quests yet."}
        </h3>
        <p className="empty-state-hero-body">
          {isFiltered
            ? "Show the full board, or create a quest in the current scope."
            : "Create the first quest to populate this board."}
        </p>
        <div className="quest-board-empty-actions">
          {isFiltered && (
            <Button variant="secondary" size="sm" onClick={onReset}>
              Show all
            </Button>
          )}
          <Button
            variant="primary"
            size="sm"
            onClick={onCompose}
            leadingIcon={<Icon icon={Plus} size="xs" />}
          >
            New quest
          </Button>
        </div>
      </div>
    </div>
  );
}
