import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import PageTabs, { useActiveTab } from "./PageTabs";
import AgentSessionView from "./AgentSessionView";
import RoundAvatar from "./RoundAvatar";

const TABS = [
  { id: "chat", label: "Chat" },
  { id: "channels", label: "Channels" },
  { id: "settings", label: "Settings" },
];

interface ChannelEntry {
  id: string;
  key: string;
  content: string;
  channel_type: string;
  config: Record<string, string>;
}

const CHANNEL_TYPES = [
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
] as const;

const CHANNEL_FIELDS: Record<string, { label: string; placeholder: string; type?: string }[]> = {
  telegram: [
    { label: "Bot Token", placeholder: "Paste token from @BotFather", type: "password" },
  ],
  whatsapp: [
    { label: "Account SID", placeholder: "Twilio Account SID" },
    { label: "Auth Token", placeholder: "Twilio Auth Token", type: "password" },
    { label: "Phone Number", placeholder: "+1234567890" },
  ],
};

function fieldKey(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "_");
}

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
  const [params] = useSearchParams();
  const sessionId = params.get("session");
  const activeTab = useActiveTab(TABS, "chat");

  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const displayName = agent?.display_name || agent?.name || agentId;
  const parent = agent?.parent_id
    ? agents.find((a) => a.id === agent.parent_id)
    : null;

  // -- Channels state --
  const [channels, setChannels] = useState<ChannelEntry[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newChannelType, setNewChannelType] = useState<string>("telegram");
  const [newChannelFields, setNewChannelFields] = useState<Record<string, string>>({});
  const [channelSaving, setChannelSaving] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  const resolvedAgentId = agent?.id || agentId;

  const loadChannels = useCallback(async () => {
    setChannelsLoading(true);
    try {
      const data = await api.getAgentChannels(resolvedAgentId);
      const ideas = (data.ideas || []) as Array<Record<string, unknown>>;
      const parsed: ChannelEntry[] = ideas
        .filter((i) => typeof i.key === "string" && (i.key as string).startsWith("channel:"))
        .map((i) => {
          const key = i.key as string;
          const channelType = key.replace("channel:", "");
          let config: Record<string, string> = {};
          try {
            config = JSON.parse(i.content as string);
          } catch {
            config = { raw: i.content as string };
          }
          return {
            id: i.id as string,
            key,
            content: i.content as string,
            channel_type: channelType,
            config,
          };
        });
      setChannels(parsed);
    } catch {
      setChannels([]);
    } finally {
      setChannelsLoading(false);
    }
  }, [resolvedAgentId]);

  useEffect(() => {
    if (activeTab === "channels") {
      loadChannels();
    }
  }, [activeTab, loadChannels]);

  const handleAddChannel = async () => {
    setChannelError(null);
    const fields = CHANNEL_FIELDS[newChannelType] || [];
    for (const f of fields) {
      const k = fieldKey(f.label);
      if (!newChannelFields[k]?.trim()) {
        setChannelError(`${f.label} is required`);
        return;
      }
    }
    setChannelSaving(true);
    try {
      await api.createAgentChannel({
        agent_id: resolvedAgentId,
        channel_type: newChannelType,
        config: newChannelFields,
      });
      setShowAddForm(false);
      setNewChannelFields({});
      await loadChannels();
    } catch (e) {
      setChannelError(e instanceof Error ? e.message : "Failed to connect channel");
    } finally {
      setChannelSaving(false);
    }
  };

  const handleDeleteChannel = async (id: string) => {
    try {
      await api.deleteAgentChannel(id);
      await loadChannels();
    } catch {
      // Silently fail — the channel list will refresh on next load.
    }
  };

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

      {activeTab === "channels" && (
        <div className="agent-page-channels">
          <div className="agent-settings-section">
            <div className="channels-header">
              <h3 className="agent-settings-heading">Connected Channels</h3>
              {!showAddForm && (
                <button
                  className="channels-add-btn"
                  onClick={() => { setShowAddForm(true); setChannelError(null); }}
                >
                  Add Channel
                </button>
              )}
            </div>

            {channelsLoading && <div className="channels-empty">Loading...</div>}

            {!channelsLoading && channels.length === 0 && !showAddForm && (
              <div className="channels-empty">
                No channels connected. Add a Telegram bot or WhatsApp number to enable messaging.
              </div>
            )}

            {channels.map((ch) => (
              <div key={ch.id} className="channel-card">
                <div className="channel-card-header">
                  <span className="channel-card-type">{ch.channel_type}</span>
                  <span className="channel-card-status connected">Connected</span>
                </div>
                <div className="channel-card-details">
                  {Object.entries(ch.config).map(([k, v]) => (
                    <div key={k} className="agent-settings-field">
                      <span className="agent-settings-label">{k.replace(/_/g, " ")}</span>
                      <span className="agent-settings-value agent-settings-mono">
                        {k.includes("token") || k.includes("auth") || k.includes("sid")
                          ? `${String(v).slice(0, 8)}...`
                          : v}
                      </span>
                    </div>
                  ))}
                </div>
                <button
                  className="channel-disconnect-btn"
                  onClick={() => handleDeleteChannel(ch.id)}
                >
                  Disconnect
                </button>
              </div>
            ))}
          </div>

          {showAddForm && (
            <div className="agent-settings-section">
              <h3 className="agent-settings-heading">Add Channel</h3>
              <div className="channel-form">
                <div className="channel-form-field">
                  <label className="agent-settings-label">Type</label>
                  <select
                    className="channel-form-select"
                    value={newChannelType}
                    onChange={(e) => {
                      setNewChannelType(e.target.value);
                      setNewChannelFields({});
                      setChannelError(null);
                    }}
                  >
                    {CHANNEL_TYPES.map((ct) => (
                      <option key={ct.value} value={ct.value}>{ct.label}</option>
                    ))}
                  </select>
                </div>

                {(CHANNEL_FIELDS[newChannelType] || []).map((f) => {
                  const k = fieldKey(f.label);
                  return (
                    <div key={k} className="channel-form-field">
                      <label className="agent-settings-label">{f.label}</label>
                      <input
                        className="channel-form-input"
                        type={f.type || "text"}
                        placeholder={f.placeholder}
                        value={newChannelFields[k] || ""}
                        onChange={(e) =>
                          setNewChannelFields((prev) => ({ ...prev, [k]: e.target.value }))
                        }
                      />
                    </div>
                  );
                })}

                {channelError && <div className="channel-form-error">{channelError}</div>}

                <div className="channel-form-actions">
                  <button
                    className="channels-add-btn"
                    onClick={handleAddChannel}
                    disabled={channelSaving}
                  >
                    {channelSaving ? "Connecting..." : "Connect"}
                  </button>
                  <button
                    className="channel-cancel-btn"
                    onClick={() => { setShowAddForm(false); setChannelError(null); }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "settings" && (
        <div className="agent-page-settings">
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
                      onClick={() => navigate(`/agents?agent=${encodeURIComponent(parent.id)}`)}
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
                            onClick={() => navigate(`/agents?agent=${encodeURIComponent(child.id)}`)}
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
                  <span className={`agent-settings-status-dot ${agent?.status === "active" ? "live" : ""}`} />
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
                <span className="agent-settings-value agent-settings-mono">{agent?.id || agentId}</span>
              </div>
              {agent?.created_at && (
                <div className="agent-settings-field">
                  <span className="agent-settings-label">Created</span>
                  <span className="agent-settings-value">
                    {new Date(agent.created_at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}
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
