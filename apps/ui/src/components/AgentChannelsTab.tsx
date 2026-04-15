import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";

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
  telegram: [{ label: "Bot Token", placeholder: "Paste token from @BotFather", type: "password" }],
  whatsapp: [
    { label: "Account SID", placeholder: "Twilio Account SID" },
    { label: "Auth Token", placeholder: "Twilio Auth Token", type: "password" },
    { label: "Phone Number", placeholder: "+1234567890" },
  ],
};

function fieldKey(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "_");
}

export default function AgentChannelsTab({ agentId }: { agentId: string }) {
  const navigate = useNavigate();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;

  const [channels, setChannels] = useState<ChannelEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelSessions, setChannelSessions] = useState<ChannelSession[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newChannelType, setNewChannelType] = useState("telegram");
  const [newChannelFields, setNewChannelFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadChannels = useCallback(async () => {
    try {
      const data = await api.getAgentChannels(agentId);
      const ideas = (data.ideas || []) as Array<Record<string, unknown>>;
      const parsed: ChannelEntry[] = ideas
        .filter((i) => typeof i.key === "string" && (i.key as string).startsWith("channel:"))
        .map((i) => {
          const key = i.key as string;
          let config: Record<string, unknown> = {};
          try {
            config = JSON.parse(i.content as string);
          } catch {
            config = { raw: i.content };
          }
          return {
            id: i.id as string,
            key,
            content: i.content as string,
            channel_type: key.replace("channel:", ""),
            config,
          };
        });
      setChannels(parsed);
    } catch {
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.getChannelSessions(agentId);
      setChannelSessions((data.sessions || []) as ChannelSession[]);
    } catch {
      setChannelSessions([]);
    }
  }, [agentId]);

  useEffect(() => {
    loadChannels();
    loadSessions();
  }, [loadChannels, loadSessions]);

  const selected = channels.find((c) => c.id === selectedId);

  const handleAdd = async () => {
    setError(null);
    const fields = CHANNEL_FIELDS[newChannelType] || [];
    for (const f of fields) {
      if (!newChannelFields[fieldKey(f.label)]?.trim()) {
        setError(`${f.label} is required`);
        return;
      }
    }
    setSaving(true);
    try {
      await api.createAgentChannel({
        agent_id: agentId,
        channel_type: newChannelType,
        config: newChannelFields,
      });
      setShowAddForm(false);
      setNewChannelFields({});
      loadChannels();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const getChats = (ch: ChannelEntry) =>
    channelSessions.filter((s) => s.transport === ch.channel_type);
  const getAllowed = (ch: ChannelEntry): number[] => {
    const ac = ch.config.allowed_chats;
    if (Array.isArray(ac)) return ac.map(Number).filter((n) => !isNaN(n));
    return [];
  };
  const updateAllowed = async (ch: ChannelEntry, ids: number[]) => {
    const newConfig = { ...ch.config, allowed_chats: ids };
    setChannels((prev) => prev.map((c) => (c.id === ch.id ? { ...c, config: newConfig } : c)));
    api.updateIdea(ch.id, { content: JSON.stringify(newConfig) }).catch(() => {});
  };

  if (loading) return <div className="events-empty">Loading...</div>;

  return (
    <div className="asv">
      <div className="asv-sidebar">
        <div className="asv-sidebar-header">
          <button
            className="asv-session-new-btn"
            onClick={() => {
              setShowAddForm(true);
              setError(null);
            }}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
            Add Channel
          </button>
        </div>
        <div className="asv-sidebar-list">
          {channels.map((ch) => (
            <div
              key={ch.id}
              className={`asv-session-item${ch.id === selectedId ? " active" : ""}`}
              onClick={() => navigate(`/agents/${agentId}/channels/${ch.id}`)}
            >
              <div className="asv-session-item-top">
                <span className="asv-session-item-name">{ch.channel_type}</span>
                <span className="asv-session-item-transport">{ch.channel_type.toUpperCase()}</span>
              </div>
              <div className="asv-session-item-bottom">
                <span className="asv-session-item-preview">Connected</span>
              </div>
            </div>
          ))}
          {channels.length === 0 && !showAddForm && (
            <div className="asv-sidebar-empty">No channels</div>
          )}
        </div>
      </div>

      <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
        {showAddForm ? (
          <div>
            <h3 className="events-detail-name">Add Channel</h3>
            <div className="channel-type-picker" style={{ marginBottom: 12 }}>
              {CHANNEL_TYPES.map((ct) => (
                <button
                  key={ct.value}
                  type="button"
                  className={`channel-type-option ${newChannelType === ct.value ? "active" : ""}`}
                  onClick={() => {
                    setNewChannelType(ct.value);
                    setNewChannelFields({});
                    setError(null);
                  }}
                >
                  {ct.label}
                </button>
              ))}
            </div>
            {(CHANNEL_FIELDS[newChannelType] || []).map((f) => {
              const k = fieldKey(f.label);
              return (
                <div key={k} style={{ marginBottom: 10 }}>
                  <label className="agent-settings-label">{f.label}</label>
                  <input
                    className="agent-settings-input"
                    type={f.type || "text"}
                    placeholder={f.placeholder}
                    value={newChannelFields[k] || ""}
                    style={{ width: "100%", marginTop: 4 }}
                    onChange={(e) => setNewChannelFields((p) => ({ ...p, [k]: e.target.value }))}
                  />
                </div>
              );
            })}
            {error && <div className="channel-form-error">{error}</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary" onClick={handleAdd} disabled={saving}>
                {saving ? "Connecting..." : "Connect"}
              </button>
              <button
                className="btn"
                onClick={() => {
                  setShowAddForm(false);
                  setError(null);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : !selected ? (
          <div className="events-detail-empty">Select a channel or add one</div>
        ) : (
          <>
            <div className="events-detail-header">
              <div>
                <h3 className="events-detail-name">{selected.channel_type}</h3>
                <span className="events-detail-pattern">channel:{selected.channel_type}</span>
              </div>
              <button
                className="btn channel-disconnect-btn"
                onClick={async () => {
                  await api.deleteAgentChannel(selected.id);
                  navigate(`/agents/${agentId}/channels`);
                  loadChannels();
                }}
              >
                Disconnect
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              {Object.entries(selected.config)
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

            {(() => {
              const chats = getChats(selected);
              const allowed = getAllowed(selected);
              const whitelist = allowed.length > 0;
              if (chats.length === 0)
                return <div className="events-detail-loading">No active chats yet.</div>;
              return (
                <div>
                  <div
                    className="events-detail-ideas-header"
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <span>Active Chats ({chats.length})</span>
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontSize: 11,
                        color: "var(--text-muted)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={whitelist}
                        onChange={(e) => {
                          if (e.target.checked) {
                            updateAllowed(
                              selected,
                              chats.map((s) => Number(s.chat_id)).filter((n) => !isNaN(n)),
                            );
                          } else {
                            updateAllowed(selected, []);
                          }
                        }}
                      />
                      Whitelist
                    </label>
                  </div>
                  {chats.map((s) => {
                    const n = Number(s.chat_id);
                    const isAllowed = allowed.includes(n);
                    return (
                      <div
                        key={s.channel_key}
                        className="event-idea-card"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <span className="event-idea-key">{s.chat_id}</span>
                          <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 8 }}>
                            {n < 0 ? "Group" : "DM"}
                          </span>
                        </div>
                        {whitelist ? (
                          <label
                            style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}
                          >
                            <input
                              type="checkbox"
                              checked={isAllowed}
                              onChange={(e) => {
                                updateAllowed(
                                  selected,
                                  e.target.checked
                                    ? [...allowed, n]
                                    : allowed.filter((id) => id !== n),
                                );
                              }}
                            />{" "}
                            Allow
                          </label>
                        ) : (
                          <span style={{ fontSize: 10, color: "var(--text-muted)" }}>Allowed</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
