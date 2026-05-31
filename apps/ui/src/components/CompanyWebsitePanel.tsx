import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, BarChart3, Globe, ShieldCheck, Workflow } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { entityBasePath } from "@/lib/entityPath";
import { formatInteger } from "@/lib/i18n";
import { publicWebsiteDomain, publicWebsiteUrl } from "@/lib/publicWebsite";
import { useDaemonStore } from "@/store/daemon";

interface CompanyWebsitePanelProps {
  companyId: string;
  mode?: "card" | "page";
}

const publicModules = [
  {
    label: "Directors and roles",
    detail: "Publish the authority graph without exposing private reporting lines.",
    to: "/roles",
    icon: Workflow,
  },
];

export default function CompanyWebsitePanel({
  companyId,
  mode = "card",
}: CompanyWebsitePanelProps) {
  const entities = useDaemonStore((s) => s.entities);
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const entity = entities.find((item) => item.id === companyId);
  const [publishingWebsite, setPublishingWebsite] = useState(false);

  const basePath = entity ? entityBasePath(entity) : "/launch";
  const websiteDomain = entity ? publicWebsiteDomain(entity) : "Launch hostname";
  const websiteHref = entity ? publicWebsiteUrl(entity) : null;
  const websiteStatus = entity?.public ? "Live" : "Private";
  const websiteAnalytics = useQuery({
    queryKey: ["company-website-analytics", companyId],
    queryFn: () => api.getCompanyWebsiteAnalytics(companyId),
    enabled: Boolean(entity),
    staleTime: 20_000,
  });
  const analyticsStatus = analyticsTrackingLabel(
    websiteAnalytics.data,
    websiteAnalytics.isLoading,
    entity?.public === true,
  );
  const websiteViews = websiteAnalytics.data?.stats
    ? formatInteger(websiteAnalytics.data.stats.last_24h.pageviews)
    : websiteAnalytics.isLoading
      ? "Checking"
      : websiteAnalytics.data?.status === "setup_required"
        ? "Setup"
        : "—";
  const visitors7d = websiteAnalytics.data?.stats
    ? formatInteger(websiteAnalytics.data.stats.last_7d.visitors)
    : "—";
  const analyticsMessage =
    websiteAnalytics.data?.status === "setup_required"
      ? "Tracking is installed; stats access is waiting on platform configuration."
      : websiteAnalytics.data?.status === "live"
        ? "Plausible tracking is installed and dashboard counts are synced from the platform."
        : "Launch assigns this website from the COMPANY name; analytics stay scoped to this company surface.";

  const publishWebsite = useCallback(async () => {
    if (!entity || entity.public) return;
    setPublishingWebsite(true);
    try {
      await api.updateEntity(entity.id, { public: true });
      await fetchEntities();
    } catch (e) {
      console.error("failed to publish company website", e);
    } finally {
      setPublishingWebsite(false);
    }
  }, [entity, fetchEntities]);

  return (
    <section
      className={`company-cockpit-card company-cockpit-card--wide company-website-card company-website-card--${mode}`}
      aria-labelledby="website-heading"
    >
      <header className="company-cockpit-card-header company-website-card-header">
        <div className="company-website-title-block">
          <h2 id="website-heading" className="company-cockpit-card-title">
            Website
          </h2>
          <p className="company-cockpit-card-sub company-website-subtitle">
            Public website created with the COMPANY for demos and marketplaces.
          </p>
        </div>
        <span
          className="company-app-status-pill"
          data-status={entity?.public ? "connected" : undefined}
        >
          {websiteStatus}
        </span>
      </header>

      <div className="company-website-body">
        <div className="company-website-route-row">
          <span className="company-website-route">{websiteHref ?? websiteDomain}</span>
          <div className="company-website-actions">
            {entity?.public && websiteHref ? (
              <a
                className="company-app-card-action"
                href={websiteHref}
                target="_blank"
                rel="noreferrer"
              >
                <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden />
                Open Website
              </a>
            ) : (
              <Button
                variant="primary"
                size="md"
                onClick={publishWebsite}
                leadingIcon={<Globe size={14} strokeWidth={1.6} />}
              >
                {publishingWebsite ? "Publishing" : "Publish Website"}
              </Button>
            )}
          </div>
        </div>

        <div className="company-app-card-stats company-website-stats">
          <Stat label="Subdomain" value={compactText(websiteDomain)} />
          <Stat label="Tracking" value={analyticsStatus} />
          <Stat label="Today Views" value={websiteViews} />
          <Stat label="7d Visitors" value={visitors7d} />
        </div>

        <div className="company-website-module-grid" aria-label="Public website modules">
          {publicModules.map((item) => (
            <CompanyWebsiteModule key={item.label} item={item} basePath={basePath} />
          ))}
          <Link to={`${basePath}/quests`} className="company-public-item">
            <span className="company-public-item-icon" aria-hidden>
              <BarChart3 size={15} strokeWidth={1.5} />
            </span>
            <span className="company-public-item-copy">
              <span className="company-public-item-label">Activity</span>
              <span className="company-public-item-detail">
                Show what is moving without exposing private operator context.
              </span>
            </span>
          </Link>
        </div>

        <div className="company-website-privacy-row">
          <ShieldCheck size={15} strokeWidth={1.6} aria-hidden />
          <span>{analyticsMessage}</span>
        </div>
      </div>
    </section>
  );
}

function analyticsTrackingLabel(
  analytics: Awaited<ReturnType<typeof api.getCompanyWebsiteAnalytics>> | undefined,
  loading: boolean,
  live: boolean,
): string {
  if (loading) return "Checking";
  if (analytics?.tracking_status === "installed") return "Installed";
  if (live) return "Installed";
  return "Ready";
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="company-apps-stat">
      <span className="company-apps-stat-value">{value}</span>
      <span className="company-apps-stat-label">{label}</span>
    </span>
  );
}

function CompanyWebsiteModule({
  item,
  basePath,
}: {
  item: (typeof publicModules)[number];
  basePath: string;
}) {
  const Icon = item.icon;
  return (
    <Link to={`${basePath}${item.to}`} className="company-public-item">
      <span className="company-public-item-icon" aria-hidden>
        <Icon size={15} strokeWidth={1.5} />
      </span>
      <span className="company-public-item-copy">
        <span className="company-public-item-label">{item.label}</span>
        <span className="company-public-item-detail">{item.detail}</span>
      </span>
    </Link>
  );
}

function compactText(value: string): string {
  if (value.length <= 24) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}
