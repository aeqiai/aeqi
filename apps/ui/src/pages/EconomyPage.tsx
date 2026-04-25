import { useEffect } from "react";

/**
 * /economy — the aeqi economic surface.
 *
 * The fifth-layer view: agent wallets, ownership graph, cap-table
 * primitives, value flows. Per the AEQI root vision: companies are root
 * agents with wallets; recursive scoping; DAO cap tables. This page is
 * where operators read and reason about the economic substrate of their
 * agents. User-root scope (no agent prefix).
 *
 * Stub for now. Future surfaces this will host:
 *   - Per-agent wallet view (balance, recent value flows)
 *   - Cap-table for company-root agents
 *   - Ownership graph (who-owns-what across the agent tree)
 *   - On-chain identity + signing controls
 *   - Cost telemetry rolled up by agent / quest / event
 */
export default function EconomyPage() {
  useEffect(() => {
    document.title = "economy · æqi";
  }, []);

  return (
    <div className="economy-page">
      <div className="economy-page-inner">
        <h1 className="economy-page-title">economy</h1>
        <p className="economy-page-lede">
          The economic substrate of your agents. Coming next: wallets, cap tables, ownership graph,
          on-chain identity, and cost telemetry rolled up across the agent tree.
        </p>
      </div>
    </div>
  );
}
