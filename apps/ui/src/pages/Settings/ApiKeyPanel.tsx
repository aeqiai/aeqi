import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import { Button, IconButton } from "@/components/ui";

type Feedback = { type: "success" | "error"; msg: string } | null;

/**
 * Settings → API key tab. Account-level `ak_` key — one active at a
 * time. Generating rotates the previous, so we surface a warning and
 * cache the value in localStorage so a refresh doesn't lose it.
 */
export default function ApiKeyPanel() {
  const { href } = useNav();
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);

  useEffect(() => {
    const stored = localStorage.getItem("aeqi_api_key_display");
    if (stored) setApiKey(stored);
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const data = await api.generateApiKey();
      if (data.api_key) {
        setApiKey(data.api_key);
        localStorage.setItem("aeqi_api_key_display", data.api_key);
        if (data.api_key.startsWith("ak_")) {
          setFeedback({
            type: "success",
            msg: data.rotated
              ? "API key rotated. Previous key is now invalid."
              : "API key generated.",
          });
        }
      }
    } catch (e: unknown) {
      setFeedback({
        type: "error",
        msg: e instanceof Error ? e.message : "Failed to generate API key.",
      });
    } finally {
      setLoading(false);
    }
  };

  const copy = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <>
      <p className="account-field-desc">
        Your API key (<code>ak_</code>) identifies your account across all agents. Use it alongside
        a secret key (<code>sk_</code>) for MCP and API access.
      </p>
      <p className="account-field-desc">
        Only one account API key is active at a time. Generating a new key rotates the previous one
        immediately, so save the new value now.
      </p>

      {apiKey ? (
        <div className="account-field account-field-stack">
          <label className="account-field-label">API key</label>
          <div className="account-key-row">
            <code className="key-new-value">{apiKey}</code>
            <IconButton
              variant="bordered"
              size="sm"
              aria-label="Copy API key"
              title="Copy"
              onClick={copy}
            >
              {copied ? (
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="var(--success, #22c55e)"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <polyline points="3.5 8.5 6.5 11.5 12.5 5.5" />
                </svg>
              ) : (
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                >
                  <rect x="5" y="5" width="9" height="9" rx="1.5" />
                  <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" />
                </svg>
              )}
            </IconButton>
          </div>
          <p className="account-field-desc account-field-desc-tight">
            Active across all agents for your account until you rotate it.
          </p>
          <div className="account-cta-row">
            <Button variant="secondary" onClick={handleGenerate} loading={loading}>
              Rotate API key
            </Button>
          </div>
        </div>
      ) : (
        <div className="account-cta-row account-cta-row--first">
          <Button variant="primary" onClick={handleGenerate} loading={loading}>
            Generate API key
          </Button>
        </div>
      )}

      {feedback && (
        <div className={`account-feedback account-feedback-${feedback.type}`} role="status">
          {feedback.msg}
        </div>
      )}

      <div className="account-key-footnote">
        <p className="account-field-desc">
          To create secret keys for a specific agent, go to{" "}
          <Link to={href("/settings/api")} className="key-link">
            Settings → API keys
          </Link>
          .
        </p>
      </div>
    </>
  );
}
