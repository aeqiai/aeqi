import { useDaemonStore } from "@/store/daemon";
import { entityBasePath } from "@/lib/entityPath";
import TrustHeroStrip from "./TrustHeroStrip";
import TrustHeroOverview from "./TrustHeroOverview";
import TrustRolesGroup from "./TrustRolesGroup";
import TrustExecutionGroup from "./TrustExecutionGroup";
import TrustOwnershipGroup from "./TrustOwnershipGroup";
import TrustActivityCard from "./TrustActivityCard";
import TrustPublicRow from "./TrustPublicRow";
import "@/styles/overview.css";

/**
 * Bare `/trust/<addr>` — private Trust cockpit.
 *
 * MVP layout: identity/status header, one activity readout, then the three
 * route groups the operator needs to orient: authority, operations, capital.
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
      <TrustActivityCard trustAddress={trustAddress ?? trustId} />
      <div className="trust-cockpit-row">
        <TrustRolesGroup trustId={trustId} basePath={basePath} />
        <TrustExecutionGroup trustId={trustId} basePath={basePath} />
        <TrustOwnershipGroup trustAddress={trustAddress} basePath={basePath} />
      </div>
      <TrustPublicRow />
    </div>
  );
}
