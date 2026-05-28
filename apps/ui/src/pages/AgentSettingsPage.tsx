import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import ModelPicker from "@/components/ModelPicker";
import AgentSurfaceHeader from "@/components/AgentSurfaceHeader";
import AgentToolSettings from "@/components/AgentToolSettings";
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
        <AgentToolSettings agent={agent} resolvedAgentId={resolvedAgentId} showToast={showToast} />
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
