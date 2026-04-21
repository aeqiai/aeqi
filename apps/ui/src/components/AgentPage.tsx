import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import AgentSessionView from "./AgentSessionView";
import AgentEventsTab from "./AgentEventsTab";
import AgentChannelsTab from "./AgentChannelsTab";
import AgentIdeasTab from "./AgentIdeasTab";
import AgentQuestsTab from "./AgentQuestsTab";
import AgentOrgChart from "./AgentOrgChart";
import { Button, EmptyState } from "./ui";
import { ALL_TOOLS, TOOL_BY_ID } from "@/lib/tools";

const SETTINGS_SUB_TABS = [
  { id: "settings", label: "Settings" },
  { id: "channels", label: "Channels" },
  { id: "tools", label: "Tools" },
] as const;

// Routes that AgentPage knows how to render. No-tab resolves to the Inbox
// (id "sessions") — the agent's landing surface. ContentTopBar is the primary
// nav and lives outside of this component.
const TABS = [
  { id: "sessions", label: "Inbox" },
  { id: "settings", label: "Settings" },
  { id: "agents", label: "Agents" },
  { id: "events", label: "Events" },
  { id: "channels", label: "Channels" },
  { id: "quests", label: "Quests" },
  { id: "ideas", label: "Ideas" },
  { id: "tools", label: "Tools" },
];

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
  const agent = agents.find((a) => a.id === agentId || a.name === agentId);

  const resolvedAgentId = agent?.id || agentId;

  // Child agents for the "agents" tab
  const childAgents = agents.filter((a) => a.parent_id === agent?.id);

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
      {activeTab === "sessions" && (
        <div className="agent-page-chat">
          <AgentSessionView agentId={agentId} sessionId={sessionId} />
        </div>
      )}

      {activeTab === "agents" && (
        <AgentsTab
          parentAgentId={resolvedAgentId}
          childAgents={childAgents}
          onSelectChild={(id) => goAgent(id)}
        />
      )}

      {activeTab === "quests" && <AgentQuestsTab agentId={resolvedAgentId} />}

      {activeTab === "ideas" && <AgentIdeasTab agentId={resolvedAgentId} />}

      {activeTab === "events" && <AgentEventsTab agentId={resolvedAgentId} />}

      {(activeTab === "settings" || activeTab === "channels" || activeTab === "tools") && (
        <SettingsShell activeSubTab={activeTab}>
          {activeTab === "settings" && (
            <SettingsPanel
              agent={agent}
              agentId={agentId}
              resolvedAgentId={resolvedAgentId}
              showToast={showToast}
            />
          )}
          {activeTab === "channels" && <AgentChannelsTab agentId={resolvedAgentId} />}
          {activeTab === "tools" && (
            <ToolsDetail agent={agent} resolvedAgentId={resolvedAgentId} showToast={showToast} />
          )}
        </SettingsShell>
      )}
    </div>
  );
}

/**
 * Agents sub-tab. Listens for the shared `aeqi:create` event (fired by the
 * right-rail "New agent" CTA) and navigates to the full-page spawn flow at
 * `/new?parent=<parentAgentId>`. Creating an agent is a first-class act —
 * it gets a page, not a modal.
 */
function AgentsTab({
  parentAgentId,
  childAgents,
  onSelectChild,
}: {
  parentAgentId: string;
  childAgents: ReturnType<typeof useDaemonStore.getState>["agents"];
  onSelectChild: (id: string) => void;
}) {
  const navigate = useNavigate();
  const goToSpawn = useCallback(
    () => navigate(`/new?parent=${encodeURIComponent(parentAgentId)}`),
    [navigate, parentAgentId],
  );
  useEffect(() => {
    window.addEventListener("aeqi:create", goToSpawn);
    return () => window.removeEventListener("aeqi:create", goToSpawn);
  }, [goToSpawn]);

  return (
    <div className="page-content" style={{ padding: 0 }}>
      {childAgents.length > 0 ? (
        <AgentOrgChart parentAgentId={parentAgentId} onSelect={onSelectChild} />
      ) : (
        <div style={{ padding: 16 }}>
          <EmptyState
            eyebrow="Agents"
            title="No sub-agents yet"
            description="Spawn one from the right rail — it joins the org chart as a direct report."
          />
        </div>
      )}
    </div>
  );
}

/**
 * Settings umbrella. Renders a hairline tab row across Settings / Channels /
 * Tools — the three "configure how this agent works" panes. Sidebar only shows
 * "Settings"; Channels + Tools are reached via this tab row (or directly by
 * URL — /channels and /tools still work as entry points).
 */
function SettingsShell({
  activeSubTab,
  children,
}: {
  activeSubTab: string;
  children: React.ReactNode;
}) {
  const { goAgent, agentId } = useNav();
  return (
    <div className="settings-shell">
      <div className="settings-shell-tabs">
        {SETTINGS_SUB_TABS.map((t) => (
          <button
            key={t.id}
            className={`settings-shell-tab${activeSubTab === t.id ? " active" : ""}`}
            onClick={() => agentId && goAgent(agentId, t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="settings-shell-body">{children}</div>
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
