import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import PageTabs, { useActiveTab } from "@/components/PageTabs";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";
import { useDaemonStore } from "@/store/daemon";
import { Button, IconButton, Input } from "@/components/ui";
import { ALL_TOOLS } from "@/lib/tools";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "api-keys", label: "API Keys" },
];

interface SecretKey {
  id: string;
  prefix: string;
  root: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

interface NewSecretKey {
  secret_key: string;
}

const CopyIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <rect x="5" y="5" width="9" height="9" rx="1.5" />
    <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
  </svg>
);

const CheckIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    stroke="var(--success, #22c55e)"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <polyline points="3.5 8.5 6.5 11.5 12.5 5.5" />
  </svg>
);

const KeyIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.3"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="5" cy="11" r="3" />
    <path d="M7.5 8.5L14 2m0 0l-2 2m2-2v3" />
  </svg>
);

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <IconButton
      variant="bordered"
      size="sm"
      aria-label="Copy to clipboard"
      title="Copy to clipboard"
      onClick={copy}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </IconButton>
  );
}

function Feedback({ type, msg }: { type: "success" | "error"; msg: string }) {
  return (
    <div className={`account-feedback account-feedback-${type}`} role="status" aria-live="polite">
      {msg}
    </div>
  );
}

export default function SettingsPage() {
  const activeTab = useActiveTab(TABS, "overview");
  const appMode = useAuthStore((s) => s.appMode);
  const rootName = useUIStore((s) => s.activeRoot);

  const [keys, setKeys] = useState<SecretKey[]>([]);
  const [newKey, setNewKey] = useState<NewSecretKey | null>(null);
  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const fetchKeys = () => {
    api
      .getKeys()
      .then((data) => {
        if (data.keys) setKeys(data.keys);
      })
      .catch(() => {});
  };

  useEffect(() => {
    if (activeTab === "api-keys") fetchKeys();
  }, [activeTab]);

  const handleCreate = async () => {
    if (!rootName) {
      setFeedback({ type: "error", msg: "No root agent selected." });
      return;
    }
    setCreating(true);
    setFeedback(null);
    try {
      const data = await api.createKey({ root: rootName, name: keyName || "default" });
      setNewKey({ secret_key: data.secret_key });
      setKeyName("");
      fetchKeys();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create key";
      setFeedback({ type: "error", msg });
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: string) => {
    if (!confirm("Revoke this key? Any services using it will stop working.")) return;
    setRevoking(id);
    try {
      await api.revokeKey(id);
      setKeys((prev) => prev.filter((k) => k.id !== id));
      setFeedback({ type: "success", msg: "Key revoked." });
    } catch {
      setFeedback({ type: "error", msg: "Failed to revoke key." });
    } finally {
      setRevoking(null);
    }
  };

  return (
    <>
      <PageTabs tabs={TABS} defaultTab="overview" />
      <div className="account-page" style={{ maxWidth: 640 }}>
        {activeTab === "overview" && <OverviewTab rootName={rootName} appMode={appMode} />}

        {activeTab === "api-keys" && (
          <>
            <p className="account-field-desc">
              {rootName ? (
                <>
                  Secret keys authenticate access to <strong>{rootName}</strong>'s runtime.
                  {appMode === "platform" ? (
                    <>
                      {" "}
                      You'll also need your{" "}
                      <Link to="/profile?tab=api" className="key-link">
                        account API key
                      </Link>{" "}
                      (<code>ak_</code>) to identify yourself.
                    </>
                  ) : (
                    <> In self-hosted mode, these keys are the runtime credentials.</>
                  )}
                </>
              ) : (
                "Select a root agent to manage runtime keys."
              )}
            </p>

            {newKey && (
              <div className="key-new-banner">
                <div className="key-new-header">
                  <KeyIcon /> Save this now — the secret key won't be shown again.
                </div>
                <div className="key-new-row">
                  <span className="key-new-label">Secret Key</span>
                  <code className="key-new-value">{newKey.secret_key}</code>
                  <CopyButton text={newKey.secret_key} />
                </div>
                <div className="key-new-usage">
                  <code className="key-new-code">export AEQI_SECRET_KEY={newKey.secret_key}</code>
                  <CopyButton text={`export AEQI_SECRET_KEY=${newKey.secret_key}`} />
                </div>
                {appMode === "platform" && (
                  <p
                    className="account-field-desc"
                    style={{ marginTop: "var(--space-2)", fontSize: "0.78rem" }}
                  >
                    Pair this with your{" "}
                    <Link to="/profile?tab=api" className="key-link">
                      account API key
                    </Link>{" "}
                    (<code>AEQI_API_KEY</code>).
                  </p>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="key-new-dismiss"
                  onClick={() => setNewKey(null)}
                >
                  I've saved this key
                </Button>
              </div>
            )}

            <div className="key-create-form">
              <div style={{ maxWidth: 320, width: "100%" }}>
                <Input
                  type="text"
                  placeholder="Key name (e.g. claude-code, ci-pipeline)"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                />
              </div>
              <Button
                type="button"
                variant="primary"
                onClick={handleCreate}
                loading={creating}
                disabled={creating}
              >
                {creating ? "Creating..." : "Create Key"}
              </Button>
            </div>

            {feedback && <Feedback type={feedback.type} msg={feedback.msg} />}

            {keys.length > 0 ? (
              <div className="key-list">
                <div className="key-list-header">
                  <span>Name</span>
                  <span>Key</span>
                  <span>Created</span>
                  <span>Last used</span>
                  <span></span>
                </div>
                {keys.map((k) => (
                  <div key={k.id} className="key-list-row">
                    <span className="key-list-name">{k.name}</span>
                    <code className="key-list-prefix">{k.prefix}...</code>
                    <span className="key-list-meta">{timeAgo(k.created_at)}</span>
                    <span className="key-list-meta">
                      {k.last_used_at ? timeAgo(k.last_used_at) : "never"}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="key-revoke-btn"
                      onClick={() => handleRevoke(k.id)}
                      loading={revoking === k.id}
                    >
                      Revoke
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              !newKey && <p className="key-empty">No API keys yet. Create one to get started.</p>
            )}
          </>
        )}
      </div>
    </>
  );
}

function OverviewTab({
  rootName,
  appMode,
}: {
  rootName: string;
  appMode: "runtime" | "platform" | null;
}) {
  const status = useDaemonStore((s) => s.status);
  const agents = useDaemonStore((s) => s.agents);
  const rootAgent = agents.find((a) => a.name === rootName);
  const resolvedId = rootAgent?.id ?? rootName;

  const [modelValue, setModelValue] = useState(rootAgent?.model ?? "");
  const [modelFeedback, setModelFeedback] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  const [toolDeny, setToolDeny] = useState<string[]>(rootAgent?.tool_deny ?? []);
  const [toolFeedback, setToolFeedback] = useState<{
    type: "success" | "error";
    msg: string;
  } | null>(null);

  useEffect(() => {
    setModelValue(rootAgent?.model ?? "");
    setToolDeny(rootAgent?.tool_deny ?? []);
  }, [rootAgent?.model, rootAgent?.tool_deny]);

  const saveModel = async (val: string) => {
    if (!resolvedId) return;
    setModelFeedback(null);
    try {
      await api.setAgentModel(resolvedId, val.trim());
      setModelFeedback({ type: "success", msg: "Model saved." });
      setTimeout(() => setModelFeedback(null), 3000);
    } catch (e: unknown) {
      setModelFeedback({
        type: "error",
        msg: e instanceof Error ? e.message : "Failed to save model.",
      });
    }
  };

  const toggleTool = async (toolId: string) => {
    if (!resolvedId) return;
    const next = toolDeny.includes(toolId)
      ? toolDeny.filter((t) => t !== toolId)
      : [...toolDeny, toolId];
    setToolDeny(next);
    setToolFeedback(null);
    try {
      await api.setAgentTools(resolvedId, next);
      setToolFeedback({ type: "success", msg: "Tool preferences saved." });
      setTimeout(() => setToolFeedback(null), 3000);
    } catch (e: unknown) {
      setToolDeny(toolDeny);
      setToolFeedback({
        type: "error",
        msg: e instanceof Error ? e.message : "Failed to save tools.",
      });
    }
  };

  const costToday = (status?.cost_today_usd as number) ?? null;
  const dailyBudget = (status?.daily_budget_usd as number) ?? null;
  const budgetRemaining = (status?.budget_remaining_usd as number) ?? null;
  const activeWorkers = (status?.scheduler_active_workers as number) ?? null;

  return (
    <>
      <div className="settings-status-grid">
        <div className="settings-stat">
          <span className="settings-stat-label">Cost today</span>
          <span className="settings-stat-value">
            {costToday != null ? `$${costToday.toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="settings-stat">
          <span className="settings-stat-label">Daily budget</span>
          <span className="settings-stat-value">
            {dailyBudget != null ? `$${dailyBudget.toFixed(0)}` : "—"}
          </span>
        </div>
        <div className="settings-stat">
          <span className="settings-stat-label">Remaining</span>
          <span className="settings-stat-value">
            {budgetRemaining != null ? `$${budgetRemaining.toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="settings-stat">
          <span className="settings-stat-label">Active workers</span>
          <span className="settings-stat-value">{activeWorkers ?? "—"}</span>
        </div>
      </div>

      {!rootName ? (
        <p className="account-field-desc" style={{ marginTop: "var(--space-4)" }}>
          No root agent selected. Select one from the sidebar to configure it here.
        </p>
      ) : (
        <>
          <div className="account-divider" />

          <div className="account-field-lg">
            <label className="account-field-label">
              Active root: <strong>{rootName}</strong>
              {appMode === "runtime" && (
                <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
                  {" "}
                  · self-hosted runtime
                </span>
              )}
            </label>
            <p className="account-field-desc">
              The root agent's model and tool defaults apply to all sessions unless overridden
              per-agent.
            </p>
          </div>

          <div className="account-field-md">
            <label className="account-field-label" htmlFor="settings-model">
              Model
            </label>
            <p className="account-field-desc">
              Provider-qualified model name (e.g. <code>anthropic/claude-sonnet-4</code>,{" "}
              <code>openrouter/deepseek/deepseek-v3</code>, <code>ollama/llama3.2</code>).
            </p>
            <div className="account-field-row">
              <Input
                id="settings-model"
                type="text"
                value={modelValue}
                onChange={(e) => setModelValue(e.target.value)}
                placeholder="e.g. anthropic/claude-sonnet-4"
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveModel(modelValue);
                }}
              />
              <Button
                type="button"
                variant="primary"
                onClick={() => saveModel(modelValue)}
                disabled={!modelValue.trim()}
              >
                Save
              </Button>
            </div>
            {modelFeedback && <Feedback type={modelFeedback.type} msg={modelFeedback.msg} />}
          </div>

          <div className="account-field-lg">
            <label className="account-field-label">Tool access</label>
            <p className="account-field-desc">
              Denied tools are blocked for this agent and all child agents unless re-enabled.{" "}
              {toolDeny.length === 0
                ? "All tools are currently enabled."
                : `${toolDeny.length} tool${toolDeny.length === 1 ? "" : "s"} blocked.`}
            </p>
            <div className="settings-tool-grid">
              {ALL_TOOLS.map((tool) => {
                const denied = toolDeny.includes(tool.id);
                return (
                  <label key={tool.id} className="settings-tool-row">
                    <input
                      type="checkbox"
                      checked={!denied}
                      onChange={() => toggleTool(tool.id)}
                      className="settings-tool-checkbox"
                    />
                    <span className="settings-tool-label">{tool.label}</span>
                    <span className="settings-tool-category">{tool.category}</span>
                  </label>
                );
              })}
            </div>
            {toolFeedback && <Feedback type={toolFeedback.type} msg={toolFeedback.msg} />}
          </div>
        </>
      )}
    </>
  );
}
