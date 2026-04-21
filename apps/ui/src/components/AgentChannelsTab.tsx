import { useEffect, useRef, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { useAgentDataStore, type ChannelEntry } from "@/store/agentData";
import { Button } from "./ui";
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
  // Baileys has no pre-connection fields — pairing is a QR handshake that
  // happens after the channel row is created. The Add form shows a
  // short explanation instead of inputs.
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
      // No pre-pair fields. Session dir defaults server-side, and any
      // JID whitelist is added later via the allowed_chats mechanism.
      return { kind, allowed_jids: [] };
    default:
      return { kind, ...fields };
  }
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

  // Rail button dispatches `aeqi:new-channel` — show the add form.
  useEffect(() => {
    const handler = () => {
      setShowAddForm(true);
      setError(null);
      setNewChannelFields({});
      setSaving(false); // Reset stale "Connecting..." if a prior submit hung.
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
  const getAllowed = (ch: ChannelEntry): number[] =>
    ch.allowed_chats.map(Number).filter((n) => !isNaN(n));
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
  const updateAllowed = async (channelId: string, reducer: (current: string[]) => string[]) => {
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
            {saving ? "Connecting..." : "Connect"}
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
          {deleting ? "Disconnecting..." : "Disconnect"}
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
                    const allChats = chats
                      .map((s) => String(Number(s.chat_id)))
                      .filter((n) => n !== "NaN");
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
                        const add = e.target.checked;
                        const asStr = String(n);
                        updateAllowed(selected.id, (current) =>
                          add ? [...current, asStr] : current.filter((v) => v !== asStr),
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
