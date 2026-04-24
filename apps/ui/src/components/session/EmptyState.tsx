import { Spinner } from "@/components/ui";

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
  if (activeSessionId) {
    return (
      <div className="asv-empty">
        <div
          className="asv-empty-hint"
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <Spinner size="sm" />
          Loading session…
        </div>
      </div>
    );
  }
  return (
    <div className="asv-empty">
      <div className="asv-empty-eyebrow">New thread</div>
      <div className="asv-empty-title">Message {displayName}</div>
      <div className="asv-empty-hint">
        Type below to start. Threads stay on Home; agents reply in real-time.
      </div>
      <div className="asv-empty-suggestions">
        {["What can you do?", "What quests are open?", "Summarize recent activity"].map((q) => (
          <button key={q} className="asv-empty-suggestion" onClick={() => onSuggestionClick(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
