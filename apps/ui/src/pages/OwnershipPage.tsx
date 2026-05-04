import { useEffect, useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import {
  fetchRolesForModule,
  fetchTrustModules,
  findModuleByType,
  indexerEnabled,
  type IndexedRole,
} from "@/lib/indexer";
import { useDaemonStore } from "@/store/daemon";

interface OwnershipPageProps {
  entityId: string;
}

/**
 * Ownership tab: roles + role-holders for the on-chain TRUST. Role module
 * holds the equity-grant + director-roster surface.
 *
 * Phase C v1: lists all roles defined on the TRUST's Role module. Per-role
 * occupant resolution comes in v2 (replays roleAssignments audit log).
 */
export default function OwnershipPage({ entityId }: OwnershipPageProps) {
  const entity = useDaemonStore((s) => s.entities.find((e) => e.id === entityId));
  const trustAddress = entity?.trust_address;

  const [roles, setRoles] = useState<IndexedRole[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!indexerEnabled() || !trustAddress) {
      setRoles(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mods = await fetchTrustModules(trustAddress);
        const roleModule = findModuleByType(mods, "role");
        if (!roleModule) {
          if (!cancelled) setRoles([]);
          return;
        }
        const r = await fetchRolesForModule(roleModule.moduleAddress);
        if (!cancelled) setRoles(r);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trustAddress]);

  if (!indexerEnabled() || !trustAddress) {
    return (
      <div className="asv-main">
        <EmptyState
          title="Ownership"
          description={
            !indexerEnabled()
              ? "On-chain bridge not configured. Set VITE_INDEXER_URL."
              : "Off-chain only — no on-chain TRUST mirror for this Company yet."
          }
        />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="asv-main">
        <EmptyState title="Ownership" description={`Indexer error: ${loadError}`} />
      </div>
    );
  }

  if (roles === null) {
    return (
      <div className="asv-main">
        <EmptyState title="Ownership" description="Loading…" />
      </div>
    );
  }

  if (roles.length === 0) {
    return (
      <div className="asv-main">
        <EmptyState
          title="Ownership"
          description="No roles defined yet on the Role module. They'll appear here after Role_RoleCreated events fire."
        />
      </div>
    );
  }

  return (
    <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
      <h2 style={{ marginTop: 0 }}>Ownership</h2>
      <p style={{ color: "var(--color-text-muted)", margin: "0 0 var(--space-lg) 0" }}>
        {roles.length} roles defined on the Role module
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--color-text-muted)" }}>
            <th style={{ padding: "var(--space-xs) 0" }}>Role ID</th>
            <th style={{ padding: "var(--space-xs) 0" }}>Created by</th>
            <th style={{ padding: "var(--space-xs) 0" }}>Block</th>
          </tr>
        </thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.roleId}>
              <td style={{ padding: "var(--space-xs) 0", fontFamily: "var(--font-mono)" }}>
                {r.roleId.slice(0, 12)}…
              </td>
              <td style={{ padding: "var(--space-xs) 0", fontFamily: "var(--font-mono)" }}>
                {r.creatorAddress}
              </td>
              <td style={{ padding: "var(--space-xs) 0" }}>{r.createdBlock}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
