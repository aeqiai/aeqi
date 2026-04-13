import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import PageTabs, { useActiveTab } from "@/components/PageTabs";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "api-keys", label: "API Keys" },
];

interface SecretKey {
  id: string;
  prefix: string;
  company: string;
  name: string;
  created_at: string;
  last_used_at: string | null;
}

interface NewSecretKey {
  secret_key: string;
}

const CopyIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
    <rect x="5" y="5" width="9" height="9" rx="1.5" />
    <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--success, #22c55e)" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <polyline points="3.5 8.5 6.5 11.5 12.5 5.5" />
  </svg>
);

const KeyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden="true">
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
    <button type="button" className="key-copy-btn" onClick={copy} title="Copy to clipboard">
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  );
}

export default function CompanyPage() {
  const activeTab = useActiveTab(TABS, "overview");
  const appMode = useAuthStore((s) => s.appMode);
  const company = useUIStore((s) => s.activeCompany);

  const [keys, setKeys] = useState<SecretKey[]>([]);
  const [newKey, setNewKey] = useState<NewSecretKey | null>(null);
  const [keyName, setKeyName] = useState("");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; msg: string } | null>(null);

  const fetchKeys = () => {
    api.getKeys().then((data) => {
      if (data.keys) setKeys(data.keys);
    }).catch(() => {});
  };

  useEffect(() => {
    if (activeTab === "api-keys") fetchKeys();
  }, [activeTab]);

  const handleCreate = async () => {
    if (!company) {
      setFeedback({ type: "error", msg: "No company selected." });
      return;
    }
    setCreating(true);
    setFeedback(null);
    try {
      const data = await api.createKey({ company, name: keyName || "default" });
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

        {activeTab === "overview" && (
          <>
            <p className="account-field-desc" style={{ marginBottom: "var(--space-4)" }}>
              {company ? (
                <>
                  Active company: <strong>{company}</strong>
                  {appMode === "platform" ? "" : ". This company lives directly in the runtime."}
                </>
              ) : (
                "No company selected. Select one from the sidebar."
              )}
            </p>
          </>
        )}

        {activeTab === "api-keys" && (
          <>
            <p className="account-field-desc">
              {company ? (
                <>
                  Secret keys authenticate access to <strong>{company}</strong>'s runtime.
                  {appMode === "platform" ? (
                    <>
                      {" "}You'll also need your <Link to="/account?tab=api" className="key-link">account API key</Link> (<code>ak_</code>) to identify yourself.
                    </>
                  ) : (
                    <>
                      {" "}In self-hosted mode, these keys are the company-level runtime credentials.
                    </>
                  )}
                </>
              ) : (
                "Select a company to manage runtime keys."
              )}
            </p>

            {/* New key display — shown once after creation */}
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
                  <p className="account-field-desc" style={{ marginTop: "var(--space-2)", fontSize: "0.78rem" }}>
                    Pair this with your <Link to="/account?tab=api" className="key-link">account API key</Link> (<code>AEQI_API_KEY</code>).
                  </p>
                )}
                <button type="button" className="btn btn-ghost key-new-dismiss" onClick={() => setNewKey(null)}>
                  I've saved this key
                </button>
              </div>
            )}

            {/* Create key form */}
            <div className="key-create-form">
              <input
                type="text"
                className="auth-input key-name-input"
                placeholder="Key name (e.g. claude-code, ci-pipeline)"
                value={keyName}
                onChange={(e) => setKeyName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={creating}
              >
                {creating ? "Creating..." : "Create Key"}
              </button>
            </div>

            {feedback && (
              <div className={`account-feedback account-feedback-${feedback.type}`} role="status">
                {feedback.msg}
              </div>
            )}

            {/* Key list */}
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
                    <span className="key-list-meta">{k.last_used_at ? timeAgo(k.last_used_at) : "never"}</span>
                    <button
                      type="button"
                      className="btn btn-ghost btn-danger-text key-revoke-btn"
                      onClick={() => handleRevoke(k.id)}
                      disabled={revoking === k.id}
                    >
                      {revoking === k.id ? "..." : "Revoke"}
                    </button>
                  </div>
                ))}
              </div>
            ) : !newKey && (
              <p className="key-empty">No API keys yet. Create one to get started.</p>
            )}
          </>
        )}
      </div>
    </>
  );
}
