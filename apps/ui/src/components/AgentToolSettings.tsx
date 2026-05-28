import { useState } from "react";
import { api } from "@/lib/api";
import { ALL_TOOLS } from "@/lib/tools";
import type { Agent } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";

interface AgentToolSettingsProps {
  agent: Agent | undefined;
  resolvedAgentId: string;
  showToast: (msg: string, isError?: boolean) => void;
  titleId?: string;
  subtitle?: string;
}

export default function AgentToolSettings({
  agent,
  resolvedAgentId,
  showToast,
  titleId = "agent-settings-tools-title",
  subtitle = "Allow or block what this agent can call.",
}: AgentToolSettingsProps) {
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const [savingTool, setSavingTool] = useState<string | null>(null);
  const denied = agent?.tool_deny || [];
  const activeCount = ALL_TOOLS.filter((tool) =>
    tool.id === "question.ask" ? !!agent?.can_ask_director : !denied.includes(tool.id),
  ).length;

  const toggleTool = async (toolId: string) => {
    if (savingTool || !resolvedAgentId) return;
    setSavingTool(toolId);
    try {
      if (toolId === "question.ask") {
        await api.setCanAskDirector(resolvedAgentId, !agent?.can_ask_director);
      } else {
        const allowed = !denied.includes(toolId);
        const next = allowed ? [...denied, toolId] : denied.filter((id) => id !== toolId);
        await api.setAgentTools(resolvedAgentId, next);
      }
      await fetchAgents();
      showToast("Tools saved");
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Failed to save tools"}`, true);
    } finally {
      setSavingTool(null);
    }
  };

  return (
    <section className="agent-settings-card" aria-labelledby={titleId}>
      <div className="agent-settings-card-head">
        <div>
          <h2 id={titleId} className="agent-settings-card-title">
            Tools
          </h2>
          <p className="agent-settings-card-subtitle">{subtitle}</p>
        </div>
        <span className="tools-list-summary-n">
          {activeCount}/{ALL_TOOLS.length}
        </span>
      </div>

      <div className="agent-settings-tools-list">
        {ALL_TOOLS.map((tool) => {
          const allowed =
            tool.id === "question.ask" ? !!agent?.can_ask_director : !denied.includes(tool.id);
          const saving = savingTool === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              className={`agent-settings-tool-row${allowed ? "" : " is-off"}`}
              onClick={() => void toggleTool(tool.id)}
              disabled={savingTool !== null || !resolvedAgentId}
              aria-pressed={allowed}
            >
              <span className="agent-settings-tool-cat">{tool.category}</span>
              <span className="agent-settings-tool-main">
                <span className="agent-settings-tool-name">{tool.label}</span>
                <span className="agent-settings-tool-desc">{tool.description}</span>
              </span>
              <span className="agent-settings-tool-state">
                {saving ? "Saving" : allowed ? "On" : "Off"}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
