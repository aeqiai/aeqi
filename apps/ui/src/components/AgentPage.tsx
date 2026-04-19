import { useCallback, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import AgentSessionView from "./AgentSessionView";
import AgentEventsTab from "./AgentEventsTab";
import AgentChannelsTab from "./AgentChannelsTab";
import AgentIdeasTab from "./AgentIdeasTab";
import AgentQuestsTab from "./AgentQuestsTab";
import BrandMark from "./BrandMark";
import BudgetMeter from "./BudgetMeter";
import { Button, EmptyState } from "./ui";
import { ALL_TOOLS, TOOL_BY_ID } from "@/lib/tools";

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "settings", label: "Settings" },
  { id: "sessions", label: "Sessions" },
  { id: "agents", label: "Agents" },
  { id: "events", label: "Events" },
  { id: "channels", label: "Channels" },
  { id: "quests", label: "Quests" },
  { id: "ideas", label: "Ideas" },
  { id: "tools", label: "Tools" },
];

function formatTokens(n?: number): string {
  if (n == null || n === 0) return "0";
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export default function AgentPage({
  agentId,
  tab: tabProp,
  itemId: itemIdProp,
}: {
  agentId: string;
  tab?: string;
  itemId?: string | null;
}) {
  const { goAgent } = useNav();
  const params = useParams<{ tab?: string; itemId?: string }>();
  const routeTab = tabProp ?? params.tab;
  const itemId = itemIdProp ?? params.itemId;
  const activeTab = routeTab && TABS.some((t) => t.id === routeTab) ? routeTab : "sessions";
  const sessionId = activeTab === "sessions" ? itemId || null : null;

  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests);
  const cost = useDaemonStore((s) => s.cost);
  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const displayName = agent?.display_name || agent?.name || agentId;

  const resolvedAgentId = agent?.id || agentId;

  // Child agents for the "agents" tab
  const childAgents = agents.filter((a) => a.parent_id === agent?.id);

  // Quest counts for the dashboard tab (lightweight — just IDs + status)
  const agentQuests = quests.filter((q) => (q as Record<string, unknown>).agent_id === agent?.id);

  // Save feedback toast
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const showToast = useCallback((message: string, isError = false) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Breadcrumb header */}
      <div className="content-topbar">
        <div className="content-topbar-left">
          <BrandMark size={14} />
          <span className="content-topbar-title">{displayName}</span>
          {agent?.model && (
            <span className="content-topbar-meta">{agent.model.split("/").pop()}</span>
          )}
        </div>
        <div className="content-topbar-right">
          <BudgetMeter
            spent={(cost?.spent_today_usd as number) ?? 0}
            cap={agent?.budget_usd ?? (cost?.daily_budget_usd as number) ?? 0}
          />
        </div>
      </div>

      {/* Save feedback toast */}
      {toast && (
        <div
          style={{
            padding: "8px 16px",
            margin: "8px 16px 0",
            borderRadius: 6,
            fontSize: 13,
            background: toast.isError ? "var(--error, #dc2626)" : "var(--success, #16a34a)",
            color: "var(--btn-primary-text)",
          }}
        >
          {toast.message}
        </div>
      )}

      {/* Tab content */}
      {activeTab === "dashboard" && (
        <div className="page-content">
          <div className="agent-stat-cards">
            <div className="agent-stat-card">
              <span className="agent-stat-card-value">{agent?.session_count ?? 0}</span>
              <span className="agent-stat-card-label">Sessions</span>
            </div>
            <div className="agent-stat-card">
              <span className="agent-stat-card-value">
                {agentQuests.filter((q) => (q as Record<string, unknown>).status === "done").length}
              </span>
              <span className="agent-stat-card-label">Completed</span>
            </div>
            <div className="agent-stat-card">
              <span className="agent-stat-card-value">
                {
                  agentQuests.filter((q) => (q as Record<string, unknown>).status === "in_progress")
                    .length
                }
              </span>
              <span className="agent-stat-card-label">In Progress</span>
            </div>
            <div className="agent-stat-card">
              <span className="agent-stat-card-value">{formatTokens(agent?.total_tokens)}</span>
              <span className="agent-stat-card-label">Tokens</span>
            </div>
            <div className="agent-stat-card">
              <span className="agent-stat-card-value">
                {agent?.budget_usd != null ? `$${agent.budget_usd.toFixed(0)}` : "—"}
              </span>
              <span className="agent-stat-card-label">Budget</span>
            </div>
            <div className="agent-stat-card">
              <span className="agent-stat-card-value">{childAgents.length}</span>
              <span className="agent-stat-card-label">Children</span>
            </div>
          </div>
          {agent?.idea_ids && agent.idea_ids.length > 0 && (
            <div className="agent-settings-section">
              <h3 className="agent-settings-heading">Ideas ({agent.idea_ids.length})</h3>
              <div className="agent-stat-ideas">
                {agent.idea_ids.map((id) => (
                  <span key={id} className="agent-idea-pill">
                    {id}
                  </span>
                ))}
              </div>
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
                <div key={child.id} className="agent-child-card" onClick={() => goAgent(child.id)}>
                  <BrandMark size={22} />
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
              description="This agent hasn't spawned any sub-agents yet. Sub-agents are created automatically when a quest requires delegation."
            />
          )}
        </div>
      )}

      {activeTab === "quests" && <AgentQuestsTab agentId={resolvedAgentId} />}

      {activeTab === "ideas" && <AgentIdeasTab agentId={resolvedAgentId} />}

      {activeTab === "events" && <AgentEventsTab agentId={resolvedAgentId} />}

      {activeTab === "channels" && <AgentChannelsTab agentId={resolvedAgentId} />}

      {activeTab === "tools" && (
        <ToolsDetail agent={agent} resolvedAgentId={resolvedAgentId} showToast={showToast} />
      )}

      {activeTab === "settings" && (
        <SettingsPanel
          agent={agent}
          agentId={agentId}
          resolvedAgentId={resolvedAgentId}
          showToast={showToast}
        />
      )}
    </div>
  );
}

/**
 * Tools detail pane. The tool list lives in the global right rail —
 * this pane shows the selected tool's description and the allow/deny
 * toggle. Without a selection we show a quick overview: how many are
 * enabled and a nudge to pick one.
 */
function ToolsDetail({
  agent,
  resolvedAgentId,
  showToast,
}: {
  agent: ReturnType<typeof useDaemonStore.getState>["agents"][0] | undefined;
  resolvedAgentId: string;
  showToast: (msg: string, isError?: boolean) => void;
}) {
  const { itemId } = useParams<{ itemId?: string }>();
  const selected = itemId ? TOOL_BY_ID[itemId] : null;

  if (!selected) {
    const denied = agent?.tool_deny || [];
    const activeCount = ALL_TOOLS.length - denied.length;
    return (
      <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
        <EmptyState
          title={`${activeCount}/${ALL_TOOLS.length} tools enabled`}
          description="Pick a tool from the right to read its description and toggle access."
        />
      </div>
    );
  }

  const allowed = !agent?.tool_deny?.includes(selected.id);

  const toggle = async () => {
    const current = agent?.tool_deny || [];
    const next = allowed ? [...current, selected.id] : current.filter((t) => t !== selected.id);
    try {
      await api.setAgentTools(resolvedAgentId, next);
      showToast("Tools saved");
    } catch (err) {
      showToast(`Error: ${err instanceof Error ? err.message : "Failed to save tools"}`, true);
    }
  };

  return (
    <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
      <div className="events-detail-header">
        <div>
          <h3 className="events-detail-name">{selected.label}</h3>
          <span className="events-detail-pattern">
            {selected.category} · {selected.id}
          </span>
        </div>
        <Button variant={allowed ? "secondary" : "primary"} onClick={toggle}>
          {allowed ? "Disable" : "Enable"}
        </Button>
      </div>
      <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginTop: 8 }}>
        {selected.description}
      </p>
      <div style={{ marginTop: 16, fontSize: 12, color: "var(--text-muted)" }}>
        Status:{" "}
        <span
          className="agent-settings-status-dot"
          style={{
            display: "inline-block",
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: allowed ? "var(--success)" : "var(--text-muted)",
            marginRight: 6,
            verticalAlign: "middle",
          }}
        />
        {allowed ? "enabled for this agent" : "blocked for this agent"}
      </div>
    </div>
  );
}

function SettingsPanel({
  agent,
  agentId,
  resolvedAgentId,
  showToast,
}: {
  agent: ReturnType<typeof useDaemonStore.getState>["agents"][0] | undefined;
  agentId: string;
  resolvedAgentId: string;
  showToast: (msg: string, isError?: boolean) => void;
}) {
  return (
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
              showToast(`Error: ${err instanceof Error ? err.message : "Failed to save"}`, true);
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
            <span className="agent-settings-value">
              <span className="agent-id-pill">{agent?.id || agentId}</span>
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
  );
}
