import { useCallback, useEffect, useRef, useState } from "react";
import AgentToolSettings from "@/components/AgentToolSettings";
import { ALL_TOOLS } from "@/lib/tools";
import { useDaemonStore } from "@/store/daemon";
import { PrimitivePageHeader } from "./ui";
import "@/styles/overview.css";

export default function TrustToolsTab({ agentId }: { agentId: string }) {
  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const resolvedAgentId = agent?.id || agentId;
  const denied = agent?.tool_deny || [];
  const activeCount = ALL_TOOLS.filter((tool) =>
    tool.id === "question.ask" ? !!agent?.can_ask_director : !denied.includes(tool.id),
  ).length;
  const subtitle = agent
    ? `Default agent policy for ${agent.name}.`
    : "Tool access is scoped to the trust's default agent.";
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
    <div className="trust-overview trust-apps-page trust-tools-page">
      {toast && (
        <div
          className={`agent-settings-toast${toast.isError ? " agent-settings-toast--error" : ""}`}
          role="status"
        >
          {toast.message}
        </div>
      )}

      <PrimitivePageHeader
        className="trust-tools-page-header trust-apps-page-header--summary"
        title={
          <span className="trust-primitive-page-title">
            <span className="trust-primitive-page-title-text">Tools</span>
            <span className="trust-primitive-page-count" aria-hidden="true">
              {activeCount}
            </span>
          </span>
        }
        aria-label="Tool controls"
        actions={
          <span className="tools-list-summary-n">
            {activeCount}/{ALL_TOOLS.length}
          </span>
        }
      />

      <div className="trust-primitive-context-strip" role="status">
        <span className="trust-primitive-context-text">{subtitle}</span>
      </div>

      <main className="trust-tools-page-body" aria-label="Trust tools">
        {resolvedAgentId ? (
          <AgentToolSettings
            agent={agent}
            className="trust-cockpit-card trust-cockpit-card--wide trust-tools-card"
            resolvedAgentId={resolvedAgentId}
            showToast={showToast}
            titleId="trust-tools-title"
            subtitle="Allow or block what this agent can call."
            showSummary={false}
          />
        ) : (
          <section
            className="trust-cockpit-card trust-cockpit-card--wide trust-tools-card"
            aria-labelledby="trust-tools-title"
          >
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
