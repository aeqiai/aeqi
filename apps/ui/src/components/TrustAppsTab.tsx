import { Link, useSearchParams } from "react-router-dom";
import { MessageCircle, Send, Smartphone, Waypoints } from "lucide-react";

import { useTrustApps } from "@/hooks/useTrustApps";
import { entityBasePath } from "@/lib/entityPath";
import { formatInteger } from "@/lib/i18n";
import type { TrustAppKind, TrustAppSummary } from "@/lib/trustApps";
import { useDaemonStore } from "@/store/daemon";
import "@/styles/overview.css";

const APP_ICONS: Record<TrustAppKind, React.ReactNode> = {
  telegram: <Send size={18} strokeWidth={1.5} />,
  whatsapp: <MessageCircle size={18} strokeWidth={1.5} />,
};

export default function TrustAppsTab({ trustId }: { trustId: string }) {
  const [params] = useSearchParams();
  const selectedKind = params.get("app");
  const entities = useDaemonStore((s) => s.entities);
  const entity = entities.find((item) => item.id === trustId);
  const basePath = entity ? entityBasePath(entity) : "/launch";
  const { defaultAgent, installed, isLoading, summaries, trustAgents } = useTrustApps(trustId);
  const agentChannelsPath = defaultAgent
    ? `${basePath}/agents/${encodeURIComponent(defaultAgent.id)}/settings/channels`
    : `${basePath}/agents`;
  const channelActionLabel = defaultAgent ? "Open Channels" : "Open Agents";

  return (
    <div className="trust-overview trust-apps-page">
      <section className="trust-apps-header">
        <div className="trust-apps-header-main">
          <span className="trust-apps-header-icon" aria-hidden>
            <Waypoints size={18} strokeWidth={1.5} />
          </span>
          <div>
            <p className="trust-apps-eyebrow">Trust apps</p>
            <h1 className="trust-apps-title">Apps</h1>
          </div>
        </div>
        <div className="trust-apps-header-stats" aria-label="Apps summary">
          <Stat
            label="Connected"
            value={isLoading ? "..." : formatInteger(installed.connectedApps)}
          />
          <Stat
            label="Channels"
            value={isLoading ? "..." : formatInteger(installed.enabledChannels)}
          />
          <Stat label="Agents" value={formatInteger(trustAgents.length)} />
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
