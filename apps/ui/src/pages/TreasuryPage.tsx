import { useEffect, useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import {
  fetchTokenHolders,
  fetchTrustModules,
  findModuleByType,
  indexerEnabled,
  type IndexedModule,
  type IndexedTokenBalance,
} from "@/lib/indexer";
import { useDaemonStore } from "@/store/daemon";

interface TreasuryPageProps {
  entityId: string;
}

/**
 * Treasury tab: cap-table + module inventory for the on-chain TRUST that
 * mirrors this entity. Wired in Phase C of the click→DAO milestone.
 *
 * States:
 * - indexer disabled (no VITE_INDEXER_URL) → EmptyState
 * - entity has no trust_address yet (DAO bridge hasn't fired or is still
 *   provisioning) → EmptyState explaining the state
 * - trust found → modules list + per-Token-module holder table
 */
export default function TreasuryPage({ entityId }: TreasuryPageProps) {
  const entity = useDaemonStore((s) => s.entities.find((e) => e.id === entityId));
  const trustAddress = entity?.trust_address;

  const [modules, setModules] = useState<IndexedModule[] | null>(null);
  const [holders, setHolders] = useState<IndexedTokenBalance[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!indexerEnabled() || !trustAddress) {
      setModules(null);
      setHolders([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mods = await fetchTrustModules(trustAddress);
        if (cancelled) return;
        setModules(mods);
        const tokenModule = findModuleByType(mods, "token");
        if (tokenModule) {
          const balances = await fetchTokenHolders(tokenModule.moduleAddress);
          if (cancelled) return;
          setHolders(balances);
        } else {
          setHolders([]);
        }
      } catch (err) {
        if (cancelled) return;
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trustAddress]);

  if (!indexerEnabled()) {
    return (
      <div className="asv-main">
        <EmptyState
          title="Treasury"
          description="On-chain bridge not configured. Set VITE_INDEXER_URL to enable cap-table + module inventory."
        />
      </div>
    );
  }

  if (!trustAddress) {
    return (
      <div className="asv-main">
        <EmptyState
          title="Treasury"
          description="Off-chain only — this Company has no on-chain TRUST mirror yet. The DAO bridge fires on Company creation; existing Companies need to be re-provisioned."
        />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="asv-main">
        <EmptyState title="Treasury" description={`Indexer error: ${loadError}`} />
      </div>
    );
  }

  if (modules === null) {
    return (
      <div className="asv-main">
        <EmptyState title="Treasury" description="Loading…" />
      </div>
    );
  }

  return (
    <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
      <h2 style={{ marginTop: 0 }}>Treasury</h2>
      <p style={{ color: "var(--color-text-muted)", margin: "0 0 var(--space-lg) 0" }}>
        On-chain TRUST: <code>{trustAddress}</code> · {modules.length} modules attached
      </p>

      <h3>Modules</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--color-text-muted)" }}>
            <th style={{ padding: "var(--space-xs) 0" }}>Module ID</th>
            <th style={{ padding: "var(--space-xs) 0" }}>Address</th>
            <th style={{ padding: "var(--space-xs) 0" }}>Block</th>
          </tr>
        </thead>
        <tbody>
          {modules.map((m) => (
            <tr key={m.moduleAddress}>
              <td style={{ padding: "var(--space-xs) 0", fontFamily: "var(--font-mono)" }}>
                {m.moduleId.slice(0, 10)}…
              </td>
              <td style={{ padding: "var(--space-xs) 0", fontFamily: "var(--font-mono)" }}>
                {m.moduleAddress}
              </td>
              <td style={{ padding: "var(--space-xs) 0" }}>{m.attachedBlock}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {holders.length > 0 && (
        <>
          <h3 style={{ marginTop: "var(--space-lg)" }}>Cap table</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--color-text-muted)" }}>
                <th style={{ padding: "var(--space-xs) 0" }}>Holder</th>
                <th style={{ padding: "var(--space-xs) 0" }}>Balance (hex)</th>
                <th style={{ padding: "var(--space-xs) 0" }}>Updated block</th>
              </tr>
            </thead>
            <tbody>
              {holders.map((h) => (
                <tr key={h.holderAddress}>
                  <td style={{ padding: "var(--space-xs) 0", fontFamily: "var(--font-mono)" }}>
                    {h.holderAddress}
                  </td>
                  <td style={{ padding: "var(--space-xs) 0", fontFamily: "var(--font-mono)" }}>
                    {h.balance}
                  </td>
                  <td style={{ padding: "var(--space-xs) 0" }}>{h.lastUpdatedBlock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
