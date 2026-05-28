import { useCallback, useEffect, useRef, useState } from "react";
import AgentToolSettings from "@/components/AgentToolSettings";
import { useDaemonStore } from "@/store/daemon";

export default function TrustToolsTab({ agentId }: { agentId: string }) {
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
      {toast && (
        <div
          className={`agent-settings-toast${toast.isError ? " agent-settings-toast--error" : ""}`}
          role="status"
        >
          {toast.message}
        </div>
      )}

      <main className="agent-settings-page" aria-label="Trust tools">
        {resolvedAgentId ? (
          <AgentToolSettings
            agent={agent}
            resolvedAgentId={resolvedAgentId}
            showToast={showToast}
            titleId="trust-tools-title"
            subtitle={
              agent
                ? `Default agent policy for ${agent.name}.`
                : "Tool access is scoped to the trust's default agent."
            }
          />
        ) : (
          <section className="agent-settings-card" aria-labelledby="trust-tools-title">
            <div className="agent-settings-card-head">
              <div>
                <h2 id="trust-tools-title" className="agent-settings-card-title">
                  Tools
                </h2>
                <p className="agent-settings-card-subtitle">
                  Tool access is available after this trust has an agent.
                </p>
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
