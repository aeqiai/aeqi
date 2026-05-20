import { useDaemonStore } from "@/store/daemon";
import { entityBasePath } from "@/lib/entityPath";
import TrustHeroStrip from "./TrustHeroStrip";
import TrustHeroOverview from "./TrustHeroOverview";
import TrustRolesGroup from "./TrustRolesGroup";
import TrustExecutionGroup from "./TrustExecutionGroup";
import TrustOwnershipGroup from "./TrustOwnershipGroup";
import TrustPublicRow from "./TrustPublicRow";
import "@/styles/overview.css";

/**
 * `/trust/<addr>/overview` — TRUST cockpit (v4, 2026-05-20).
 *
 * The hero is now a photo-backed card (same start-hero portal + radial
 * mask as the / page) with a right-sided overview panel that
 * consolidates the two group header bars (programmable execution +
 * programmable ownership) that used to sit on their own rows. The
 * 4-card execution row and 4-card ownership row underneath lose their
 * header bars — they're bare card grids now, anchored by the hero's
 * aside panel.
 *
 *   1. Hero card — left: avatar + display name + tagline (identity).
 *      right: TrustHeroOverview (runtime state + CTA, TRUST address +
 *      signers + on-chain mirror status).
 *   2. Execution cards — Agents · Quests · Events · Ideas.
 *   3. Ownership cards — Assets · Equity · Quorum · Incorporation.
 *      Every signal is sourced from on-chain reads (`useAssets` /
 *      `useEquity` / `useQuorum` / `useIncorporation`).
 *   4. Public surface (half/half) — Updates (timeline) + Data Room
 *      (documents). Placeholders for now; structure is what matters.
 *
 * Retired in this pass:
 *   · TrustExecutionGroup header bar → in TrustHeroOverview
 *   · TrustOwnershipGroup header bar → in TrustHeroOverview
 *   · TrustHeroStrip plan label + public/private toggle + "TRUST"
 *     eyebrow → bloated header chrome that didn't earn the space.
 */
export default function TrustOverviewTab({ trustId }: { trustId: string }) {
  const entities = useDaemonStore((s) => s.entities);
  const entity = entities.find((e) => e.id === trustId);
  const trustAddress = entity?.trust_address;
  const basePath = entity ? entityBasePath(entity) : "/launch";

  return (
    <div className="trust-overview">
      <TrustHeroStrip
        trustId={trustId}
        aside={
          <TrustHeroOverview trustId={trustId} basePath={basePath} trustAddress={trustAddress} />
        }
      />
      <section className="trust-overview-section">
        <h2 className="trust-overview-section-title">Roles</h2>
        <TrustRolesGroup trustId={trustId} basePath={basePath} />
      </section>
      <section className="trust-overview-section">
        <h2 className="trust-overview-section-title">Operations</h2>
        <TrustExecutionGroup trustId={trustId} basePath={basePath} />
      </section>
      <section className="trust-overview-section">
        <h2 className="trust-overview-section-title">Ownership</h2>
        <TrustOwnershipGroup trustAddress={trustAddress} basePath={basePath} />
      </section>
      <TrustPublicRow />
    </div>
  );
}
