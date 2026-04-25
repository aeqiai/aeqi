import { useCallback, useEffect, useState } from "react";
import type { CredentialView, IntegrationCatalogEntry } from "@/api/integrations";
import { integrationsApi } from "@/api/integrations";
import { ConnectIntegrationModal } from "./ConnectIntegrationModal";
import { IntegrationCard } from "./IntegrationCard";
import { EmptyState } from "./ui";

interface IntegrationsPanelProps {
  /** Credentials are filtered to this scope. */
  scope: {
    scope_kind: "global" | "agent";
    scope_id: string;
  };
  heading?: string;
  description?: string;
}

/**
 * Generic integrations surface: catalog + per-scope credential status +
 * Connect/Refresh/Disconnect actions. Used by:
 *
 *   - the global Settings → Integrations page (`scope_kind = "global"`)
 *   - the per-agent Integrations tab (`scope_kind = "agent"`)
 */
export function IntegrationsPanel({ scope, heading, description }: IntegrationsPanelProps) {
  const [catalog, setCatalog] = useState<IntegrationCatalogEntry[]>([]);
  const [credentials, setCredentials] = useState<CredentialView[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalEntry, setModalEntry] = useState<IntegrationCatalogEntry | null>(null);

  const refreshAll = useCallback(async () => {
    try {
      setLoading(true);
      const [cat, creds] = await Promise.all([
        integrationsApi.listIntegrations(),
        integrationsApi.listCredentials(scope),
      ]);
      setCatalog(cat.integrations);
      setCredentials(creds.credentials);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load integrations.");
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    refreshAll();
  }, [refreshAll]);

  const handleConnect = useCallback((entry: IntegrationCatalogEntry) => {
    setModalEntry(entry);
  }, []);

  const handleConnected = useCallback(() => {
    refreshAll();
    // Close the modal after a short delay so the user sees the success
    // state before it disappears.
    setTimeout(() => setModalEntry(null), 1200);
  }, [refreshAll]);

  const handleRefresh = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError(null);
      try {
        await integrationsApi.refreshCredential(id);
        await refreshAll();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Refresh failed.");
      } finally {
        setBusyId(null);
      }
    },
    [refreshAll],
  );

  const handleDisconnect = useCallback(
    async (id: string) => {
      if (
        !window.confirm(
          "Disconnect this integration? Tools that depend on it will stop working until you reconnect.",
        )
      )
        return;
      setBusyId(id);
      setError(null);
      try {
        await integrationsApi.deleteCredential(id);
        await refreshAll();
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Disconnect failed.");
      } finally {
        setBusyId(null);
      }
    },
    [refreshAll],
  );

  if (loading && catalog.length === 0) {
    return (
      <div className="integrations-panel">
        <p className="integrations-panel-loading">Loading integrations…</p>
      </div>
    );
  }

  return (
    <div className="integrations-panel">
      {(heading || description) && (
        <header className="integrations-panel-head">
          {heading && <h2 className="integrations-panel-heading">{heading}</h2>}
          {description && <p className="integrations-panel-desc">{description}</p>}
        </header>
      )}

      {error && (
        <div className="integrations-panel-error" role="alert">
          {error}
        </div>
      )}

      {catalog.length === 0 ? (
        <EmptyState
          eyebrow="Integrations"
          title="No integrations available yet"
          description="Once a wisdom pack registers, its integration will appear here."
        />
      ) : (
        <div className="integrations-panel-list">
          {catalog.map((entry) => (
            <IntegrationCard
              key={`${entry.provider}:${entry.name}`}
              entry={entry}
              credentials={credentials}
              scopeLabel={scope.scope_kind}
              busyId={busyId}
              onConnect={() => handleConnect(entry)}
              onRefresh={handleRefresh}
              onDisconnect={handleDisconnect}
            />
          ))}
        </div>
      )}

      <ConnectIntegrationModal
        open={modalEntry != null}
        entry={modalEntry}
        scope={scope}
        onClose={() => setModalEntry(null)}
        onConnected={handleConnected}
      />
    </div>
  );
}
