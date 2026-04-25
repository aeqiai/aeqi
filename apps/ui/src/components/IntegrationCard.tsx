import { useMemo } from "react";
import type { CredentialView, IntegrationCatalogEntry } from "@/api/integrations";
import { Button } from "./ui";
import { IntegrationStatusPill } from "./IntegrationStatusPill";

interface IntegrationCardProps {
  entry: IntegrationCatalogEntry;
  /** Credentials matching this entry within the surrounding scope. */
  credentials: CredentialView[];
  onConnect: () => void;
  onRefresh: (credentialId: string) => void;
  onDisconnect: (credentialId: string) => void;
  /** Whether per-agent scope is shown in this card (changes the empty state copy). */
  scopeLabel?: "global" | "agent";
  busyId?: string | null;
}

/**
 * One row in the Integrations list. Renders a connection summary, the
 * credential's status pill (when one exists), and the appropriate CTA
 * (Connect / Reconnect / Disconnect). Designed to be rendered both in the
 * global Integrations page and per-agent Integrations tab.
 */
export function IntegrationCard({
  entry,
  credentials,
  onConnect,
  onRefresh,
  onDisconnect,
  scopeLabel = "global",
  busyId,
}: IntegrationCardProps) {
  const credential = useMemo(
    () => credentials.find((c) => c.provider === entry.provider && c.name === entry.name),
    [credentials, entry.provider, entry.name],
  );
  const isConnected = credential?.status === "ok";
  const needsReconnect =
    credential != null &&
    (credential.status === "expired" || credential.status === "refresh_failed");

  return (
    <div className="integration-card">
      <div className="integration-card-head">
        <div className="integration-card-identity">
          <h3 className="integration-card-label">{entry.label}</h3>
          {entry.coming_soon ? (
            <span className="integration-card-soon">Coming soon</span>
          ) : credential ? (
            <IntegrationStatusPill status={credential.status} />
          ) : (
            <IntegrationStatusPill status="missing_credential" label="Not connected" />
          )}
        </div>
        <div className="integration-card-actions">
          {entry.coming_soon ? (
            <Button variant="secondary" size="sm" disabled>
              Available later
            </Button>
          ) : isConnected ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => credential && onRefresh(credential.id)}
                disabled={busyId === credential?.id}
              >
                Refresh
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => credential && onDisconnect(credential.id)}
                disabled={busyId === credential?.id}
              >
                Disconnect
              </Button>
            </>
          ) : needsReconnect ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onConnect}
              disabled={busyId === credential?.id}
            >
              Reconnect
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={onConnect}>
              Connect
            </Button>
          )}
        </div>
      </div>

      <p className="integration-card-desc">{entry.description}</p>

      {credential?.account_email && (
        <div className="integration-card-meta">
          <span className="integration-card-meta-label">Account</span>
          <span className="integration-card-meta-value">{credential.account_email}</span>
        </div>
      )}

      {credential?.expires_at && (
        <div className="integration-card-meta">
          <span className="integration-card-meta-label">Expires</span>
          <span className="integration-card-meta-value">
            {new Date(credential.expires_at).toLocaleString()}
          </span>
        </div>
      )}

      {!entry.coming_soon && entry.oauth_scopes.length > 0 && (
        <details className="integration-card-scopes">
          <summary>
            {entry.oauth_scopes.length}{" "}
            {entry.oauth_scopes.length === 1 ? "scope requested" : "scopes requested"}
          </summary>
          <ul className="integration-card-scope-list">
            {entry.oauth_scopes.map((s) => (
              <li key={s}>
                <code>{s}</code>
              </li>
            ))}
          </ul>
        </details>
      )}

      {scopeLabel === "agent" && !entry.per_agent && (
        <p className="integration-card-warning">
          This pack is global only — connecting it here is treated as a workspace-wide credential.
        </p>
      )}
    </div>
  );
}
