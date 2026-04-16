import { useState } from "react";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";

export default function QuickActions({
  agentId,
  agentName,
}: {
  agentId: string;
  agentName: string;
}) {
  const { go } = useNav();
  const [creating, setCreating] = useState(false);

  const handleNewQuest = () => {
    go(`/quests`);
  };

  const handleNewSession = async () => {
    setCreating(true);
    try {
      const result = await api.createSession(agentId);
      const sessionId = result?.session_id || result?.id;
      if (sessionId) {
        go(`/agents/${agentName}/sessions/${sessionId}`);
      } else {
        go(`/agents/${agentName}`);
      }
    } catch {
      // Navigate to sessions page even on failure
      go(`/agents/${agentName}`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="drawer-actions">
      <button className="drawer-action-btn" onClick={handleNewQuest}>
        New Quest
      </button>
      <button className="drawer-action-btn primary" onClick={handleNewSession} disabled={creating}>
        {creating ? "Starting\u2026" : "New Session"}
      </button>
    </div>
  );
}
