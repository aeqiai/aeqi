import { useDaemonStore } from "@/store/daemon";
import { entityBasePath } from "@/lib/entityPath";
import TrustHeroStrip from "./TrustHeroStrip";
import TrustHeroOverview from "./TrustHeroOverview";
import TrustRolesGroup from "./TrustRolesGroup";
import TrustAppsGroup from "./TrustAppsGroup";
import TrustExecutionGroup from "./TrustExecutionGroup";
import TrustOperatingConsole from "./TrustOperatingConsole";
import TrustActivityCard from "./TrustActivityCard";
import TrustPublicRow from "./TrustPublicRow";
import TrustWebsitePanel from "./TrustWebsitePanel";
import TrustViewsWorkbench from "./TrustViewsWorkbench";
import "@/styles/overview.css";

/**
 * Bare `/trust/<addr>` — private Trust Views landing.
 *
 * Today this is the standard template view: identity/status, operating
 * console, activity, and grouped route cards. Future Views should make these
 * blocks composable so humans and agents can author saved dashboards for a
 * specific reader or decision.
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
      <TrustOperatingConsole trustId={trustId} basePath={basePath} />
      <TrustViewsWorkbench trustId={trustId} />
      <TrustActivityCard trustAddress={trustAddress ?? trustId} />
      <TrustWebsitePanel trustId={trustId} />
      <div className="trust-cockpit-row">
        <TrustRolesGroup trustId={trustId} basePath={basePath} />
        <TrustAppsGroup trustId={trustId} basePath={basePath} />
        <TrustExecutionGroup trustId={trustId} basePath={basePath} />
      </div>
      <TrustPublicRow basePath={basePath} />
    </div>
  );
}
