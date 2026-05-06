import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { Spinner } from "@/components/ui/Spinner";
import { useOwnership } from "@/hooks/useOwnership";
import { indexerEnabled, type TrustRole, type TrustRoleRequest } from "@/lib/indexer";
import type { Role, RoleType } from "@/lib/types";
import { api } from "@/lib/api";
import { useDaemonStore } from "@/store/daemon";

interface OwnershipPageProps {
  entityId: string;
}

const ROLE_TYPE_ORDER: RoleType[] = ["director", "operational", "advisor"];

const ROLE_TYPE_LABEL: Record<RoleType, string> = {
  director: "Directors",
  operational: "Operational",
  advisor: "Advisors",
};

/** Truncate an EVM address to `0xabc…def` form. */
function truncateAddress(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const IPFS_GATEWAY = "https://ipfs.io/ipfs/";

/**
 * Ownership tab — two layers:
 *
 * 1. Off-chain Role primitive: Founders → Directors → Operational → Advisors.
 *    Authority is declared and flows through the org chart.
 *
 * 2. On-chain cap-table mirror: roles indexed from the entity's TRUST via
 *    `rolesForTrust(trustId)`. Degrades gracefully to hidden when the indexer
 *    field is not yet shipped. Each row is clickable → detail modal.
 */
export default function OwnershipPage({ entityId }: OwnershipPageProps) {
  const entity = useDaemonStore((s) => s.entities.find((e) => e.id === entityId));
  const agents = useDaemonStore((s) => s.agents);
  const navigate = useNavigate();
  const trustId = entity?.trust_id;

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRoles(null);
    setError(null);
    (async () => {
      try {
        const { roles: fetched } = await api.getRoles(entityId);
        if (!cancelled) setRoles(fetched);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const grouped = useMemo(() => {
    if (!roles) return null;
    const founders = roles.filter((r) => r.founder);
    const byType: Record<RoleType, Role[]> = { director: [], operational: [], advisor: [] };
    for (const r of roles) {
      if (r.founder) continue;
      byType[r.role_type].push(r);
    }
    return { founders, byType };
  }, [roles]);

  const occupantLabel = (role: Role): string => {
    if (role.occupant_kind === "vacant" || !role.occupant_id) return "Vacant — hiring";
    if (role.occupant_kind === "agent") {
      const agent = agents.find((a) => a.id === role.occupant_id);
      return agent ? agent.name : "Agent";
    }
    // Human: prefer platform-resolved display name.
    if (role.occupant_name) return role.occupant_name;
    const id = role.occupant_id;
    return `${id.slice(0, 4)}…${id.slice(-4)}`;
  };

  if (error) {
    return (
      <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
        <EmptyState title="Ownership" description={`Couldn't load roles: ${error}`} />
      </div>
    );
  }

  if (!roles || !grouped) {
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

  if (roles.length === 0) {
    return (
      <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
        <EmptyState
          title="Ownership"
          description="No roles defined yet. Add a role from the Roles tab to start the org chart."
        />
      </div>
    );
  }

  return (
    <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
      <header style={{ marginBottom: "var(--space-lg)" }}>
        <h2 style={{ margin: 0 }}>Ownership</h2>
        <p style={{ color: "var(--color-text-muted)", margin: "var(--space-xs) 0 0 0" }}>
          Who owns and runs this Company. Authority flows through roles.
        </p>
      </header>

      {grouped.founders.length > 0 && (
        <RoleSection
          title="Founders"
          roles={grouped.founders}
          occupantLabel={occupantLabel}
          onOpenRole={(roleId) => navigate(`/c/${entityId}/roles/${roleId}`)}
        />
      )}

      {ROLE_TYPE_ORDER.map((t) =>
        grouped.byType[t].length > 0 ? (
          <RoleSection
            key={t}
            title={ROLE_TYPE_LABEL[t]}
            roles={grouped.byType[t]}
            occupantLabel={occupantLabel}
            onOpenRole={(roleId) => navigate(`/c/${entityId}/roles/${roleId}`)}
          />
        ) : null,
      )}

      {indexerEnabled() && trustId && <OnChainCapTable trustId={trustId} />}
    </div>
  );
}

// ── Off-chain role list ────────────────────────────────────────────────────

interface RoleSectionProps {
  title: string;
  roles: Role[];
  occupantLabel: (role: Role) => string;
  onOpenRole: (roleId: string) => void;
}

function RoleSection({ title, roles, occupantLabel, onOpenRole }: RoleSectionProps) {
  return (
    <section style={{ marginBottom: "var(--space-lg)" }}>
      <h3
        style={{
          margin: "0 0 var(--space-sm) 0",
          fontSize: "var(--text-sm)",
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {title}
        <span style={{ marginLeft: "var(--space-xs)" }}>· {roles.length}</span>
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {roles.map((r) => (
          <li
            key={r.id}
            onClick={() => onOpenRole(r.id)}
            style={{
              padding: "var(--space-sm) var(--space-md)",
              background: "var(--color-card)",
              borderRadius: "var(--radius-md)",
              marginBottom: "var(--space-xs)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-md)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500 }}>{r.title}</div>
              <div
                style={{
                  fontSize: "var(--text-sm)",
                  color: "var(--color-text-muted)",
                  marginTop: "var(--space-0)",
                }}
              >
                {occupantLabel(r)}
              </div>
            </div>
            <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>
              {r.founder && (
                <Badge variant="accent" size="sm">
                  Founder
                </Badge>
              )}
              <Badge variant="muted" size="sm">
                {r.grants.length} {r.grants.length === 1 ? "grant" : "grants"}
              </Badge>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── On-chain cap-table mirror ──────────────────────────────────────────────

function OnChainCapTable({ trustId }: { trustId: string }) {
  const { roles, pending, loading, error } = useOwnership(trustId);
  const [selected, setSelected] = useState<TrustRole | null>(null);

  // Surface errors briefly in console; don't render a noisy error state for
  // an optional section — the off-chain view above is always the authority.
  useEffect(() => {
    if (error) console.warn("[OnChainCapTable]", error);
  }, [error]);

  if (loading) {
    return (
      <section style={{ marginTop: "var(--space-xl)" }}>
        <SectionLabel title="On-chain roles" count={null} />
        <ChainRolesSkeleton />
      </section>
    );
  }

  if (!loading && roles.length === 0 && pending.length === 0) {
    return (
      <section style={{ marginTop: "var(--space-xl)" }}>
        <SectionLabel title="On-chain roles" count={0} />
        <p
          style={{
            color: "var(--color-text-muted)",
            fontSize: "var(--text-sm)",
            margin: 0,
          }}
        >
          Once roles are assigned on-chain, they'll appear here.
        </p>
      </section>
    );
  }

  return (
    <>
      {roles.length > 0 && (
        <section style={{ marginTop: "var(--space-xl)" }}>
          <SectionLabel title="On-chain roles" count={roles.length} />
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {roles.map((r, i) => (
              <ChainRoleRow key={`${r.account}-${i}`} role={r} onClick={() => setSelected(r)} />
            ))}
          </ul>
        </section>
      )}

      {pending.length > 0 && (
        <section style={{ marginTop: "var(--space-lg)" }}>
          <SectionLabel title="Pending acceptances" count={pending.length} />
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {pending.map((req, i) => (
              <PendingRequestRow key={`${req.account}-${i}`} request={req} />
            ))}
          </ul>
        </section>
      )}

      {selected && <RoleDetailModal role={selected} onClose={() => setSelected(null)} />}
    </>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ title, count }: { title: string; count: number | null }) {
  return (
    <h3
      style={{
        margin: "0 0 var(--space-sm) 0",
        fontSize: "var(--text-sm)",
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {title}
      {count !== null && <span style={{ marginLeft: "var(--space-xs)" }}>· {count}</span>}
    </h3>
  );
}

function ChainRoleRow({ role, onClick }: { role: TrustRole; onClick: () => void }) {
  return (
    <li
      onClick={onClick}
      style={{
        padding: "var(--space-sm) var(--space-md)",
        background: "var(--color-card)",
        borderRadius: "var(--radius-md)",
        marginBottom: "var(--space-xs)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-md)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
            fontWeight: 500,
          }}
        >
          {truncateAddress(role.account)}
        </div>
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
            marginTop: "var(--space-0)",
          }}
        >
          slot {role.slotIndex}
        </div>
      </div>
      <div style={{ display: "flex", gap: "var(--space-xs)", alignItems: "center" }}>
        <Badge variant="muted" size="sm">
          {role.roleTypeId.slice(0, 8)}…
        </Badge>
        {role.ipfsCid && (
          <a
            href={`${IPFS_GATEWAY}${role.ipfsCid}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{
              fontSize: "var(--text-xs)",
              color: "var(--color-text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            ipfs
          </a>
        )}
      </div>
    </li>
  );
}

function PendingRequestRow({ request }: { request: TrustRoleRequest }) {
  return (
    <li
      style={{
        padding: "var(--space-sm) var(--space-md)",
        background: "var(--color-card-subtle)",
        borderRadius: "var(--radius-md)",
        marginBottom: "var(--space-xs)",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-md)",
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--text-sm)",
          }}
        >
          {truncateAddress(request.account)}
        </div>
        <div
          style={{
            fontSize: "var(--text-xs)",
            color: "var(--color-text-muted)",
            marginTop: "var(--space-0)",
          }}
        >
          proposed by {truncateAddress(request.proposer)}
        </div>
      </div>
      <Badge variant="muted" size="sm">
        pending
      </Badge>
    </li>
  );
}

function ChainRolesSkeleton() {
  const rows = [0.7, 0.55, 0.8];
  return (
    <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {rows.map((w, i) => (
        <li
          key={i}
          style={{
            height: 52,
            background: "var(--color-card)",
            borderRadius: "var(--radius-md)",
            marginBottom: "var(--space-xs)",
            opacity: 0.5,
            width: `${w * 100}%`,
          }}
        />
      ))}
    </ul>
  );
}

function RoleDetailModal({ role, onClose }: { role: TrustRole; onClose: () => void }) {
  return (
    <Modal open title="On-chain role" onClose={onClose}>
      <div
        style={{
          padding: "var(--space-md)",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-md)",
        }}
      >
        <DetailRow label="Account">
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
            {role.account}
          </span>
        </DetailRow>
        <DetailRow label="Role type">
          <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)" }}>
            {role.roleTypeId}
          </span>
        </DetailRow>
        <DetailRow label="Slot index">
          <span>{role.slotIndex}</span>
        </DetailRow>
        {role.ipfsCid && (
          <DetailRow label="IPFS document">
            <a
              href={`${IPFS_GATEWAY}${role.ipfsCid}`}
              target="_blank"
              rel="noreferrer"
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: "var(--text-sm)",
                color: "var(--color-text-primary)",
              }}
            >
              {role.ipfsCid}
            </a>
          </DetailRow>
        )}
      </div>
    </Modal>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      <span
        style={{
          fontSize: "var(--text-xs)",
          color: "var(--color-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </span>
      <div>{children}</div>
    </div>
  );
}
