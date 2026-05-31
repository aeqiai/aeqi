import { Link } from "react-router-dom";
import { CreditCard, MessageCircle, Send, Smartphone, Waypoints } from "lucide-react";

import { useCompanyApps } from "@/hooks/useCompanyApps";
import { formatInteger } from "@/lib/i18n";
import type { CompanyAppKind, CompanyAppSummary } from "@/lib/companyApps";

interface CompanyAppsGroupProps {
  companyId: string;
  basePath: string;
}

const APP_ICONS: Record<CompanyAppKind, React.ReactNode> = {
  telegram: <Send size={16} strokeWidth={1.5} />,
  whatsapp: <MessageCircle size={16} strokeWidth={1.5} />,
  stripe: <CreditCard size={16} strokeWidth={1.5} />,
};

export default function CompanyAppsGroup({ companyId, basePath }: CompanyAppsGroupProps) {
  const { installed, isLoading, summaries } = useCompanyApps(companyId);
  const gatewaysPath = `${basePath}/gateways`;

  return (
    <section
      className="company-cockpit-card company-cockpit-card--apps"
      aria-labelledby="company-apps-heading"
    >
      <header className="company-cockpit-card-header">
        <h2 id="company-apps-heading" className="company-cockpit-card-title">
          Integrations
        </h2>
        <span className="company-cockpit-card-sub">Capabilities</span>
      </header>
      <div className="company-cockpit-inner-grid company-cockpit-inner-grid--split">
        {summaries.map((summary) => (
          <AppPrimitiveCard
            key={summary.entry.kind}
            summary={summary}
            to={`${basePath}/integrations`}
          />
        ))}
      </div>
      <div className="company-cockpit-secondary-row">
        <Link
          to={`${basePath}/integrations`}
          className="company-cockpit-secondary-cell"
          aria-label="Integrations"
        >
          <Waypoints size={14} strokeWidth={1.5} aria-hidden />
          <span className="company-cockpit-secondary-label">Integrations</span>
          <span className="company-cockpit-secondary-value">
            {isLoading ? "..." : formatInteger(installed.connectedApps)}
          </span>
          <span className="company-cockpit-secondary-hint">connected</span>
        </Link>
        <Link to={gatewaysPath} className="company-cockpit-secondary-cell" aria-label="Gateways">
          <Smartphone size={14} strokeWidth={1.5} aria-hidden />
          <span className="company-cockpit-secondary-label">Gateways</span>
          <span className="company-cockpit-secondary-value">
            {isLoading ? "..." : formatInteger(installed.enabledChannels)}
          </span>
          <span className="company-cockpit-secondary-hint">enabled</span>
        </Link>
      </div>
    </section>
  );
}

interface AppPrimitiveCardProps {
  summary: CompanyAppSummary;
  to: string;
}

function AppPrimitiveCard({ summary, to }: AppPrimitiveCardProps) {
  const connected = summary.status === "connected";
  const gatewayLabel = summary.connectedChannels === 1 ? "gateway" : "gateways";

  return (
    <Link to={`${to}?app=${summary.entry.kind}`} className="company-cockpit-mini">
      <span className="company-primitive-icon" aria-hidden>
        {APP_ICONS[summary.entry.kind]}
      </span>
      <span className="company-primitive-label">{summary.entry.name}</span>
      <span className="company-primitive-value">
        {connected ? formatInteger(summary.connectedChannels) : "Ready"}
        {connected && <span className="company-primitive-hint"> {gatewayLabel}</span>}
      </span>
      <span className="company-app-signal" data-status={summary.status}>
        <span className="company-app-dot" aria-hidden />
        {connected ? `${formatInteger(summary.enabledChannels)} enabled` : summary.entry.summary}
      </span>
    </Link>
  );
}
