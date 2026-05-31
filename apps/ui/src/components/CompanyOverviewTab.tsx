import { useDaemonStore } from "@/store/daemon";
import { entityBasePath } from "@/lib/entityPath";
import CompanyHeroStrip from "./CompanyHeroStrip";
import CompanyHeroOverview from "./CompanyHeroOverview";
import CompanyRolesGroup from "./CompanyRolesGroup";
import CompanyAppsGroup from "./CompanyAppsGroup";
import CompanyExecutionGroup from "./CompanyExecutionGroup";
import CompanyOperatingConsole from "./CompanyOperatingConsole";
import CompanyActivityCard from "./CompanyActivityCard";
import CompanyPublicRow from "./CompanyPublicRow";
import CompanyWebsitePanel from "./CompanyWebsitePanel";
import CompanyViewsWorkbench from "./CompanyViewsWorkbench";
import "@/styles/overview.css";

/**
 * Bare `/company/<addr>` — private Company Views landing.
 *
 * Today this is the standard template view: identity/status, operating
 * console, activity, and grouped route cards. Future Views should make these
 * blocks composable so humans and agents can author saved dashboards for a
 * specific reader or decision.
 */
export default function CompanyOverviewTab({ companyId }: { companyId: string }) {
  const entities = useDaemonStore((s) => s.entities);
  const entity = entities.find((e) => e.id === companyId);
  const companyAddress = entity?.company_address;
  const basePath = entity ? entityBasePath(entity) : "/launch";

  return (
    <div className="company-overview">
      <CompanyHeroStrip
        companyId={companyId}
        aside={
          <CompanyHeroOverview
            companyId={companyId}
            basePath={basePath}
            companyAddress={companyAddress}
          />
        }
      />
      <CompanyOperatingConsole companyId={companyId} basePath={basePath} />
      <CompanyViewsWorkbench companyId={companyId} />
      <CompanyActivityCard companyAddress={companyAddress ?? companyId} />
      <CompanyWebsitePanel companyId={companyId} />
      <div className="company-cockpit-row">
        <CompanyRolesGroup companyId={companyId} basePath={basePath} />
        <CompanyAppsGroup companyId={companyId} basePath={basePath} />
        <CompanyExecutionGroup companyId={companyId} basePath={basePath} />
      </div>
      <CompanyPublicRow basePath={basePath} />
    </div>
  );
}
