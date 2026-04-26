import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentDataStore, type AllowedChat, type ChannelEntry } from "@/store/agentData";
import { Button, EmptyState } from "./ui";
import { BaileysPairingPanel } from "./BaileysPairingPanel";

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
  { value: "whatsapp", label: "WhatsApp Cloud" },
  { value: "whatsapp-baileys", label: "WhatsApp (QR pair)" },
] as const;

const CHANNEL_FIELDS: Record<string, { label: string; placeholder: string; type?: string }[]> = {
  telegram: [{ label: "Bot Token", placeholder: "Paste token from @BotFather", type: "password" }],
  whatsapp: [
    { label: "Phone Number ID", placeholder: "Meta WhatsApp Phone Number ID" },
    { label: "Access Token", placeholder: "Meta Graph API access token", type: "password" },
  ],
  // Baileys pairs via QR after row creation — no pre-pair inputs needed.
  "whatsapp-baileys": [],
};

function fieldKey(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "_");
}

/** Convert the form's flat {field: value} dict into the tagged config
 *  the backend expects (`{kind: "telegram", token: "..."}`). */
function buildConfig(
  kind: string,
  fields: Record<string, string>,
): Record<string, unknown> & { kind: string } {
  switch (kind) {
    case "telegram":
      return { kind, token: fields.bot_token ?? "" };
    case "whatsapp":
      return {
        kind,
        phone_number_id: fields.phone_number_id ?? "",
        access_token: fields.access_token ?? "",
      };
    case "whatsapp-baileys":
      return { kind, allowed_jids: [] };
    default:
      return { kind, ...fields };
  }
}

export default function AgentChannelsTab({ agentId }: { agentId: string }) {
  const { goAgent } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const selectedId = itemId || null;

  const channels = useAgentDataStore((s) => s.channelsByAgent[agentId] ?? NO_CHANNELS);
  const loadChannels = useAgentDataStore((s) => s.loadChannels);
  const removeChannel = useAgentDataStore((s) => s.removeChannel);
  const patchChannel = useAgentDataStore((s) => s.patchChannel);

  const [channelSessions, setChannelSessions] = useState<ChannelSession[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newChannelType, setNewChannelType] = useState("telegram");
  const [newChannelFields, setNewChannelFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monotonic seq for whitelist PATCHes. Rapid clicks fire overlapping
  // requests; only the response from the latest click should win (older
  // responses arrive stale and would flip the UI back). We bump the seq on
  // each call and compare on completion — late responses are dropped.
  const allowedSeqRef = useRef(0);

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

  useEffect(() => {
    const handler = () => {
      setShowAddForm(true);
      setError(null);
      setNewChannelFields({});
      setSaving(false); // Reset stale "Connecting…" if a prior submit hung.
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
        config: buildConfig(newChannelType, newChannelFields),
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

  const getChats = (ch: ChannelEntry) => channelSessions.filter((s) => s.transport === ch.kind);
  // `chat_id` is TEXT server-side (see agent_registry.rs: "every transport
  // fits — Telegram i64, WhatsApp JID, Discord snowflake, phone numbers").
  // Compare as strings, never coerce to Number — WhatsApp JIDs like
  // `[email protected]` and `[email protected]` parse to NaN and would
  // silently drop from the whitelist.
  const getAllowed = (ch: ChannelEntry): AllowedChat[] => ch.allowed_chats;
  type ChatMode = "auto" | "read" | "off";
  const chatModeFor = (allowed: AllowedChat[], chatId: string): ChatMode => {
    const entry = allowed.find((a) => a.chat_id === chatId);
    if (!entry) return "off";
    return entry.reply_allowed ? "auto" : "read";
  };
  /**
   * Transport-aware DM/Group label. Telegram chat_ids are signed integers
   * (negative = group / channel, positive = DM). WhatsApp uses JIDs that
   * end in `@g.us` for groups, `@s.whatsapp.net` / `@lid` for DMs. Other
   * transports may fit either shape; default to no label rather than guess
   * wrong.
   */
  const chatKindLabel = (transport: string, chatId: string): string | null => {
    if (transport.startsWith("whatsapp")) {
      if (chatId.endsWith("@g.us")) return "Group";
      if (chatId.endsWith("@s.whatsapp.net") || chatId.endsWith("@lid")) return "DM";
      return null;
    }
    if (transport === "telegram") {
      const n = Number(chatId);
      if (!Number.isFinite(n)) return null;
      return n < 0 ? "Group" : "DM";
    }
    return null;
  };
  /**
   * Apply a change to the allowed_chats whitelist. Takes a reducer that's
   * evaluated against the latest store state at the moment of the call —
   * NOT against a snapshot captured in the JSX closure. That distinction
   * matters: rapid clicks on different rows would otherwise both read the
   * same pre-click `allowed` and one update would clobber the other.
   * On error we don't try to hand-roll a rollback (concurrent successful
   * calls make that hard to get right); we refetch from the server, which
   * is the one source of truth and costs one extra round-trip on the
   * (rare) failure path.
   */
  const updateAllowed = async (
    channelId: string,
    reducer: (current: AllowedChat[]) => AllowedChat[],
  ) => {
    const storeState = useAgentDataStore.getState();
    const ch = storeState.channelsByAgent[agentId]?.find((c) => c.id === channelId);
    if (!ch) return;
    const next = reducer(ch.allowed_chats);
    patchChannel(agentId, channelId, { allowed_chats: next });
    // Rapid clicks fire overlapping PATCHes. Record our seq at dispatch and
    // ignore our error handler if a newer call has already fired — old
    // failures would otherwise trigger a refetch that races the newer call.
    const mySeq = ++allowedSeqRef.current;
    try {
      await api.setChannelAllowedChats(channelId, next);
    } catch (e) {
      if (mySeq !== allowedSeqRef.current) return; // superseded
      setError(e instanceof Error ? e.message : "Failed to update whitelist");
      // Refetch — authoritative truth trumps guessing at rollback state.
      loadChannels(agentId);
    }
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
        {newChannelType === "whatsapp-baileys" && (
          <p className="channel-form-hint">
            Pairing is done by scanning a QR code with WhatsApp on your phone. After you press
            Connect, a QR will appear on this channel's detail page. The session is stored on the
            server and survives restarts.
          </p>
        )}
        {error && <div className="channel-form-error">{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <Button variant="primary" onClick={handleAdd} loading={saving} disabled={saving}>
            Connect
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              setShowAddForm(false);
              setError(null);
            }}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  if (!selected) {
    const fireNew = () => window.dispatchEvent(new CustomEvent("aeqi:new-channel"));
    return (
      <div className="asv-main channels-list" style={{ overflowY: "auto" }}>
        {channels.length === 0 ? (
          <button type="button" className="inline-picker-empty-cta" onClick={fireNew}>
            <span className="inline-picker-empty-cta-label">No channels yet</span>
            <span className="inline-picker-empty-cta-hint">Add channel</span>
          </button>
        ) : (
          <>
            <div className="inline-picker-group">
              <span className="inline-picker-group-label">connected</span>
              <span className="inline-picker-group-rule" />
              <span className="inline-picker-group-count">{channels.length}</span>
            </div>
            {channels.map((c) => {
              const chats = getChats(c);
              return (
                <button
                  key={c.id}
                  type="button"
                  className="channels-list-row"
                  onClick={() => goAgent(agentId, "channels", c.id)}
                >
                  <span className="channels-list-row-kind">{c.kind.toUpperCase()}</span>
                  <span className="channels-list-row-name">channel:{c.kind}</span>
                  <span
                    className={`channels-list-row-dot${c.enabled ? " is-on" : ""}`}
                    aria-hidden
                  />
                  <span className="channels-list-row-meta">
                    {chats.length > 0
                      ? `${chats.length} chat${chats.length === 1 ? "" : "s"}`
                      : c.allowed_chats.length > 0
                        ? `${c.allowed_chats.length} allowed`
                        : "idle"}
                  </span>
                </button>
              );
            })}
          </>
        )}
      </div>
    );
  }

  const chats = getChats(selected);
  const allowed = getAllowed(selected);
  const whitelist = allowed.length > 0;

  return (
    <div className="asv-main" style={{ padding: "20px 28px", overflowY: "auto" }}>
      {error && (
        <div
          className="channel-form-error"
          role="alert"
          style={{ marginBottom: 12, display: "flex", justifyContent: "space-between", gap: 8 }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "inherit",
              padding: 0,
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}
      <div className="events-detail-header">
        <div>
          <h3 className="events-detail-name">{selected.kind}</h3>
          <span className="events-detail-pattern">channel:{selected.kind}</span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="channel-disconnect-btn"
          aria-label={`Disconnect ${selected.kind} channel`}
          disabled={deleting}
          loading={deleting}
          onClick={async () => {
            if (deleting) return;
            setDeleting(true);
            setError(null);
            try {
              await api.deleteAgentChannel(selected.id);
              removeChannel(agentId, selected.id);
              goAgent(agentId, "channels", undefined, { replace: true });
            } catch (e) {
              setError(e instanceof Error ? e.message : "Failed to disconnect");
              setDeleting(false);
            }
            // On success the component unmounts via navigation, so no need
            // to reset deleting — setting it would warn about unmounted
            // state updates.
          }}
        >
          Disconnect
        </Button>
      </div>

      <div style={{ marginBottom: 16 }}>
        {Object.entries(selected.config)
          .filter(([k]) => k !== "allowed_chats" && k !== "allowed_jids")
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

      {selected.kind === "whatsapp-baileys" && <BaileysPairingPanel channelId={selected.id} />}

      {chats.length === 0 ? (
        <EmptyState
          eyebrow="chats"
          title="No active chats yet"
          description="Messages on this channel will show up here once they arrive."
        />
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
                    // Use `chat_id` as-is. Coercing to Number drops every
                    // WhatsApp JID and any non-numeric chat_id (the bug
                    // that made this toggle no-op for WhatsApp). New entries
                    // default to `reply_allowed: true` (auto-reply); the
                    // user can demote to read-only per-row below.
                    const allChats: AllowedChat[] = chats
                      .map((s) => s.chat_id)
                      .filter(Boolean)
                      .map((chat_id) => ({ chat_id, reply_allowed: true }));
                    updateAllowed(selected.id, () => allChats);
                  } else {
                    // Turning whitelist OFF clears the entire server-side
                    // list — confirm first if there was a non-empty one.
                    if (
                      selected.allowed_chats.length > 0 &&
                      !window.confirm(
                        `Turn off whitelist for ${selected.kind}? This will clear ${selected.allowed_chats.length} allowed chat(s).`,
                      )
                    ) {
                      return;
                    }
                    updateAllowed(selected.id, () => []);
                  }
                }}
              />
              Whitelist
            </label>
          </div>
          <p className="agent-settings-hint" style={{ marginTop: 4, marginBottom: 8 }}>
            <strong>Auto-reply</strong> = agent answers automatically. <strong>Read-only</strong> =
            messages arrive, agent stays silent. <strong>Off</strong> = drop entirely.
          </p>
          {chats.map((s) => {
            const mode = chatModeFor(allowed, s.chat_id);
            const kindLabel = chatKindLabel(s.transport, s.chat_id);
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
                  {kindLabel && (
                    <span style={{ fontSize: 10, color: "var(--text-muted)", marginLeft: 8 }}>
                      {kindLabel}
                    </span>
                  )}
                </div>
                {whitelist ? (
                  <select
                    aria-label={`Reply mode for ${s.chat_id}`}
                    className="agent-settings-input"
                    style={{ fontSize: 11, padding: "2px 6px", width: "auto" }}
                    value={mode}
                    onChange={(e) => {
                      const next = e.target.value as ChatMode;
                      updateAllowed(selected.id, (current) => {
                        const without = current.filter((v) => v.chat_id !== s.chat_id);
                        if (next === "off") return without;
                        return [...without, { chat_id: s.chat_id, reply_allowed: next === "auto" }];
                      });
                    }}
                  >
                    <option value="auto">Auto-reply</option>
                    <option value="read">Read-only</option>
                    <option value="off">Off</option>
                  </select>
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
