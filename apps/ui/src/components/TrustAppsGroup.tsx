import { Link } from "react-router-dom";
import { MessageCircle, Send, Smartphone, Waypoints } from "lucide-react";

import { useTrustApps } from "@/hooks/useTrustApps";
import { formatInteger } from "@/lib/i18n";
import type { TrustAppKind, TrustAppSummary } from "@/lib/trustApps";

interface TrustAppsGroupProps {
  trustId: string;
  basePath: string;
}

const APP_ICONS: Record<TrustAppKind, React.ReactNode> = {
  telegram: <Send size={16} strokeWidth={1.5} />,
  whatsapp: <MessageCircle size={16} strokeWidth={1.5} />,
};

export default function TrustAppsGroup({ trustId, basePath }: TrustAppsGroupProps) {
  const { defaultAgent, installed, isLoading, summaries } = useTrustApps(trustId);
  const agentChannelsPath = defaultAgent
    ? `${basePath}/agents/${encodeURIComponent(defaultAgent.id)}/settings/channels`
    : `${basePath}/agents`;

  return (
    <section className="trust-cockpit-card" aria-labelledby="trust-apps-heading">
      <header className="trust-cockpit-card-header">
        <h2 id="trust-apps-heading" className="trust-cockpit-card-title">
          Apps
        </h2>
        <span className="trust-cockpit-card-sub">Capabilities</span>
      </header>
      <div className="trust-cockpit-inner-grid trust-cockpit-inner-grid--split">
        {summaries.map((summary) => (
          <AppPrimitiveCard key={summary.entry.kind} summary={summary} to={`${basePath}/apps`} />
        ))}
      </div>
      <div className="trust-cockpit-secondary-row">
        <Link to={`${basePath}/apps`} className="trust-cockpit-secondary-cell" aria-label="Apps">
          <Waypoints size={14} strokeWidth={1.5} aria-hidden />
          <span className="trust-cockpit-secondary-label">Apps</span>
          <span className="trust-cockpit-secondary-value">
            {isLoading ? "..." : formatInteger(installed.connectedApps)}
          </span>
          <span className="trust-cockpit-secondary-hint">connected</span>
        </Link>
        <Link
          to={agentChannelsPath}
          className="trust-cockpit-secondary-cell"
          aria-label="Agent channels"
        >
          <Smartphone size={14} strokeWidth={1.5} aria-hidden />
          <span className="trust-cockpit-secondary-label">Channels</span>
          <span className="trust-cockpit-secondary-value">
            {isLoading ? "..." : formatInteger(installed.enabledChannels)}
          </span>
          <span className="trust-cockpit-secondary-hint">enabled</span>
        </Link>
      </div>
    </section>
  );
}

interface AppPrimitiveCardProps {
  summary: TrustAppSummary;
  to: string;
}

function AppPrimitiveCard({ summary, to }: AppPrimitiveCardProps) {
  const connected = summary.status === "connected";
  const channelLabel = summary.connectedChannels === 1 ? "channel" : "channels";

  return (
    <Link to={`${to}?app=${summary.entry.kind}`} className="trust-cockpit-mini">
      <span className="trust-primitive-icon" aria-hidden>
        {APP_ICONS[summary.entry.kind]}
      </span>
      <span className="trust-primitive-label">{summary.entry.name}</span>
      <span className="trust-primitive-value">
        {connected ? formatInteger(summary.connectedChannels) : "Ready"}
        {connected && <span className="trust-primitive-hint"> {channelLabel}</span>}
      </span>
      <span className="trust-app-signal" data-status={summary.status}>
        <span className="trust-app-dot" aria-hidden />
        {connected ? `${formatInteger(summary.enabledChannels)} enabled` : summary.entry.summary}
      </span>
    </Link>
  );
}
