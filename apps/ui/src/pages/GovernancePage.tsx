import { useEffect, useState } from "react";

import { EmptyState } from "@/components/ui/EmptyState";
import {
  fetchProposalsForModule,
  fetchTrustModules,
  findModuleByType,
  indexerEnabled,
  type IndexedProposal,
} from "@/lib/indexer";
import { useDaemonStore } from "@/store/daemon";

interface GovernancePageProps {
  entityId: string;
}

/**
 * Governance tab: proposals + their lifecycle status from the TRUST's
 * Governance module. Phase C v1: lists proposals with status; per-proposal
 * vote count breakdown comes in v2 (votesForProposal aggregation).
 */
export default function GovernancePage({ entityId }: GovernancePageProps) {
  const entity = useDaemonStore((s) => s.entities.find((e) => e.id === entityId));
  const trustAddress = entity?.trust_address;

  const [proposals, setProposals] = useState<IndexedProposal[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!indexerEnabled() || !trustAddress) {
      setProposals(null);
      return;
    }
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
          title="Governance"
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
        <EmptyState title="Governance" description={`Indexer error: ${loadError}`} />
      </div>
    );
  }

  if (proposals === null) {
    return (
      <div className="asv-main">
        <EmptyState title="Governance" description="Loading…" />
      </div>
    );
  }

  if (proposals.length === 0) {
    return (
      <div className="asv-main">
        <EmptyState
          title="Governance"
          description="No proposals yet. They'll appear here after Governance_ProposalCreated events fire."
        />
      </div>
    );
  }

  return (
    <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
      <h2 style={{ marginTop: 0 }}>Governance</h2>
      <p style={{ color: "var(--color-text-muted)", margin: "0 0 var(--space-lg) 0" }}>
        {proposals.length} proposals
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left", color: "var(--color-text-muted)" }}>
            <th style={{ padding: "var(--space-xs) 0" }}>Proposal</th>
            <th style={{ padding: "var(--space-xs) 0" }}>Status</th>
            <th style={{ padding: "var(--space-xs) 0" }}>Proposer</th>
            <th style={{ padding: "var(--space-xs) 0" }}>Created</th>
          </tr>
        </thead>
        <tbody>
          {proposals.map((p) => (
            <tr key={p.proposalId}>
              <td style={{ padding: "var(--space-xs) 0", fontFamily: "var(--font-mono)" }}>
                {p.proposalId.slice(0, 12)}…
              </td>
              <td style={{ padding: "var(--space-xs) 0" }}>{p.status}</td>
              <td style={{ padding: "var(--space-xs) 0", fontFamily: "var(--font-mono)" }}>
                {p.proposerAddress.slice(0, 10)}…
              </td>
              <td style={{ padding: "var(--space-xs) 0" }}>{p.createdBlock}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
