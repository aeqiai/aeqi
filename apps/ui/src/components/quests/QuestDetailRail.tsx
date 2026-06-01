import type { Quest } from "@/lib/types";
import StatusDot from "./StatusDot";

function QuestRailButton({
  quest,
  label,
  onOpen,
}: {
  quest: Quest;
  label?: string;
  onOpen: (id: string) => void;
}) {
  return (
    <button type="button" className="quest-detail-rail-row" onClick={() => onOpen(quest.id)}>
      <StatusDot status={quest.status} />
      <span>
        {label && <small>{label}</small>}
        <strong>{quest.idea?.name ?? quest.id}</strong>
      </span>
      <code>{quest.id}</code>
    </button>
  );
}

export default function QuestDetailRail({
  quest,
  parentQuest,
  childQuests,
  siblingQuests,
  onOpenQuest,
}: {
  quest: Quest;
  parentQuest?: Quest;
  childQuests: Quest[];
  siblingQuests: Quest[];
  onOpenQuest: (id: string) => void;
}) {
  return (
    <aside className="quest-detail-rail" aria-label="Quest relationships">
      <div className="quest-detail-rail-list">
        {parentQuest && <QuestRailButton quest={parentQuest} label="parent" onOpen={onOpenQuest} />}
        <div className="quest-detail-rail-current">
          <StatusDot status={quest.status} />
          <span>
            <small>current</small>
            <strong>{quest.idea?.name ?? quest.id}</strong>
          </span>
          <code>{quest.id}</code>
        </div>
        {childQuests.length > 0 ? (
          <section className="quest-detail-rail-section">
            <h2>Subquests</h2>
            {childQuests.map((child) => (
              <QuestRailButton key={child.id} quest={child} onOpen={onOpenQuest} />
            ))}
          </section>
        ) : (
          <p className="quest-detail-rail-empty">No subquests yet.</p>
        )}
        {siblingQuests.length > 0 && (
          <section className="quest-detail-rail-section">
            <h2>Shared idea</h2>
            {siblingQuests.map((sibling) => (
              <QuestRailButton key={sibling.id} quest={sibling} onOpen={onOpenQuest} />
            ))}
          </section>
        )}
      </div>
    </aside>
  );
}
