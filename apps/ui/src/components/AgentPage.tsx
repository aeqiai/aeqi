import { useCallback, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import PageTabs from "./PageTabs";
import AgentSessionView from "./AgentSessionView";
import AgentEventsTab from "./AgentEventsTab";
import AgentChannelsTab from "./AgentChannelsTab";
import RoundAvatar from "./RoundAvatar";

const TABS = [
  { id: "sessions", label: "Sessions" },
  { id: "events", label: "Events" },
  { id: "channels", label: "Channels" },
  { id: "settings", label: "Settings" },
];

function timeAgo(iso?: string): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatTokens(n?: number): string {
  if (n == null || n === 0) return "0";
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export default function AgentPage({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const { tab: routeTab, itemId } = useParams<{ tab?: string; itemId?: string }>();
  const activeTab = routeTab && TABS.some((t) => t.id === routeTab) ? routeTab : "sessions";
  const sessionId = activeTab === "sessions" ? itemId || null : null;

  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const displayName = agent?.display_name || agent?.name || agentId;
  const parent = agent?.parent_id ? agents.find((a) => a.id === agent.parent_id) : null;

  const resolvedAgentId = agent?.id || agentId;

  // Save feedback toast
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const showToast = useCallback((message: string, isError = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <>
      {/* Breadcrumb header */}
      <div className="content-topbar">
        <div className="content-topbar-left">
          <span className="content-topbar-breadcrumb" onClick={() => navigate("/agents")}>
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
      <PageTabs tabs={TABS} defaultTab="sessions" />

      {/* Tab content */}
      {activeTab === "sessions" && (
        <div className="agent-page-chat">
          <AgentSessionView agentId={agentId} sessionId={sessionId} />
        </div>
      )}

      {activeTab === "events" && (
        <div className="agent-page-chat">
          <AgentEventsTab agentId={resolvedAgentId} />
        </div>
      )}

      {activeTab === "channels" && (
        <div className="agent-page-chat">
          <AgentChannelsTab agentId={resolvedAgentId} />
        </div>
      )}

      {activeTab === "settings" && (
        <div className="agent-page-settings">
          {/* Save feedback toast */}
          {toast && (
            <div
              style={{
                padding: "8px 16px",
                marginBottom: 12,
                borderRadius: 6,
                fontSize: 13,
                background: toast.isError ? "var(--error, #dc2626)" : "var(--success, #16a34a)",
                color: "#fff",
              }}
            >
              {toast.message}
            </div>
          )}

          {/* Model */}
          <div className="agent-settings-section">
            <h3 className="agent-settings-heading">Model</h3>
            <div className="agent-settings-grid">
              <div className="agent-settings-field">
                <span className="agent-settings-label">Model</span>
                <input
                  className="agent-settings-input"
                  type="text"
                  defaultValue={agent?.model || ""}
                  placeholder="e.g. deepseek/deepseek-v3.2"
                  onBlur={async (e) => {
                    const val = e.target.value.trim();
                    try {
                      await api.setAgentModel(resolvedAgentId, val);
                      showToast("Model saved");
                    } catch (err) {
                      showToast(
                        `Error: ${err instanceof Error ? err.message : "Failed to save model"}`,
                        true,
                      );
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
              </div>
            </div>
          </div>

          {/* Tools */}
          <div className="agent-settings-section">
            <h3 className="agent-settings-heading">Tools</h3>
            <div className="agent-tools-grid">
              {/* Known AEQI tools -- these match the daemon's tool registry in
                 daemon/src/tools/. Update this list when new tools are added. */}
              {[
                "shell",
                "read_file",
                "write_file",
                "edit_file",
                "grep",
                "glob",
                "ideas",
                "quests",
                "agents",
                "events",
                "code",
                "web_search",
                "web_fetch",
              ].map((tool) => {
                const denied = agent?.tool_deny?.includes(tool) ?? false;
                return (
                  <label key={tool} className="agent-tool-toggle">
                    <input
                      type="checkbox"
                      checked={!denied}
                      onChange={async (e) => {
                        const current: string[] = agent?.tool_deny || [];
                        const next = e.target.checked
                          ? current.filter((t) => t !== tool)
                          : [...current, tool];
                        try {
                          await api.setAgentTools(resolvedAgentId, next);
                          showToast("Tools saved");
                        } catch (err) {
                          showToast(
                            `Error: ${err instanceof Error ? err.message : "Failed to save tools"}`,
                            true,
                          );
                        }
                      }}
                    />
                    <span className="agent-tool-name">{tool}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Usage & Budget */}
          <div className="agent-settings-section">
            <h3 className="agent-settings-heading">Usage</h3>
            <div className="agent-stats-row">
              <div className="agent-stat">
                <span className="agent-stat-value">{formatTokens(agent?.total_tokens)}</span>
                <span className="agent-stat-label">tokens used</span>
              </div>
              <div className="agent-stat">
                <span className="agent-stat-value">{agent?.session_count ?? 0}</span>
                <span className="agent-stat-label">sessions</span>
              </div>
              <div className="agent-stat">
                <span className="agent-stat-value">
                  {agent?.budget_usd != null ? `$${agent.budget_usd.toFixed(0)}` : "—"}
                </span>
                <span className="agent-stat-label">budget</span>
              </div>
              <div className="agent-stat">
                <span className="agent-stat-value">{timeAgo(agent?.last_active)}</span>
                <span className="agent-stat-label">last active</span>
              </div>
            </div>
          </div>

          {/* Hierarchy */}
          {(parent || agents.some((a) => a.parent_id === agent?.id)) && (
            <div className="agent-settings-section">
              <h3 className="agent-settings-heading">Hierarchy</h3>
              <div className="agent-settings-grid">
                {parent && (
                  <div className="agent-settings-field">
                    <span className="agent-settings-label">Parent</span>
                    <span
                      className="agent-settings-value agent-settings-link"
                      onClick={() => navigate(`/agents/${parent.id}`)}
                    >
                      <RoundAvatar name={parent.name} size={14} />
                      {parent.display_name || parent.name}
                    </span>
                  </div>
                )}
                {agents.filter((a) => a.parent_id === agent?.id).length > 0 && (
                  <div className="agent-settings-field">
                    <span className="agent-settings-label">Children</span>
                    <span className="agent-settings-value">
                      {agents
                        .filter((a) => a.parent_id === agent?.id)
                        .map((child) => (
                          <span
                            key={child.id}
                            className="agent-settings-child"
                            onClick={() => navigate(`/agents/${child.id}`)}
                          >
                            <RoundAvatar name={child.name} size={14} />
                            {child.display_name || child.name}
                          </span>
                        ))}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Configuration */}
          <div className="agent-settings-section">
            <h3 className="agent-settings-heading">Configuration</h3>
            <div className="agent-settings-grid">
              {agent?.model && (
                <div className="agent-settings-field">
                  <span className="agent-settings-label">Model</span>
                  <span className="agent-settings-value agent-settings-mono">{agent.model}</span>
                </div>
              )}
              {agent?.execution_mode && (
                <div className="agent-settings-field">
                  <span className="agent-settings-label">Mode</span>
                  <span className="agent-settings-value">{agent.execution_mode}</span>
                </div>
              )}
              <div className="agent-settings-field">
                <span className="agent-settings-label">Status</span>
                <span className="agent-settings-value">
                  <span
                    className={`agent-settings-status-dot ${agent?.status === "active" ? "live" : ""}`}
                  />
                  {agent?.status || "unknown"}
                </span>
              </div>
              {agent?.workdir && (
                <div className="agent-settings-field">
                  <span className="agent-settings-label">Workdir</span>
                  <span className="agent-settings-value agent-settings-mono">{agent.workdir}</span>
                </div>
              )}
              {agent?.idea_ids && agent.idea_ids.length > 0 && (
                <div className="agent-settings-field">
                  <span className="agent-settings-label">Ideas</span>
                  <span className="agent-settings-value agent-settings-mono">
                    {agent.idea_ids.join(", ")}
                  </span>
                </div>
              )}
              <div className="agent-settings-field">
                <span className="agent-settings-label">ID</span>
                <span className="agent-settings-value agent-settings-mono">
                  {agent?.id || agentId}
                </span>
              </div>
              {agent?.created_at && (
                <div className="agent-settings-field">
                  <span className="agent-settings-label">Created</span>
                  <span className="agent-settings-value">
                    {new Date(agent.created_at).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
