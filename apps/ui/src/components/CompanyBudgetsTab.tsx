import type { ReactNode } from "react";
import { CircleDollarSign, Gauge, ShieldCheck, WalletCards } from "lucide-react";

import { Button, EmptyState, PrimitivePageHeader } from "./ui";
import "@/styles/overview.css";

export default function CompanyBudgetsTab() {
  return (
    <div className="company-overview company-apps-page">
      <PrimitivePageHeader
        className="company-apps-page-header company-apps-page-header--summary"
        title={
          <span className="company-primitive-page-title">
            <span className="company-primitive-page-title-text">Budgets</span>
            <span className="company-primitive-page-count" aria-hidden="true">
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

      <div className="company-primitive-context-strip" role="status">
        <span className="company-primitive-context-text">
          0 active · no spend cap · approval required
        </span>
      </div>

      <section
        className="company-cockpit-card company-cockpit-card--wide"
        aria-labelledby="budgets-model-heading"
      >
        <header className="company-cockpit-card-header">
          <div>
            <h2 id="budgets-model-heading" className="company-cockpit-card-title">
              Budget model
            </h2>
            <p className="company-cockpit-card-sub">
              Planning limits for agents, campaigns, tools, inference, and company spend.
            </p>
          </div>
        </header>
        <div className="company-apps-grid company-apps-grid--workspace">
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
            value="Company"
          />
        </div>
      </section>

      <section className="company-cockpit-card company-cockpit-card--wide">
        <EmptyState
          eyebrow="Budgets"
          title="No budgets yet"
          description="Budgets will define planned spend, limits, approvals, and allocation across the COMPANY."
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
    <article className="company-app-card">
      <header className="company-app-card-header">
        <span className="company-app-card-icon" aria-hidden>
          {icon}
        </span>
        <div className="company-app-card-title-block">
          <h3 className="company-app-card-title">{title}</h3>
          <p className="company-app-card-summary">{summary}</p>
        </div>
      </header>
      <div className="company-app-card-stats company-app-card-stats--workspace">
        <span className="company-apps-stat">
          <span className="company-apps-stat-value">{value}</span>
          <span className="company-apps-stat-label">{label}</span>
        </span>
      </div>
    </article>
  );
}
