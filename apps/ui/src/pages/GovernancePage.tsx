import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { GRANT_CATALOG } from "@/lib/grants";
import {
  fetchProposalsForModule,
  fetchTrustModules,
  findModuleByType,
  indexerEnabled,
  type IndexedProposal,
} from "@/lib/indexer";
import type { Role } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";

interface GovernancePageProps {
  entityId: string;
}

/**
 * Phase 1 governance view: who can decide what. Authority is role-based
 * — each role carries a grant set, and grants determine which surfaces
 * (treasury, settings, agents, governance itself) the role's occupant
 * can act on. The on-chain proposal log — present once the Solana
 * bridge has indexed the entity — appears as a supplementary section.
 */
export default function GovernancePage({ entityId }: GovernancePageProps) {
  const entity = useDaemonStore((s) => s.entities.find((e) => e.id === entityId));
  const trustAddress = entity?.trust_address;
  const navigate = useNavigate();

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRoles(null);
    setError(null);
    (async () => {
      try {
        const { roles } = await api.getRoles(entityId);
        if (!cancelled) setRoles(roles);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const grantHolders = useMemo(() => {
    if (!roles) return null;
    const out: Record<string, Role[]> = {};
    for (const g of GRANT_CATALOG) {
      out[g.id] = roles.filter((r) => r.grants.includes(g.id));
    }
    return out;
  }, [roles]);

  if (error) {
    return (
      <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
        <EmptyState title="Governance" description={`Couldn't load roles: ${error}`} />
      </div>
    );
  }

  if (!roles || !grantHolders) {
    return (
      <div
        className="asv-main"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-xl)",
        }}
      >
        <Spinner />
      </div>
    );
  }

  return (
    <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
      <header style={{ marginBottom: "var(--space-lg)" }}>
        <h2 style={{ margin: 0 }}>Governance</h2>
        <p style={{ color: "var(--color-text-muted)", margin: "var(--space-xs) 0 0 0" }}>
          Decision authority is role-based. Each grant is a permission a role's occupant can
          exercise.
        </p>
      </header>

      {roles.length === 0 ? (
        <EmptyState
          title="No roles defined yet"
          description="Add a role from the Roles tab to start distributing decision authority."
        />
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {GRANT_CATALOG.map((g) => (
            <GrantRow
              key={g.id}
              grantLabel={g.label}
              grantDesc={g.desc}
              holders={grantHolders[g.id]}
              onOpenRole={(roleId) => navigate(`/c/${entityId}/roles/${roleId}`)}
            />
          ))}
        </ul>
      )}

      {indexerEnabled() && trustAddress && <OnChainProposals trustAddress={trustAddress} />}
    </div>
  );
}

interface GrantRowProps {
  grantLabel: string;
  grantDesc: string;
  holders: Role[];
  onOpenRole: (roleId: string) => void;
}

function GrantRow({ grantLabel, grantDesc, holders, onOpenRole }: GrantRowProps) {
  return (
    <li
      style={{
        background: "var(--color-card)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-md)",
        marginBottom: "var(--space-sm)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "var(--space-md)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontWeight: 500 }}>{grantLabel}</div>
          <div
            style={{
              color: "var(--color-text-muted)",
              fontSize: "var(--text-sm)",
              marginTop: "var(--space-0)",
            }}
          >
            {grantDesc}
          </div>
        </div>
        <Badge variant={holders.length > 0 ? "success" : "muted"} size="sm">
          {holders.length} {holders.length === 1 ? "role" : "roles"}
        </Badge>
      </div>
      {holders.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: "var(--space-xs)",
            flexWrap: "wrap",
            marginTop: "var(--space-sm)",
          }}
        >
          {holders.map((r) => (
            <Button
              key={r.id}
              variant="secondary"
              size="sm"
              onClick={() => onOpenRole(r.id)}
            >
              {r.title}
              {r.founder ? " · founder" : ""}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

function OnChainProposals({ trustAddress }: { trustAddress: string }) {
  const [proposals, setProposals] = useState<IndexedProposal[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mods = await fetchTrustModules(trustAddress);
        const govModule = findModuleByType(mods, "governance");
        if (!govModule) {
          if (!cancelled) setProposals([]);
          return;
        }
        const p = await fetchProposalsForModule(govModule.moduleAddress);
        if (!cancelled) setProposals(p);
      } catch {
        if (!cancelled) setProposals([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trustAddress]);

  if (!proposals || proposals.length === 0) return null;

  return (
    <section style={{ marginTop: "var(--space-xl)" }}>
      <h3
        style={{
          margin: "0 0 var(--space-sm) 0",
          fontSize: "var(--text-sm)",
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        On-chain proposals · {proposals.length}
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {proposals.map((p) => (
          <li
            key={p.proposalId}
            style={{
              padding: "var(--space-xs) var(--space-md)",
              fontFamily: "var(--font-mono)",
              fontSize: "var(--text-sm)",
              color: "var(--color-text-muted)",
            }}
          >
            {p.proposalId.slice(0, 12)}… · {p.status} · block {p.createdBlock}
          </li>
        ))}
      </ul>
    </section>
  );
}
