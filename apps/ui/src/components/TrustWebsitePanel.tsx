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

interface TrustWebsitePanelProps {
  trustId: string;
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

export default function TrustWebsitePanel({ trustId, mode = "card" }: TrustWebsitePanelProps) {
  const entities = useDaemonStore((s) => s.entities);
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const entity = entities.find((item) => item.id === trustId);
  const [publishingWebsite, setPublishingWebsite] = useState(false);

  const basePath = entity ? entityBasePath(entity) : "/launch";
  const websiteDomain = entity ? publicWebsiteDomain(entity) : "Launch hostname";
  const websiteHref = entity ? publicWebsiteUrl(entity) : null;
  const websiteStatus = entity?.public ? "Live" : "Private";
  const websiteAnalytics = useQuery({
    queryKey: ["trust-website-analytics", trustId],
    queryFn: () => api.getTrustWebsiteAnalytics(trustId),
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
        : "Launch assigns this website from the TRUST name; analytics stay scoped to this company surface.";

  const publishWebsite = useCallback(async () => {
    if (!entity || entity.public) return;
    setPublishingWebsite(true);
    try {
      await api.updateEntity(entity.id, { public: true });
      await fetchEntities();
    } catch (e) {
      console.error("failed to publish trust website", e);
    } finally {
      setPublishingWebsite(false);
    }
  }, [entity, fetchEntities]);

  return (
    <section
      className={`trust-cockpit-card trust-cockpit-card--wide trust-website-card trust-website-card--${mode}`}
      aria-labelledby="website-heading"
    >
      <header className="trust-cockpit-card-header trust-website-card-header">
        <div className="trust-website-title-block">
          <h2 id="website-heading" className="trust-cockpit-card-title">
            Website
          </h2>
          <p className="trust-cockpit-card-sub trust-website-subtitle">
            Public website created with the TRUST for demos and marketplaces.
          </p>
        </div>
        <span
          className="trust-app-status-pill"
          data-status={entity?.public ? "connected" : undefined}
        >
          {websiteStatus}
        </span>
      </header>

      <div className="trust-website-body">
        <div className="trust-website-route-row">
          <span className="trust-website-route">{websiteHref ?? websiteDomain}</span>
          <div className="trust-website-actions">
            {entity?.public && websiteHref ? (
              <a
                className="trust-app-card-action"
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

        <div className="trust-app-card-stats trust-website-stats">
          <Stat label="Subdomain" value={compactText(websiteDomain)} />
          <Stat label="Tracking" value={analyticsStatus} />
          <Stat label="Today Views" value={websiteViews} />
          <Stat label="7d Visitors" value={visitors7d} />
        </div>

        <div className="trust-website-module-grid" aria-label="Public website modules">
          {publicModules.map((item) => (
            <TrustWebsiteModule key={item.label} item={item} basePath={basePath} />
          ))}
          <Link to={`${basePath}/quests`} className="trust-public-item">
            <span className="trust-public-item-icon" aria-hidden>
              <BarChart3 size={15} strokeWidth={1.5} />
            </span>
            <span className="trust-public-item-copy">
              <span className="trust-public-item-label">Activity</span>
              <span className="trust-public-item-detail">
                Show what is moving without exposing private operator context.
              </span>
            </span>
          </Link>
        </div>

        <div className="trust-website-privacy-row">
          <ShieldCheck size={15} strokeWidth={1.6} aria-hidden />
          <span>{analyticsMessage}</span>
        </div>
      </div>
    </section>
  );
}

function analyticsTrackingLabel(
  analytics: Awaited<ReturnType<typeof api.getTrustWebsiteAnalytics>> | undefined,
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
    <span className="trust-apps-stat">
      <span className="trust-apps-stat-value">{value}</span>
      <span className="trust-apps-stat-label">{label}</span>
    </span>
  );
}

function TrustWebsiteModule({
  item,
  basePath,
}: {
  item: (typeof publicModules)[number];
  basePath: string;
}) {
  const Icon = item.icon;
  return (
    <Link to={`${basePath}${item.to}`} className="trust-public-item">
      <span className="trust-public-item-icon" aria-hidden>
        <Icon size={15} strokeWidth={1.5} />
      </span>
      <span className="trust-public-item-copy">
        <span className="trust-public-item-label">{item.label}</span>
        <span className="trust-public-item-detail">{item.detail}</span>
      </span>
    </Link>
  );
}

function compactText(value: string): string {
  if (value.length <= 24) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}
