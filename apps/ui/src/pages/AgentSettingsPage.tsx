import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { ALL_TOOLS } from "@/lib/tools";
import ModelPicker from "@/components/ModelPicker";
import AgentSurfaceHeader from "@/components/AgentSurfaceHeader";
import { useDaemonStore } from "@/store/daemon";

/**
 * Minimal drilled-agent settings surface.
 *
 * MVP rule: Settings only configures the agent itself — model and tool
 * permissions. Agent-scoped Quests / Ideas / Events are deliberately not
 * duplicated here; those belong to their top-level primitive pages.
 */
export default function AgentSettingsPage({ agentId }: { agentId: string }) {
  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const resolvedAgentId = agent?.id || agentId;

  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((message: string, isError = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  return (
    <div className="agent-settings-surface">
      <AgentSurfaceHeader agentId={resolvedAgentId} variant="settings" />

      {toast && (
        <div
          className={`agent-settings-toast${toast.isError ? " agent-settings-toast--error" : ""}`}
          role="status"
        >
          {toast.message}
        </div>
      )}

      <main className="agent-settings-page" aria-label="Agent settings">
        <ModelSettings agent={agent} resolvedAgentId={resolvedAgentId} showToast={showToast} />
        <ToolSettings agent={agent} resolvedAgentId={resolvedAgentId} showToast={showToast} />
      </main>
    </div>
  );
}

function ModelSettings({
  agent,
  resolvedAgentId,
  showToast,
}: {
  agent: ReturnType<typeof useDaemonStore.getState>["agents"][0] | undefined;
  resolvedAgentId: string;
  showToast: (msg: string, isError?: boolean) => void;
}) {
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const [localModel, setLocalModel] = useState(agent?.model || "");
  const [modelSave, setModelSave] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [modelError, setModelError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setLocalModel(agent?.model || "");
  }, [agent?.model]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const saveModel = useCallback(
    async (slug: string) => {
      const trimmed = slug.trim();
      if (!trimmed || trimmed === agent?.model) return;
      setLocalModel(trimmed);
      setModelSave("saving");
      setModelError(null);
      try {
        await api.setAgentModel(resolvedAgentId, trimmed);
        await fetchAgents();
        setModelSave("saved");
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => setModelSave("idle"), 1800);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save";
        setModelError(msg);
        setModelSave("error");
        showToast(`Error: ${msg}`, true);
      }
    },
    [agent?.model, fetchAgents, resolvedAgentId, showToast],
  );

  return (
    <section className="agent-settings-card" aria-labelledby="agent-settings-model-title">
      <div className="agent-settings-card-head">
        <div>
          <h2 id="agent-settings-model-title" className="agent-settings-card-title">
            Model
          </h2>
          <p className="agent-settings-card-subtitle">Runtime model used for this agent's turns.</p>
        </div>
        <span
          className={`agent-settings-save-pill${
            modelSave === "saved" || modelSave === "error"
              ? " agent-settings-save-pill--visible"
              : ""
          }${modelSave === "error" ? " agent-settings-save-pill--error" : ""}`}
          role="status"
          aria-live="polite"
        >
          <span className="agent-settings-save-pill-dot" aria-hidden="true" />
          {modelSave === "saved" ? "Saved" : modelSave === "error" ? modelError : ""}
        </span>
      </div>
      <ModelPicker value={localModel} onChange={saveModel} disabled={modelSave === "saving"} />
    </section>
  );
}

function ToolSettings({
  agent,
  resolvedAgentId,
  showToast,
}: {
  agent: ReturnType<typeof useDaemonStore.getState>["agents"][0] | undefined;
  resolvedAgentId: string;
  showToast: (msg: string, isError?: boolean) => void;
}) {
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const [savingTool, setSavingTool] = useState<string | null>(null);
  const denied = agent?.tool_deny || [];
  const activeCount =
    ALL_TOOLS.filter((tool) =>
      tool.id === "question.ask" ? !!agent?.can_ask_director : !denied.includes(tool.id),
    ).length ?? 0;

  const toggleTool = async (toolId: string) => {
    if (savingTool) return;
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
    <section className="agent-settings-card" aria-labelledby="agent-settings-tools-title">
      <div className="agent-settings-card-head">
        <div>
          <h2 id="agent-settings-tools-title" className="agent-settings-card-title">
            Tools
          </h2>
          <p className="agent-settings-card-subtitle">Allow or block what this agent can call.</p>
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
              disabled={savingTool !== null}
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
