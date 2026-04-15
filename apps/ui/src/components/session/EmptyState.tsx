import RoundAvatar from "../RoundAvatar";

interface EmptyStateProps {
  agentName: string;
  displayName: string;
  activeSessionId: string | null;
  onSuggestionClick: (query: string) => void;
}

export default function EmptyState({
  agentName,
  displayName,
  activeSessionId,
  onSuggestionClick,
}: EmptyStateProps) {
  return (
    <div className="asv-empty">
      <div className="asv-empty-icon">
        <RoundAvatar name={agentName} size={40} />
      </div>
      <div className="asv-empty-title">{displayName}</div>
      <div className="asv-empty-hint">
        {activeSessionId ? "Continue this conversation." : "Start a new session."}
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
