import type { ReactNode } from "react";
import { CircleDollarSign, Gauge, ShieldCheck, WalletCards } from "lucide-react";

import { Button, EmptyState, PrimitivePageHeader } from "./ui";
import "@/styles/overview.css";

export default function TrustBudgetsTab() {
  return (
    <div className="trust-overview trust-apps-page">
      <PrimitivePageHeader
        className="trust-apps-page-header trust-apps-page-header--summary"
        title={
          <span className="trust-primitive-page-title">
            <span className="trust-primitive-page-title-text">Budgets</span>
            <span className="trust-primitive-page-count" aria-hidden="true">
              0
            </span>
          </span>
        }
        aria-label="Budget controls"
        actions={
          <Button variant="primary" size="md" disabled leadingIcon={<WalletCards size={14} />}>
            New Budget
          </Button>
        }
      />

      <div className="trust-primitive-context-strip" role="status">
        <span className="trust-primitive-context-text">
          0 active · no spend cap · approval required
        </span>
      </div>

      <section
        className="trust-cockpit-card trust-cockpit-card--wide"
        aria-labelledby="budgets-model-heading"
      >
        <header className="trust-cockpit-card-header">
          <div>
            <h2 id="budgets-model-heading" className="trust-cockpit-card-title">
              Budget model
            </h2>
            <p className="trust-cockpit-card-sub">
              Planning limits for agents, campaigns, tools, inference, and company spend.
            </p>
          </div>
        </header>
        <div className="trust-apps-grid trust-apps-grid--workspace">
          <FinanceModelCard
            icon={<Gauge size={18} strokeWidth={1.5} />}
            title="Spend caps"
            summary="Set monthly, campaign, agent, or tool limits before work starts."
            label="Cap"
            value="Unset"
          />
          <FinanceModelCard
            icon={<ShieldCheck size={18} strokeWidth={1.5} />}
            title="Approvals"
            summary="Route budget increases through the right role before agents can exceed limits."
            label="Policy"
            value="Required"
          />
          <FinanceModelCard
            icon={<CircleDollarSign size={18} strokeWidth={1.5} />}
            title="Allocation"
            summary="Attach budgets to quests, campaigns, apps, and operating teams."
            label="Scope"
            value="Trust"
          />
        </div>
      </section>

      <section className="trust-cockpit-card trust-cockpit-card--wide">
        <EmptyState
          eyebrow="Budgets"
          title="No budgets yet"
          description="Budgets will define planned spend, limits, approvals, and allocation across the TRUST."
        />
      </section>
    </div>
  );
}

export function FinanceModelCard({
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
