import BrandMark from "../BrandMark";

interface EmptyStateProps {
  agentName: string;
  displayName: string;
  activeSessionId: string | null;
  onSuggestionClick: (query: string) => void;
}

export default function EmptyState({
  agentName: _agentName,
  displayName,
  activeSessionId,
  onSuggestionClick,
}: EmptyStateProps) {
  return (
    <div className="asv-empty">
      <div className="asv-empty-icon">
        <BrandMark size={40} />
      </div>
      <div className="asv-empty-title">{displayName}</div>
      <div className="asv-empty-hint">
        {activeSessionId
          ? "Session loaded — type a message to continue."
          : "Type a message to start a real-time conversation with this agent."}
      </div>
      {!activeSessionId && (
        <div className="asv-empty-suggestions">
          {["What can you do?", "Show me your tools", "What quests are open?"].map((q) => (
            <button key={q} className="asv-empty-suggestion" onClick={() => onSuggestionClick(q)}>
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
