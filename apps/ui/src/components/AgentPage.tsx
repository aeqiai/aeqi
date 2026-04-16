import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useCompanyNav } from "@/hooks/useCompanyNav";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import PageTabs from "./PageTabs";
import AgentSessionView from "./AgentSessionView";
import AgentEventsTab from "./AgentEventsTab";
import AgentChannelsTab from "./AgentChannelsTab";
import RoundAvatar from "./RoundAvatar";
import { EmptyState } from "./ui/EmptyState";
import type { Idea } from "@/lib/types";

const SETTINGS_TABS = ["General", "Channels"] as const;

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "sessions", label: "Sessions" },
  { id: "tools", label: "Tools" },
  { id: "settings", label: "Settings" },
  { id: "agents", label: "Agents" },
  { id: "quests", label: "Quests" },
  { id: "ideas", label: "Ideas" },
  { id: "events", label: "Events" },
];

const ALL_TOOLS = [
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
];

function formatTokens(n?: number): string {
  if (n == null || n === 0) return "0";
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export default function AgentPage({ agentId }: { agentId: string }) {
  const { go } = useCompanyNav();
  const { tab: routeTab, itemId } = useParams<{
    tab?: string;
    itemId?: string;
  }>();
  const activeTab = routeTab && TABS.some((t) => t.id === routeTab) ? routeTab : "sessions";
  const sessionId = activeTab === "sessions" ? itemId || null : null;

  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests);
  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const displayName = agent?.display_name || agent?.name || agentId;

  const resolvedAgentId = agent?.id || agentId;

  // Child agents for the "agents" tab
  const childAgents = agents.filter((a) => a.parent_id === agent?.id);

  // Quests scoped to this agent
  const agentQuests = quests.filter((q) => (q as Record<string, unknown>).agent_id === agent?.id);

  // Ideas scoped to this agent
  const [agentIdeas, setAgentIdeas] = useState<Idea[]>([]);
  useEffect(() => {
    if (activeTab !== "ideas" || !agent?.idea_ids?.length) {
      setAgentIdeas([]);
      return;
    }
    api
      .getIdeasByIds(agent.idea_ids)
      .then((res) => setAgentIdeas(res.ideas || []))
      .catch(() => setAgentIdeas([]));
  }, [activeTab, agent?.idea_ids]);

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
          <span className="content-topbar-breadcrumb" onClick={() => go(`/agents`)}>
            Agents
          </span>
          <span className="content-topbar-sep">/</span>
          <RoundAvatar name={agent?.name || agentId} size={18} />
          <span className="content-topbar-title">{displayName}</span>
          {agent?.status && (
            <span className={`content-topbar-status ${agent.status === "active" ? "live" : ""}`} />
          )}
        </div>
        <div className="content-topbar-right">
          <span className="content-topbar-meta">{agent?.model?.split("/").pop()}</span>
          <span className="content-topbar-meta">{formatTokens(agent?.total_tokens)} tokens</span>
          {agent?.budget_usd != null && (
            <span className="content-topbar-meta">${agent.budget_usd.toFixed(2)}</span>
          )}
        </div>
      </div>

      {/* Page tabs */}
      <PageTabs tabs={TABS} defaultTab="sessions" />

      {/* Save feedback toast */}
      {toast && (
        <div
          style={{
            padding: "8px 16px",
            margin: "8px 16px 0",
            borderRadius: 6,
            fontSize: 13,
            background: toast.isError ? "var(--error, #dc2626)" : "var(--success, #16a34a)",
            color: "#fff",
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Tab content */}
      {activeTab === "dashboard" && (
        <div className="page-content">
          <div className="agent-stats-row">
            <div className="agent-stat">
              <span className="agent-stat-value">{agent?.session_count ?? 0}</span>
              <span className="agent-stat-label">sessions</span>
            </div>
            <div className="agent-stat">
              <span className="agent-stat-value">
                {agentQuests.filter((q) => (q as Record<string, unknown>).status === "done").length}
              </span>
              <span className="agent-stat-label">completed</span>
            </div>
            <div className="agent-stat">
              <span className="agent-stat-value">
                {agentQuests.filter((q) => (q as Record<string, unknown>).status === "in_progress").length}
              </span>
              <span className="agent-stat-label">in progress</span>
            </div>
            <div className="agent-stat">
              <span className="agent-stat-value">{formatTokens(agent?.total_tokens)}</span>
              <span className="agent-stat-label">tokens</span>
            </div>
            <div className="agent-stat">
              <span className="agent-stat-value">
                {agent?.budget_usd != null ? `$${agent.budget_usd.toFixed(0)}` : "—"}
              </span>
              <span className="agent-stat-label">budget</span>
            </div>
            <div className="agent-stat">
              <span className="agent-stat-value">{childAgents.length}</span>
              <span className="agent-stat-label">children</span>
            </div>
          </div>
          {agent?.idea_ids && agent.idea_ids.length > 0 && (
            <div className="agent-settings-section">
              <h3 className="agent-settings-heading">Ideas ({agent.idea_ids.length})</h3>
              <div className="agent-settings-mono">{agent.idea_ids.join(", ")}</div>
            </div>
          )}
        </div>
      )}

      {activeTab === "sessions" && (
        <div className="agent-page-chat">
          <AgentSessionView agentId={agentId} sessionId={sessionId} />
        </div>
      )}

      {activeTab === "agents" && (
        <div className="page-content" style={{ padding: "16px" }}>
          {childAgents.length > 0 ? (
            <div className="agent-children-grid">
              {childAgents.map((child) => (
                <div
                  key={child.id}
                  className="agent-child-card"
                  onClick={() => go(`/agents/${child.id}`)}
                >
                  <RoundAvatar name={child.name} size={28} />
                  <div>
                    <div className="agent-child-name">{child.display_name || child.name}</div>
                    <div className="agent-child-status">{child.status}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No child agents"
              description="This agent hasn't spawned any sub-agents."
            />
          )}
        </div>
      )}

      {activeTab === "quests" && (
        <div className="page-content" style={{ padding: "16px" }}>
          {agentQuests.length > 0 ? (
            agentQuests.map((quest) => {
              const q = quest as Record<string, unknown>;
              return (
                <div key={q.id as string} className="scoped-quest-row">
                  <span className="scoped-quest-status">{q.status as string}</span>
                  <span className="scoped-quest-subject">{q.subject as string}</span>
                </div>
              );
            })
          ) : (
            <EmptyState title="No quests" description="No work items assigned to this agent." />
          )}
        </div>
      )}

      {activeTab === "ideas" && (
        <div className="page-content" style={{ padding: "16px" }}>
          {agentIdeas.length > 0 ? (
            agentIdeas.map((idea) => (
              <div key={idea.id} className="scoped-quest-row">
                <span className="scoped-quest-status">{idea.tags?.join(", ") || "idea"}</span>
                <span className="scoped-quest-subject">{idea.name}</span>
              </div>
            ))
          ) : (
            <EmptyState title="No ideas" description="No ideas attached to this agent." />
          )}
        </div>
      )}

      {activeTab === "events" && (
        <div className="agent-page-chat">
          <AgentEventsTab agentId={resolvedAgentId} />
        </div>
      )}

      {activeTab === "tools" && (
        <div className="page-content">
          <div className="tools-grid">
            {ALL_TOOLS.map((tool) => {
              const allowed = !agent?.tool_deny?.includes(tool);
              return (
                <button
                  key={tool}
                  className={`tool-card ${allowed ? "tool-active" : ""}`}
                  onClick={async () => {
                    const current = agent?.tool_deny || [];
                    const next = allowed ? [...current, tool] : current.filter((t) => t !== tool);
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
                >
                  <span className="tool-name">{tool}</span>
                  <span className="tool-status">{allowed ? "active" : "off"}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === "settings" && (
        <SettingsPanel
          agent={agent}
          agentId={agentId}
          resolvedAgentId={resolvedAgentId}
          agents={agents}
          childAgents={childAgents}
          showToast={showToast}
          go={go}
        />
      )}
    </>
  );
}

function SettingsPanel({
  agent,
  agentId,
  resolvedAgentId,
  agents,
  childAgents,
  showToast,
  go,
}: {
  agent: ReturnType<typeof useDaemonStore.getState>["agents"][0] | undefined;
  agentId: string;
  resolvedAgentId: string;
  agents: ReturnType<typeof useDaemonStore.getState>["agents"];
  childAgents: ReturnType<typeof useDaemonStore.getState>["agents"];
  showToast: (msg: string, isError?: boolean) => void;
  go: (path: string) => void;
}) {
  const [settingsTab, setSettingsTab] = useState<(typeof SETTINGS_TABS)[number]>("General");

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div className="page-tabs" style={{ paddingLeft: 16 }}>
        {SETTINGS_TABS.map((t) => (
          <button
            key={t}
            className={`page-tab${settingsTab === t ? " active" : ""}`}
            onClick={() => setSettingsTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {settingsTab === "General" && (
        <div className="page-content">
          <div className="agent-settings-section">
            <h3 className="agent-settings-heading">Model</h3>
            <input
              className="agent-settings-input"
              type="text"
              defaultValue={agent?.model || ""}
              placeholder="e.g. anthropic/claude-sonnet-4"
              onBlur={async (e) => {
                const val = e.target.value.trim();
                try {
                  await api.setAgentModel(resolvedAgentId, val);
                  showToast("Model saved");
                } catch (err) {
                  showToast(
                    `Error: ${err instanceof Error ? err.message : "Failed to save"}`,
                    true,
                  );
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>

          <div className="agent-settings-section">
            <h3 className="agent-settings-heading">Details</h3>
            <div className="agent-settings-grid">
              <div className="agent-settings-field">
                <span className="agent-settings-label">Status</span>
                <span className="agent-settings-value">
                  <span
                    className={`agent-settings-status-dot ${agent?.status === "active" ? "live" : ""}`}
                  />
                  {agent?.status || "unknown"}
                </span>
              </div>
              {agent?.execution_mode && (
                <div className="agent-settings-field">
                  <span className="agent-settings-label">Mode</span>
                  <span className="agent-settings-value">{agent.execution_mode}</span>
                </div>
              )}
              {agent?.workdir && (
                <div className="agent-settings-field">
                  <span className="agent-settings-label">Workdir</span>
                  <span className="agent-settings-value agent-settings-mono">{agent.workdir}</span>
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

      {settingsTab === "Channels" && (
        <AgentChannelsTab agentId={resolvedAgentId} />
      )}

    </div>
  );
}
