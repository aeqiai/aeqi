import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentDataStore, type ChannelEntry } from "@/store/agentData";
import { EmptyState } from "./ui";

// Stable empty-array reference — see selector-hygiene.test.ts.
const NO_CHANNELS: ChannelEntry[] = [];

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

/**
 * Channels detail pane. The list is in the global right rail; this
 * component only renders the selected channel's detail view, plus the
 * add-channel form when the rail's "+" button fires `aeqi:new-channel`.
 */
export default function AgentChannelsTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;

  const channels = useAgentDataStore((s) => s.channelsByAgent[agentId] ?? NO_CHANNELS);
  const loadChannels = useAgentDataStore((s) => s.loadChannels);
  const removeChannel = useAgentDataStore((s) => s.removeChannel);

  const [channelSessions, setChannelSessions] = useState<ChannelSession[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newChannelType, setNewChannelType] = useState("telegram");
  const [newChannelFields, setNewChannelFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadChannels(agentId);
  }, [agentId, loadChannels]);

  const loadSessions = useCallback(async () => {
    try {
      const data = await api.getChannelSessions(agentId);
      setChannelSessions((data.sessions || []) as ChannelSession[]);
    } catch {
      setChannelSessions([]);
    }
  }, [agentId]);
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Rail button dispatches `aeqi:new-channel` — show the add form.
  useEffect(() => {
    const handler = () => {
      setShowAddForm(true);
      setError(null);
      setNewChannelFields({});
    };
    window.addEventListener("aeqi:new-channel", handler);
    return () => window.removeEventListener("aeqi:new-channel", handler);
  }, []);

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
      loadChannels(agentId);
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
    // Optimistic: reload after patching via the store (simpler than manual splice).
    api
      .updateIdea(ch.id, { content: JSON.stringify(newConfig) })
      .then(() => loadChannels(agentId))
      .catch(() => {});
  };

  if (showAddForm) {
    return (
      <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
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
    );
  }

  if (!selected) {
    return (
      <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
        <EmptyState
          title="Select a channel"
          description="Pick a channel from the right to view its config, or add one."
        />
      </div>
    );
  }

  const chats = getChats(selected);
  const allowed = getAllowed(selected);
  const whitelist = allowed.length > 0;

  return (
    <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
      <div className="events-detail-header">
        <div>
          <h3 className="events-detail-name">{selected.channel_type}</h3>
          <span className="events-detail-pattern">channel:{selected.channel_type}</span>
        </div>
        <button
          className="btn channel-disconnect-btn"
          onClick={async () => {
            await api.deleteAgentChannel(selected.id);
            removeChannel(agentId, selected.id);
            goAgent(agentId, "channels", undefined, { replace: true });
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

      {chats.length === 0 ? (
        <div className="events-detail-loading">No active chats yet.</div>
      ) : (
        <div>
          <div
            className="events-detail-ideas-header"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
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
                  <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4 }}>
                    <input
                      type="checkbox"
                      checked={isAllowed}
                      onChange={(e) => {
                        updateAllowed(
                          selected,
                          e.target.checked ? [...allowed, n] : allowed.filter((id) => id !== n),
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
      )}
    </div>
  );
}
