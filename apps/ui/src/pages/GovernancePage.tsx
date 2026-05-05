import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { GRANT_CATALOG } from "@/lib/grants";
import type { IndexedProposal, IndexedVotingPower } from "@/lib/indexer";
import type { Role } from "@/lib/types";
import { useGovernance } from "@/hooks/useGovernance";
import { useDaemonStore } from "@/store/daemon";

interface GovernancePageProps {
  entityId: string;
}

/**
 * Governance tab — two panels:
 *
 * 1. Role-based authority map (who holds which grant).
 * 2. On-chain proposals section: shown when the indexer is enabled and the
 *    TRUST has a governance module attached. Degrades to an empty state when
 *    either condition is absent.
 *
 * A small voting-power chip shows the connected account's weight in this
 * Company when the indexer reports it.
 */
export default function GovernancePage({ entityId }: GovernancePageProps) {
  const entity = useDaemonStore((s) => s.entities.find((e) => e.id === entityId));
  const trustAddress = entity?.trust_address;
  const navigate = useNavigate();

  const [roles, setRoles] = useState<Role[] | null>(null);
  const [rolesError, setRolesError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setRoles(null);
    setRolesError(null);
    (async () => {
      try {
        const { roles: fetched } = await api.getRoles(entityId);
        if (!cancelled) setRoles(fetched);
      } catch (err) {
        if (!cancelled) setRolesError(err instanceof Error ? err.message : String(err));
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

  // Voting power is only available when the user has a connected wallet —
  // no wallet_address on the User type yet, so we degrade to undefined.
  const { proposals, votingPower, error: govError } = useGovernance(trustAddress);

  if (rolesError) {
    return (
      <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
        <EmptyState title="Governance" description={`Couldn't load roles: ${rolesError}`} />
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

      {trustAddress && (
        <ProposalsSection proposals={proposals} votingPower={votingPower} error={govError} />
      )}
    </div>
  );
}

// ── Grant authority map ────────────────────────────────────────────────────

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
        <Badge variant="neutral" size="sm">
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
            <Button key={r.id} variant="secondary" size="sm" onClick={() => onOpenRole(r.id)}>
              {r.title}
              {r.founder ? " · founder" : ""}
            </Button>
          ))}
        </div>
      )}
    </li>
  );
}

// ── On-chain proposals ─────────────────────────────────────────────────────

interface ProposalsSectionProps {
  proposals: IndexedProposal[] | null;
  votingPower: IndexedVotingPower | null | undefined;
  error: string | null;
}

const PROPOSAL_STATUS_VARIANT: Record<
  string,
  "success" | "info" | "warning" | "error" | "muted" | "neutral"
> = {
  active: "info",
  passed: "success",
  executed: "success",
  failed: "error",
  canceled: "muted",
  pending: "neutral",
};

/** Format a raw 18-decimal token string as a compact human number (e.g. "12.5k"). */
function formatVotes(raw: string): string {
  const n = Number(raw) / 1e18;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(2);
}

/** Relative time from a block-based unix timestamp (seconds). */
function relativeTime(unixSec: number): string {
  const nowSec = Date.now() / 1000;
  const diff = unixSec - nowSec;
  const abs = Math.abs(diff);
  const isPast = diff < 0;

  const fmt = (n: number, unit: string) => (isPast ? `${n} ${unit} ago` : `in ${n} ${unit}`);

  if (abs < 60) return isPast ? "just now" : "in moments";
  if (abs < 3600) return fmt(Math.round(abs / 60), "min");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "hr");
  return fmt(Math.round(abs / 86400), "day");
}

function ProposalsSection({ proposals, votingPower, error }: ProposalsSectionProps) {
  return (
    <section style={{ marginTop: "var(--space-xl)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-md)",
          marginBottom: "var(--space-md)",
          flexWrap: "wrap",
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: "var(--text-sm)",
            color: "var(--color-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          On-chain proposals
        </h3>

        {votingPower != null && <VotingPowerChip votingPower={votingPower} />}
      </div>

      {error && (
        <p style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
          Couldn&apos;t load proposals: {error}
        </p>
      )}

      {!error && proposals === null && <Spinner />}

      {!error && proposals !== null && proposals.length === 0 && (
        <EmptyState
          title="No governance proposals yet."
          description="Once Roles propose changes on-chain, they'll appear here."
        />
      )}

      {!error && proposals !== null && proposals.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {proposals.map((p) => (
            <ProposalRow key={p.proposalId} proposal={p} />
          ))}
        </ul>
      )}
    </section>
  );
}

function VotingPowerChip({ votingPower }: { votingPower: IndexedVotingPower }) {
  const formatted = formatVotes(votingPower.votingPower);
  return (
    <div
      className="voting-power-chip"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-xs)",
        background: "var(--color-card)",
        padding: "2px var(--space-sm)",
      }}
    >
      <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-muted)" }}>
        Your voting power
      </span>
      <span style={{ fontSize: "var(--text-sm)", fontWeight: 500 }}>{formatted}</span>
    </div>
  );
}

function ProposalRow({ proposal: p }: { proposal: IndexedProposal }) {
  const statusVariant = PROPOSAL_STATUS_VARIANT[p.status.toLowerCase()] ?? "neutral";
  const title = p.title ?? `${p.proposalId.slice(0, 16)}…`;
  const endsAt = relativeTime(p.voteEnd);
  const isPast = p.voteEnd * 1000 < Date.now();

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
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "var(--space-md)",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 180 }}>
          <div style={{ fontWeight: 500 }}>{title}</div>
          <div
            style={{
              color: "var(--color-text-muted)",
              fontSize: "var(--text-sm)",
              marginTop: "var(--space-0)",
            }}
          >
            {isPast ? "Ended" : "Ends"} {endsAt}
          </div>
        </div>
        <Badge variant={statusVariant} size="sm">
          {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
        </Badge>
      </div>

      <VoteBar forVotes={p.forVotes} againstVotes={p.againstVotes} />
    </li>
  );
}

function VoteBar({ forVotes, againstVotes }: { forVotes: string; againstVotes: string }) {
  const forN = Number(forVotes) / 1e18;
  const againstN = Number(againstVotes) / 1e18;
  const total = forN + againstN;
  const forPct = total > 0 ? (forN / total) * 100 : 50;

  return (
    <div style={{ marginTop: "var(--space-sm)" }}>
      <div
        style={{
          display: "flex",
          gap: "var(--space-sm)",
          fontSize: "var(--text-sm)",
          color: "var(--color-text-muted)",
          marginBottom: "var(--space-xs)",
          justifyContent: "space-between",
        }}
      >
        <span>For {formatVotes(forVotes)}</span>
        <span>Against {formatVotes(againstVotes)}</span>
      </div>
      <div
        className="vote-bar-container"
        role="meter"
        aria-label="Vote distribution"
        aria-valuenow={Math.round(forPct)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: 4,
          background: "var(--color-bg-base)",
          overflow: "hidden",
        }}
      >
        <div
          className="vote-bar-fill"
          style={{
            height: "100%",
            width: `${forPct}%`,
            background: "var(--color-text-primary)",
          }}
        />
      </div>
    </div>
  );
}
