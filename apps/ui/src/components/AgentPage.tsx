import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import PageTabs, { useActiveTab } from "./PageTabs";
import AgentSessionView from "./AgentSessionView";
import RoundAvatar from "./RoundAvatar";

const TABS = [
  { id: "chat", label: "Chat" },
  { id: "events", label: "Events" },
  { id: "channels", label: "Channels" },
  { id: "settings", label: "Settings" },
];

interface ChannelEntry {
  id: string;
  key: string;
  content: string;
  channel_type: string;
  config: Record<string, unknown>;
}

interface ChannelSession {
  channel_key: string;
  session_id: string;
  chat_id: string;
  transport: string;
  created_at: string;
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

  // -- Events state --
  interface AgentEvent {
    id: string;
    name: string;
    pattern: string;
    scope: string;
    idea_ids: string[];
    enabled: boolean;
    cooldown_secs: number;
    fire_count: number;
    last_fired?: string;
    system: boolean;
  }
  interface IdeaPreview {
    id: string;
    key: string;
    content: string;
    tags: string[];
  }
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [expandedEvent, setExpandedEvent] = useState<string | null>(null);
  const [eventIdeas, setEventIdeas] = useState<Record<string, IdeaPreview[]>>({});

  // -- Channels state --
  const [channels, setChannels] = useState<ChannelEntry[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newChannelType, setNewChannelType] = useState<string>("telegram");
  const [newChannelFields, setNewChannelFields] = useState<Record<string, string>>({});
  const [channelSaving, setChannelSaving] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [channelSessions, setChannelSessions] = useState<ChannelSession[]>([]);

  const resolvedAgentId = agent?.id || agentId;

  const loadChannels = useCallback(async (showLoading = true) => {
    if (showLoading) setChannelsLoading(true);
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

  const loadChannelSessions = useCallback(async () => {
    try {
      const data = await api.getChannelSessions(resolvedAgentId);
      const sessions = (data.sessions || []) as ChannelSession[];
      setChannelSessions(sessions);
    } catch {
      setChannelSessions([]);
    }
  }, [resolvedAgentId]);

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const data = await api.getAgentEvents(resolvedAgentId);
      setEvents((data.events as AgentEvent[]) || []);
    } catch {
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [resolvedAgentId]);

  useEffect(() => {
    if (activeTab === "events") {
      loadEvents();
    }
    if (activeTab === "channels") {
      loadChannels();
      loadChannelSessions();
    }
  }, [activeTab, loadChannels, loadChannelSessions]);

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

  const updateAllowedChats = async (channel: ChannelEntry, allowedChats: number[]) => {
    const newConfig = { ...channel.config, allowed_chats: allowedChats };
    // Optimistic update — change local state immediately, no loading flicker.
    setChannels((prev) =>
      prev.map((ch) =>
        ch.id === channel.id ? { ...ch, config: newConfig } : ch,
      ),
    );
    // Fire and forget — optimistic state is already set.
    api.updateIdea(channel.id, { content: JSON.stringify(newConfig) }).catch(() => {});
  };

  const getChannelAllowedChats = (ch: ChannelEntry): number[] => {
    const ac = ch.config.allowed_chats;
    if (Array.isArray(ac)) return ac.map(Number).filter((n) => !isNaN(n));
    return [];
  };

  const isWhitelistMode = (ch: ChannelEntry): boolean => {
    return getChannelAllowedChats(ch).length > 0;
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

      {activeTab === "events" && (
        <div className="agent-page-events">
          {eventsLoading && <div className="events-empty">Loading...</div>}
          {!eventsLoading && events.length === 0 && (
            <div className="events-empty">No events configured.</div>
          )}
          {events.map((ev) => {
            const prefix = ev.pattern.split(":")[0];
            const typeLabel = prefix === "session" ? "Session" : prefix === "schedule" ? "Schedule" : prefix === "webhook" ? "Webhook" : prefix;
            const isExpanded = expandedEvent === ev.id;
            const ideas = eventIdeas[ev.id] || [];
            return (
              <div key={ev.id} className={`event-row${ev.enabled ? "" : " event-row--disabled"}${isExpanded ? " event-row--expanded" : ""}`}>
                <div
                  className="event-row-header"
                  onClick={async () => {
                    if (isExpanded) {
                      setExpandedEvent(null);
                    } else {
                      setExpandedEvent(ev.id);
                      if (!eventIdeas[ev.id] && ev.idea_ids.length > 0) {
                        try {
                          const data = await api.getAgentEvents(resolvedAgentId);
                          const fullEv = ((data.events || []) as AgentEvent[]).find((e) => e.id === ev.id);
                          if (fullEv) {
                            const ideaResults = await Promise.all(
                              fullEv.idea_ids.map((iid) =>
                                api.getSessionMessages({ session_id: iid }).catch(() => null)
                              )
                            );
                            // Try to fetch ideas by ID via search
                            const searchResult = await api.getSessionMessages({ session_id: "", limit: 0 }).catch(() => null);
                            // For now just show the idea IDs — full idea fetch needs a dedicated endpoint
                            setEventIdeas((prev) => ({
                              ...prev,
                              [ev.id]: fullEv.idea_ids.map((iid) => ({
                                id: iid,
                                key: iid.slice(0, 8),
                                content: "",
                                tags: [],
                              })),
                            }));
                          }
                        } catch { /* ignore */ }
                      }
                    }
                  }}
                >
                  <div className="event-row-left">
                    <span className="event-row-type">{typeLabel}</span>
                    <div className="event-row-info">
                      <span className="event-row-name">{ev.name}</span>
                      <span className="event-row-pattern">{ev.pattern}</span>
                    </div>
                  </div>
                  <div className="event-row-right">
                    {ev.idea_ids.length > 0 && (
                      <span className="event-row-meta">{ev.idea_ids.length} ideas</span>
                    )}
                    {ev.fire_count > 0 && (
                      <span className="event-row-meta">{ev.fire_count}x{ev.last_fired ? ` · ${timeAgo(ev.last_fired)}` : ""}</span>
                    )}
                    <button
                      className="event-row-toggle"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await api.updateEvent(ev.id, { enabled: !ev.enabled });
                        loadEvents();
                      }}
                    >
                      {ev.enabled ? "Disable" : "Enable"}
                    </button>
                    {!ev.system && (
                      <button
                        className="event-row-delete"
                        onClick={async (e) => {
                          e.stopPropagation();
                          await api.deleteEvent(ev.id);
                          loadEvents();
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                {isExpanded && (
                  <div className="event-row-detail">
                    <div className="event-detail-section">
                      <span className="event-detail-label">Scope</span>
                      <span className="event-detail-value">{ev.scope}</span>
                    </div>
                    {ev.cooldown_secs > 0 && (
                      <div className="event-detail-section">
                        <span className="event-detail-label">Cooldown</span>
                        <span className="event-detail-value">{ev.cooldown_secs}s</span>
                      </div>
                    )}
                    {ev.idea_ids.length > 0 && (
                      <div className="event-detail-section">
                        <span className="event-detail-label">Injected Ideas</span>
                        <div className="event-detail-ideas">
                          {ev.idea_ids.map((iid) => (
                            <span key={iid} className="event-detail-idea-id">{iid.slice(0, 12)}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {ev.idea_ids.length === 0 && (
                      <div className="event-detail-section">
                        <span className="event-detail-label">Injected Ideas</span>
                        <span className="event-detail-value event-detail-value--muted">None</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {activeTab === "channels" && (
        <div className="agent-page-channels">
          <div className="agent-settings-section">
            <div className="channels-header">
              <h3 className="agent-settings-heading">Connected Channels</h3>
              {!showAddForm && (
                <button
                  className="btn"
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

            {channels.map((ch) => {
              const sessionsForChannel = channelSessions.filter(
                (s) => s.transport === ch.channel_type,
              );
              const allowedChats = getChannelAllowedChats(ch);
              const whitelist = isWhitelistMode(ch);

              return (
                <div key={ch.id} className="channel-card">
                  <div className="channel-card-header">
                    <span className="channel-card-type">{ch.channel_type}</span>
                    <span className="channel-card-status connected">Connected</span>
                  </div>
                  <div className="channel-card-details">
                    {Object.entries(ch.config)
                      .filter(([k]) => k !== "allowed_chats")
                      .map(([k, v]) => (
                        <div key={k} className="agent-settings-field">
                          <span className="agent-settings-label">{k.replace(/_/g, " ")}</span>
                          <span className="agent-settings-value agent-settings-mono">
                            {k.includes("token") || k.includes("auth") || k.includes("sid")
                              ? `${String(v).slice(0, 8)}...`
                              : String(v)}
                          </span>
                        </div>
                      ))}
                  </div>

                  {sessionsForChannel.length > 0 && (
                    <div className="channel-chats-section">
                      <div className="channel-chats-header">
                        <span className="channel-chats-title">Active Chats</span>
                        <label className="channel-whitelist-toggle">
                          <input
                            type="checkbox"
                            checked={whitelist}
                            onChange={(e) => {
                              if (e.target.checked) {
                                // Turn ON: whitelist all current chats
                                const allIds = sessionsForChannel.map((s) =>
                                  Number(s.chat_id),
                                ).filter((n) => !isNaN(n));
                                updateAllowedChats(ch, allIds);
                              } else {
                                // Turn OFF: clear allowed_chats
                                updateAllowedChats(ch, []);
                              }
                            }}
                          />
                          <span className="channel-whitelist-label">
                            Whitelist mode
                          </span>
                        </label>
                      </div>
                      <div className="channel-chats-list">
                        {sessionsForChannel.map((s) => {
                          const chatNum = Number(s.chat_id);
                          const isGroup = !isNaN(chatNum) && chatNum < 0;
                          const isAllowed = allowedChats.includes(chatNum);
                          return (
                            <div key={s.channel_key} className="channel-chat-row">
                              <span className="channel-chat-id agent-settings-mono">
                                {s.chat_id}
                              </span>
                              <span className="channel-chat-label">
                                {isGroup ? "Group" : "DM"}
                              </span>
                              {whitelist && (
                                <label className="channel-chat-allow">
                                  <input
                                    type="checkbox"
                                    checked={isAllowed}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? [...allowedChats, chatNum]
                                        : allowedChats.filter((id) => id !== chatNum);
                                      updateAllowedChats(ch, next);
                                    }}
                                  />
                                  Allow
                                </label>
                              )}
                              {!whitelist && (
                                <span className="channel-chat-allow-all">Allowed</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <button
                    className="btn channel-disconnect-btn"
                    onClick={() => handleDeleteChannel(ch.id)}
                  >
                    Disconnect
                  </button>
                </div>
              );
            })}
          </div>

          {showAddForm && (
            <div className="agent-settings-section">
              <h3 className="agent-settings-heading">Add Channel</h3>
              <div className="channel-form">
                <div className="channel-type-picker">
                  {CHANNEL_TYPES.map((ct) => (
                    <button
                      key={ct.value}
                      type="button"
                      className={`channel-type-option ${newChannelType === ct.value ? "active" : ""}`}
                      onClick={() => {
                        setNewChannelType(ct.value);
                        setNewChannelFields({});
                        setChannelError(null);
                      }}
                    >
                      {ct.label}
                    </button>
                  ))}
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
                    className="btn btn-primary"
                    onClick={handleAddChannel}
                    disabled={channelSaving}
                  >
                    {channelSaving ? "Connecting..." : "Connect"}
                  </button>
                  <button
                    className="btn"
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
          {/* Model */}
          <div className="agent-settings-section">
            <h3 className="agent-settings-heading">Model</h3>
            <div className="agent-settings-grid">
              <div className="agent-settings-field">
                <span className="agent-settings-label">Current model</span>
                <span className="agent-settings-value agent-settings-mono">
                  {agent?.model || "inherited from config"}
                </span>
              </div>
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
