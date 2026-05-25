import { Plus } from "lucide-react";
import { Button, Icon } from "../ui";

interface QuestBoardNoMatchesProps {
  onClear: () => void;
  onCompose: () => void;
}

export default function QuestBoardNoMatches({ onClear, onCompose }: QuestBoardNoMatchesProps) {
  return (
    <div className="quest-board-empty-state">
      <div className="empty-state-hero quest-board-empty-hero">
        <h3 className="empty-state-hero-title">No quests match.</h3>
        <p className="empty-state-hero-body">
          Try a broader term, or search by quest title, linked idea, tags, parent, or dependency.
        </p>
        <div className="quest-board-empty-actions">
          <Button variant="secondary" size="sm" onClick={onClear}>
            Clear search
          </Button>
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
