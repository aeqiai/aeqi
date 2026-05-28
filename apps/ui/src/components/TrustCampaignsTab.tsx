import type { ReactNode } from "react";
import { BarChart3, Mail, Megaphone, WalletCards } from "lucide-react";

import { Button, EmptyState, PrimitivePageHeader } from "./ui";
import "@/styles/overview.css";

export default function TrustCampaignsTab() {
  return (
    <div className="trust-overview trust-apps-page">
      <PrimitivePageHeader
        className="trust-apps-page-header"
        title="Campaigns"
        aria-label="Campaign controls"
        actions={
          <Button variant="primary" size="md" disabled leadingIcon={<Megaphone size={14} />}>
            New Campaign
          </Button>
        }
      >
        <div className="ideas-toolbar trust-apps-toolbar">
          <span className="ideas-toolbar-meta trust-apps-toolbar-summary">
            0 active · budget not set · Mail primary
          </span>
        </div>
      </PrimitivePageHeader>

      <section
        className="trust-cockpit-card trust-cockpit-card--wide"
        aria-labelledby="campaigns-model-heading"
      >
        <header className="trust-cockpit-card-header">
          <div>
            <h2 id="campaigns-model-heading" className="trust-cockpit-card-title">
              Campaign operating model
            </h2>
            <p className="trust-cockpit-card-sub">
              Planned outbound work across Mail, Websites, Channels, agents, and budget.
            </p>
          </div>
        </header>
        <div className="trust-apps-grid trust-apps-grid--workspace">
          <CampaignModelCard
            icon={<Mail size={18} strokeWidth={1.5} />}
            title="Outbound channel"
            summary="Start with trust-owned Mail, then add WhatsApp, Telegram, or website forms."
            label="Primary"
            value="Mail"
          />
          <CampaignModelCard
            icon={<WalletCards size={18} strokeWidth={1.5} />}
            title="Budget guardrail"
            summary="Every campaign needs a spend cap, approval owner, and stop condition."
            label="Budget"
            value="Unset"
          />
          <CampaignModelCard
            icon={<BarChart3 size={18} strokeWidth={1.5} />}
            title="Results"
            summary="Track sends, replies, meetings, conversions, cost, and agent actions."
            label="Reporting"
            value="Planned"
          />
        </div>
      </section>

      <section
        className="trust-cockpit-card trust-cockpit-card--wide"
        aria-labelledby="campaigns-empty-heading"
      >
        <EmptyState
          eyebrow="Campaigns"
          title="No campaigns yet"
          description="Campaigns will let this TRUST run governed outbound work with audience lists, channel mix, budget, cadence, agent ownership, and result tracking."
        />
      </section>
    </div>
  );
}

function CampaignModelCard({
  icon,
  label,
  summary,
  title,
  value,
}: {
  icon: ReactNode;
  label: string;
  summary: string;
  title: string;
  value: string;
}) {
  return (
    <article className="trust-app-card">
      <header className="trust-app-card-header">
        <span className="trust-app-card-icon" aria-hidden>
          {icon}
        </span>
        <div className="trust-app-card-title-block">
          <h3 className="trust-app-card-title">{title}</h3>
          <p className="trust-app-card-summary">{summary}</p>
        </div>
      </header>
      <div className="trust-app-card-stats trust-app-card-stats--workspace">
        <span className="trust-apps-stat">
          <span className="trust-apps-stat-value">{value}</span>
          <span className="trust-apps-stat-label">{label}</span>
        </span>
      </div>
    </article>
  );
}
