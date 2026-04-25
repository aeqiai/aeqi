import { useMemo } from "react";
import { Spinner } from "@/components/ui";
import { useDaemonStore } from "@/store/daemon";
import { timeAgo } from "@/lib/format";

interface EmptyStateProps {
  agentId: string;
  agentName: string;
  displayName: string;
  activeSessionId: string | null;
  onSuggestionClick: (query: string) => void;
}

/**
 * Per-agent chat empty state. Shown at `/:agentId` when the user has
 * landed on the agent's home but no specific session is selected, or
 * when a fresh thread is being started.
 *
 * Rejected the prior generic "what can you do?" suggestions in favor
 * of a context-aware status line + three conversational opener
 * prompts that pull the agent into surfacing its own context. Reads
 * as: "here's who I am and what I'm in the middle of — what do you
 * want to talk about?"
 *
 * Stats line follows the design system's mono-for-numbers rule.
 * Suggestions are quiet — text + hairline border, no fill — so they
 * read as discoverable openings, not as a CTA wall.
 */
export default function EmptyState({
  agentId,
  agentName,
  displayName,
  activeSessionId,
  onSuggestionClick,
}: EmptyStateProps) {
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests);

  // Look up the agent record (for last_active, session_count, etc.).
  const agent = useMemo(
    () => agents.find((a) => a.id === agentId || a.name === agentId),
    [agents, agentId],
  );

  // Open quests for this agent — open == anything that isn't done /
  // cancelled. Defensive: quest store is loosely typed Record-of-unknown.
  const openQuestCount = useMemo(() => {
    if (!agent) return 0;
    return quests.filter((q) => {
      const aid = (q as { agent_id?: string }).agent_id;
      const st = (q as { status?: string }).status;
      const open = st !== "done" && st !== "cancelled" && st !== "closed";
      return aid === agent.id && open;
    }).length;
  }, [quests, agent]);

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

  // Build the stats line. Each segment is optional — only the
  // meaningful ones render so the line never reads as padded zeros.
  const segments: string[] = [];
  if (openQuestCount > 0) {
    segments.push(`${openQuestCount} open ${openQuestCount === 1 ? "quest" : "quests"}`);
  }
  if (agent?.session_count != null && agent.session_count > 0) {
    segments.push(
      `${agent.session_count.toLocaleString()} ${agent.session_count === 1 ? "session" : "sessions"}`,
    );
  }
  if (agent?.last_active) {
    segments.push(`last active ${timeAgo(agent.last_active)}`);
  }

  return (
    <div className="asv-empty">
      <div className="asv-empty-eyebrow">new thread</div>
      <h1 className="asv-empty-title">{displayName}</h1>
      {segments.length > 0 && (
        <div className="asv-empty-stats" aria-label="agent context">
          {segments.map((seg, i) => (
            <span key={seg}>
              {i > 0 && (
                <span className="asv-empty-stats-sep" aria-hidden="true">
                  ·
                </span>
              )}
              <span className="asv-empty-stats-segment">{seg}</span>
            </span>
          ))}
        </div>
      )}
      <div className="asv-empty-hint">
        Type below to talk to {agentName}. Threads stay on Home; the agent replies in real time.
      </div>
      <div className="asv-empty-suggestions">
        {[
          "what have you been working on",
          "what should we focus on today",
          "anything blocking you i should know about",
        ].map((q) => (
          <button key={q} className="asv-empty-suggestion" onClick={() => onSuggestionClick(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
