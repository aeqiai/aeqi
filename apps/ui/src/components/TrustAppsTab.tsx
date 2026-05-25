import { useCallback, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUpRight, Globe, MessageCircle, Send, Smartphone } from "lucide-react";

import { api } from "@/lib/api";
import { useTrustApps } from "@/hooks/useTrustApps";
import { entityBasePath } from "@/lib/entityPath";
import { formatInteger } from "@/lib/i18n";
import { publicWebsitePath } from "@/lib/publicWebsite";
import type { TrustAppKind, TrustAppSummary } from "@/lib/trustApps";
import { useDaemonStore } from "@/store/daemon";
import { Button } from "./ui";
import "@/styles/overview.css";

const APP_ICONS: Record<TrustAppKind, React.ReactNode> = {
  telegram: <Send size={18} strokeWidth={1.5} />,
  whatsapp: <MessageCircle size={18} strokeWidth={1.5} />,
};

export default function TrustAppsTab({ trustId }: { trustId: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [publishingWebsite, setPublishingWebsite] = useState(false);
  const selectedKind = params.get("app");
  const entities = useDaemonStore((s) => s.entities);
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const entity = entities.find((item) => item.id === trustId);
  const basePath = entity ? entityBasePath(entity) : "/launch";
  const { defaultAgent, installed, isLoading, summaries, trustAgents } = useTrustApps(trustId);
  const agentChannelsPath = defaultAgent
    ? `${basePath}/agents/${encodeURIComponent(defaultAgent.id)}/settings/channels`
    : `${basePath}/agents`;
  const channelActionLabel = defaultAgent ? "Open Channels" : "Open Agents";
  const websitePath = entity ? publicWebsitePath(entity) : "/";
  const websiteStatus = entity?.public ? "Live" : "Private";
  const websiteViews = entity?.public ? "0" : "—";

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
    <div className="trust-overview trust-apps-page">
      <header className="trust-apps-page-header">
        <h1 className="trust-apps-page-title">Apps</h1>
        <div className="ideas-toolbar trust-apps-toolbar" aria-label="App controls">
          <span className="ideas-toolbar-meta trust-apps-toolbar-summary">
            {isLoading
              ? "Loading app status"
              : `${formatInteger(installed.connectedApps)} connected · ${formatInteger(
                  installed.enabledChannels,
                )} channels · ${formatInteger(trustAgents.length)} agents${
                  entity?.public ? " · website live" : ""
                }`}
          </span>
          <Button
            variant="secondary"
            size="md"
            onClick={() => navigate(agentChannelsPath)}
            leadingIcon={<Smartphone size={14} strokeWidth={1.6} />}
          >
            {defaultAgent ? "Channels" : "Agents"}
          </Button>
        </div>
      </header>

      <section
        className="trust-cockpit-card trust-cockpit-card--wide trust-website-card"
        aria-labelledby="website-heading"
      >
        <header className="trust-cockpit-card-header trust-website-card-header">
          <div className="trust-website-title-block">
            <h2 id="website-heading" className="trust-cockpit-card-title">
              Website
            </h2>
            <p className="trust-cockpit-card-sub trust-website-subtitle">
              Public trust website and live route.
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
            <span className="trust-website-route">{websitePath}</span>
            <Button
              variant={entity?.public ? "secondary" : "primary"}
              size="md"
              onClick={entity?.public ? () => navigate(websitePath) : publishWebsite}
              leadingIcon={
                entity?.public ? (
                  <ArrowUpRight size={14} strokeWidth={1.6} />
                ) : (
                  <Globe size={14} strokeWidth={1.6} />
                )
              }
            >
              {entity?.public
                ? "Open website"
                : publishingWebsite
                  ? "Publishing"
                  : "Publish website"}
            </Button>
          </div>

          <div className="trust-app-card-stats trust-website-stats">
            <Stat label="Visibility" value={websiteStatus} />
            <Stat label="Views" value={websiteViews} />
            <Stat label="Route" value={compactPath(websitePath)} />
            <Stat label="Surface" value="Website" />
          </div>
        </div>
      </section>

      <section
        className="trust-cockpit-card trust-cockpit-card--wide"
        aria-labelledby="channel-apps-heading"
      >
        <header className="trust-cockpit-card-header">
          <h2 id="channel-apps-heading" className="trust-cockpit-card-title">
            Channel apps
          </h2>
          <Link to={agentChannelsPath} className="trust-apps-link">
            {channelActionLabel}
          </Link>
        </header>
        <div className="trust-apps-grid">
          {summaries.map((summary) => (
            <AppDetailCard
              key={summary.entry.kind}
              selected={selectedKind === summary.entry.kind}
              summary={summary}
              channelsPath={agentChannelsPath}
              actionLabel={channelActionLabel}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function compactPath(path: string): string {
  if (path.length <= 24) return path;
  return `${path.slice(0, 10)}…${path.slice(-8)}`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="trust-apps-stat">
      <span className="trust-apps-stat-value">{value}</span>
      <span className="trust-apps-stat-label">{label}</span>
    </span>
  );
}

function AppDetailCard({
  actionLabel,
  channelsPath,
  selected,
  summary,
}: {
  actionLabel: string;
  channelsPath: string;
  selected: boolean;
  summary: TrustAppSummary;
}) {
  const connected = summary.status === "connected";

  return (
    <article className="trust-app-card" data-selected={selected ? "true" : undefined}>
      <header className="trust-app-card-header">
        <span className="trust-app-card-icon" aria-hidden>
          {APP_ICONS[summary.entry.kind]}
        </span>
        <div className="trust-app-card-title-block">
          <h3 className="trust-app-card-title">{summary.entry.name}</h3>
          <p className="trust-app-card-summary">{summary.entry.summary}</p>
        </div>
        <span className="trust-app-status-pill" data-status={summary.status}>
          {connected ? "Connected" : "Ready"}
        </span>
      </header>
      <div className="trust-app-card-stats">
        <Stat label="Channels" value={formatInteger(summary.connectedChannels)} />
        <Stat label="Enabled" value={formatInteger(summary.enabledChannels)} />
        <Stat label="Chats" value={formatInteger(summary.allowedChats)} />
        <Stat label="Agents" value={formatInteger(summary.agentCount)} />
      </div>
      <Link to={channelsPath} className="trust-app-card-action">
        <Smartphone size={14} strokeWidth={1.5} aria-hidden />
        {actionLabel}
      </Link>
    </article>
  );
}
