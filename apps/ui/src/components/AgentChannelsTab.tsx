import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Plus, Waypoints } from "lucide-react";
import { useNav } from "@/hooks/useNav";
import * as channelsApi from "@/api/channels";
import type { AllowedChat, ChannelEntry } from "@/api/channels";
import { useAgentChannels, useAgentChannelsCache, useChannelSessions } from "@/queries/channels";
import {
  Button,
  CardTrigger,
  EmptyState,
  Input,
  Modal,
  PrimitivePageHeader,
  Select,
  TabTrigger,
} from "./ui";
import { BaileysPairingPanel } from "./BaileysPairingPanel";
import "@/styles/overview.css";

// Stable empty-array reference — see selector-hygiene.test.ts.
const NO_CHANNELS: ChannelEntry[] = [];

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

const CHAT_MODE_OPTIONS = [
  { value: "auto", label: "Auto-reply" },
  { value: "read", label: "Read-only" },
  { value: "off", label: "Off" },
];

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

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function gatewayTitle(kind: string): string {
  const found = CHANNEL_TYPES.find((item) => item.value === kind);
  return found?.label ?? kind;
}

function GatewayHeaderTitle({ count }: { count: number }) {
  return (
    <span className="company-primitive-page-title">
      <span className="company-primitive-page-title-text">Gateways</span>
      <span className="company-primitive-page-count" aria-hidden="true">
        {count}
      </span>
    </span>
  );
}

function GatewayCreateModal({
  error,
  fields,
  onClose,
  onFieldChange,
  onSubmit,
  onTypeChange,
  open,
  saving,
  type,
}: {
  error: string | null;
  fields: Record<string, string>;
  onClose: () => void;
  onFieldChange: (key: string, value: string) => void;
  onSubmit: () => void;
  onTypeChange: (value: string) => void;
  open: boolean;
  saving: boolean;
  type: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title="New Gateway">
      <div className="company-apps-modal-form">
        <div className="channel-type-picker gateway-type-picker">
          {CHANNEL_TYPES.map((channelType) => (
            <TabTrigger
              key={channelType.value}
              active={type === channelType.value}
              onClick={() => onTypeChange(channelType.value)}
            >
              {channelType.label}
            </TabTrigger>
          ))}
        </div>

        <div className="gateway-form-grid">
          {(CHANNEL_FIELDS[type] || []).map((field) => {
            const key = fieldKey(field.label);
            return (
              <Input
                key={key}
                label={field.label}
                type={field.type || "text"}
                placeholder={field.placeholder}
                value={fields[key] || ""}
                onChange={(event) => onFieldChange(key, event.target.value)}
              />
            );
          })}
        </div>

        {type === "whatsapp-baileys" && (
          <p className="channel-form-hint gateway-form-hint">
            Pairing opens on the gateway detail after creation.
          </p>
        )}
        {error && <div className="channel-form-error gateway-form-error">{error}</div>}

        <div className="company-apps-modal-actions">
          <Button type="button" variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={onSubmit} loading={saving} disabled={saving}>
            Create Gateway
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function GatewayShell({
  actions,
  children,
  count,
  summary,
}: {
  actions: ReactNode;
  children: ReactNode;
  count: number;
  summary: ReactNode;
}) {
  return (
    <div className="gateway-page company-primitive-shell">
      <PrimitivePageHeader
        className="gateway-page-header company-primitive-shell-header"
        title={<GatewayHeaderTitle count={count} />}
        aria-label="Gateway controls"
        actions={actions}
        padding="none"
      />

      <main className="gateway-main company-primitive-shell-surface gateway-shell-surface">
        <div className="company-primitive-context-strip" role="status">
          <span className="company-primitive-context-text">{summary}</span>
        </div>
        {children}
      </main>
    </div>
  );
}

export default function AgentChannelsTab({ agentId }: { agentId: string }) {
  const { goEntity, companyId } = useNav();
  const { itemId } = useParams<{ itemId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = itemId || null;

  const { data: channels = NO_CHANNELS } = useAgentChannels(agentId);
  const { data: channelSessions = [] } = useChannelSessions(agentId);
  const { getChannels, invalidateChannels, removeChannel, patchChannel } =
    useAgentChannelsCache(agentId);
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

  const openAddForm = useCallback((kind?: string | null) => {
    const found = CHANNEL_TYPES.find((item) => item.value === kind);
    if (found) {
      setNewChannelType(found.value);
    }
    setShowAddForm(true);
    setError(null);
    setNewChannelFields({});
    setSaving(false);
  }, []);

  const closeAddForm = useCallback(() => {
    setShowAddForm(false);
    setError(null);
    setNewChannelFields({});
    setSaving(false);
  }, []);

  useEffect(() => {
    const handler = () => {
      openAddForm();
    };
    window.addEventListener("aeqi:new-gateway", handler);
    window.addEventListener("aeqi:new-channel", handler);
    return () => {
      window.removeEventListener("aeqi:new-gateway", handler);
      window.removeEventListener("aeqi:new-channel", handler);
    };
  }, [openAddForm]);

  useEffect(() => {
    if (searchParams.get("new") !== "1") return;
    openAddForm(searchParams.get("kind"));
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    next.delete("kind");
    setSearchParams(next, { replace: true });
  }, [openAddForm, searchParams, setSearchParams]);

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
      await channelsApi.createAgentChannel({
        agent_id: agentId,
        config: buildConfig(newChannelType, newChannelFields),
      });
      setShowAddForm(false);
      setNewChannelFields({});
      void invalidateChannels();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const getSessions = (ch: ChannelEntry) => channelSessions.filter((s) => s.transport === ch.kind);
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
    const ch = getChannels().find((c) => c.id === channelId);
    if (!ch) return;
    const next = reducer(ch.allowed_chats);
    patchChannel(channelId, { allowed_chats: next });
    // Rapid clicks fire overlapping PATCHes. Record our seq at dispatch and
    // ignore our error handler if a newer call has already fired — old
    // failures would otherwise trigger a refetch that races the newer call.
    const mySeq = ++allowedSeqRef.current;
    try {
      await channelsApi.setChannelAllowedChats(channelId, next);
    } catch (e) {
      if (mySeq !== allowedSeqRef.current) return; // superseded
      setError(e instanceof Error ? e.message : "Failed to update whitelist");
      // Refetch — authoritative truth trumps guessing at rollback state.
      void invalidateChannels();
    }
  };

  const totalSessions = channels.reduce((sum, channel) => sum + getSessions(channel).length, 0);
  const totalAllowed = channels.reduce((sum, channel) => sum + channel.allowed_chats.length, 0);
  const toolbarSummary = `${countLabel(channels.length, "gateway")} · ${countLabel(
    totalSessions,
    "session",
  )} · ${countLabel(totalAllowed, "allowed route")}`;
  const fireNew = () => openAddForm();
  const gatewayCreator = (
    <GatewayCreateModal
      error={error}
      fields={newChannelFields}
      onClose={closeAddForm}
      onFieldChange={(key, value) =>
        setNewChannelFields((current) => ({ ...current, [key]: value }))
      }
      onSubmit={handleAdd}
      onTypeChange={(value) => {
        setNewChannelType(value);
        setNewChannelFields({});
        setError(null);
      }}
      open={showAddForm}
      saving={saving}
      type={newChannelType}
    />
  );

  if (!selected) {
    return (
      <GatewayShell
        count={channels.length}
        summary={toolbarSummary}
        actions={
          <Button
            variant="primary"
            size="md"
            onClick={fireNew}
            leadingIcon={<Plus size={14} strokeWidth={1.6} />}
          >
            New Gateway
          </Button>
        }
      >
        <section className="company-cockpit-card company-cockpit-card--wide gateway-surface-card">
          <header className="company-cockpit-card-header gateway-card-header">
            <div>
              <h2 className="company-cockpit-card-title">Connected gateways</h2>
              <p className="company-cockpit-card-sub">
                Transport endpoints that create and deliver sessions.
              </p>
            </div>
          </header>

          {channels.length === 0 ? (
            <EmptyState
              eyebrow="Gateways"
              title="No gateways yet"
              description="Add Telegram, WhatsApp, or another transport endpoint to route external messages into sessions."
              action={
                <Button variant="primary" size="md" onClick={fireNew}>
                  Add Gateway
                </Button>
              }
            />
          ) : (
            <div className="gateway-list" aria-label="Connected gateways">
              {channels.map((c) => {
                const sessions = getSessions(c);
                const meta =
                  sessions.length > 0
                    ? countLabel(sessions.length, "session")
                    : c.allowed_chats.length > 0
                      ? countLabel(c.allowed_chats.length, "allowed route")
                      : "No sessions";
                return (
                  <CardTrigger
                    key={c.id}
                    className="gateway-list-row"
                    onClick={() => goEntity(companyId, "gateways", c.id)}
                    aria-label={`Open ${gatewayTitle(c.kind)} gateway`}
                  >
                    <span className="gateway-list-row-icon" aria-hidden>
                      <Waypoints size={15} strokeWidth={1.6} />
                    </span>
                    <span className="gateway-list-row-main">
                      <span className="gateway-list-row-name">{gatewayTitle(c.kind)}</span>
                      <span className="gateway-list-row-key">gateway:{c.kind}</span>
                    </span>
                    <span className="gateway-list-row-status">
                      <span
                        className={`gateway-status-dot${c.enabled ? " is-on" : ""}`}
                        aria-hidden
                      />
                      {c.enabled ? "Enabled" : "Paused"}
                    </span>
                    <span className="gateway-list-row-meta">{meta}</span>
                  </CardTrigger>
                );
              })}
            </div>
          )}
        </section>
        {gatewayCreator}
      </GatewayShell>
    );
  }

  const sessions = getSessions(selected);
  const allowed = getAllowed(selected);
  const whitelist = allowed.length > 0;
  const selectedSummary = `${gatewayTitle(selected.kind)} · ${countLabel(
    sessions.length,
    "session",
  )} · ${countLabel(allowed.length, "allowed route")}`;

  return (
    <GatewayShell
      count={channels.length}
      summary={selectedSummary}
      actions={
        <div className="gateway-header-actions">
          <Button
            variant="secondary"
            size="md"
            onClick={() => goEntity(companyId, "gateways", undefined, { replace: true })}
          >
            All Gateways
          </Button>
          <Button
            variant="danger"
            size="md"
            aria-label={`Disconnect ${selected.kind} gateway`}
            disabled={deleting}
            loading={deleting}
            onClick={async () => {
              if (deleting) return;
              setDeleting(true);
              setError(null);
              try {
                await channelsApi.deleteAgentChannel(selected.id);
                removeChannel(selected.id);
                goEntity(companyId, "gateways", undefined, { replace: true });
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
      }
    >
      {error && (
        <div className="channel-form-error gateway-form-error gateway-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <section className="company-cockpit-card company-cockpit-card--wide gateway-surface-card">
        <header className="company-cockpit-card-header gateway-card-header">
          <div>
            <h2 className="company-cockpit-card-title">{gatewayTitle(selected.kind)}</h2>
            <p className="company-cockpit-card-sub">gateway:{selected.kind}</p>
          </div>
          <span className="gateway-list-row-status">
            <span className={`gateway-status-dot${selected.enabled ? " is-on" : ""}`} aria-hidden />
            {selected.enabled ? "Enabled" : "Paused"}
          </span>
        </header>

        <div className="gateway-config-grid">
          {Object.entries(selected.config)
            .filter(([k]) => k !== "allowed_chats" && k !== "allowed_jids")
            .map(([k, v]) => (
              <div key={k} className="gateway-config-field">
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
      </section>

      <section className="company-cockpit-card company-cockpit-card--wide gateway-surface-card">
        <header className="company-cockpit-card-header gateway-card-header">
          <div>
            <h2 className="company-cockpit-card-title">Sessions</h2>
            <p className="company-cockpit-card-sub">External peers routed through this gateway.</p>
          </div>
          <label className="gateway-whitelist-toggle">
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
                  const allSessions: AllowedChat[] = sessions
                    .map((s) => s.chat_id)
                    .filter(Boolean)
                    .map((chat_id) => ({ chat_id, reply_allowed: true }));
                  updateAllowed(selected.id, () => allSessions);
                } else {
                  // Turning whitelist OFF clears the entire server-side
                  // list — confirm first if there was a non-empty one.
                  if (
                    selected.allowed_chats.length > 0 &&
                    !window.confirm(
                      `Turn off whitelist for ${selected.kind}? This will clear ${countLabel(
                        selected.allowed_chats.length,
                        "allowed route",
                      )}.`,
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
        </header>
        <p className="agent-settings-hint gateway-sessions-hint">
          <strong>Auto-reply</strong> = agent answers automatically. <strong>Read-only</strong> =
          messages arrive, agent stays silent. <strong>Off</strong> = drop entirely.
        </p>

        {sessions.length === 0 ? (
          <EmptyState
            eyebrow="Sessions"
            title="No active sessions yet"
            description="Messages through this gateway will create sessions here once they arrive."
          />
        ) : (
          <div className="gateway-session-list" aria-label="Gateway sessions">
            {sessions.map((s) => {
              const mode = chatModeFor(allowed, s.chat_id);
              const kindLabel = chatKindLabel(s.transport, s.chat_id);
              return (
                <div key={s.channel_key} className="gateway-session-row">
                  <div className="gateway-session-main">
                    <span className="event-idea-key">{s.chat_id}</span>
                    {kindLabel && <span className="gateway-session-kind">{kindLabel}</span>}
                  </div>
                  {whitelist ? (
                    <Select
                      aria-label={`Reply mode for ${s.chat_id}`}
                      className="channel-reply-mode-select"
                      size="sm"
                      options={CHAT_MODE_OPTIONS}
                      value={mode}
                      onChange={(nextValue) => {
                        const next = nextValue as ChatMode;
                        updateAllowed(selected.id, (current) => {
                          const without = current.filter((v) => v.chat_id !== s.chat_id);
                          if (next === "off") return without;
                          return [
                            ...without,
                            { chat_id: s.chat_id, reply_allowed: next === "auto" },
                          ];
                        });
                      }}
                    />
                  ) : (
                    <span className="gateway-session-mode">Allowed</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      {gatewayCreator}
    </GatewayShell>
  );
}
