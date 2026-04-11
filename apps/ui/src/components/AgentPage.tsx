import { useSearchParams, useNavigate } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import PageTabs, { useActiveTab } from "./PageTabs";
import AgentSessionView from "./AgentSessionView";
import RoundAvatar from "./RoundAvatar";

const TABS = [
  { id: "chat", label: "Chat" },
  { id: "settings", label: "Settings" },
];

export default function AgentPage({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const sessionId = params.get("session");
  const activeTab = useActiveTab(TABS, "chat");

  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const displayName = agent?.display_name || agent?.name || agentId;

  return (
    <>
      {/* Breadcrumb header */}
      <div className="content-topbar">
        <div className="content-topbar-left">
          <span
            className="content-topbar-breadcrumb"
            onClick={() => navigate("/agents")}
          >
            Agents
          </span>
          <span className="content-topbar-sep">/</span>
          <RoundAvatar name={agent?.name || agentId} size={18} />
          <span className="content-topbar-title">{displayName}</span>
          {agent?.status && (
            <span className={`content-topbar-status ${agent.status === "active" ? "live" : ""}`} />
          )}
        </div>
      </div>

      {/* Page tabs */}
      <PageTabs tabs={TABS} defaultTab="chat" />

      {/* Tab content */}
      {activeTab === "chat" && (
        <div className="agent-page-chat">
          <AgentSessionView agentId={agentId} sessionId={sessionId} />
        </div>
      )}

      {activeTab === "settings" && (
        <div className="agent-page-settings">
          <div className="agent-settings-section">
            <h3 className="agent-settings-heading">Agent Configuration</h3>
            <div className="agent-settings-grid">
              <div className="agent-settings-field">
                <span className="agent-settings-label">Name</span>
                <span className="agent-settings-value">{displayName}</span>
              </div>
              {agent?.model && (
                <div className="agent-settings-field">
                  <span className="agent-settings-label">Model</span>
                  <span className="agent-settings-value agent-settings-mono">{agent.model}</span>
                </div>
              )}
              {agent?.status && (
                <div className="agent-settings-field">
                  <span className="agent-settings-label">Status</span>
                  <span className="agent-settings-value">{agent.status}</span>
                </div>
              )}
              <div className="agent-settings-field">
                <span className="agent-settings-label">ID</span>
                <span className="agent-settings-value agent-settings-mono">{agent?.id || agentId}</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
