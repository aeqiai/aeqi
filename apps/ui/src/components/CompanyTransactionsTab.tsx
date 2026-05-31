import { ArrowLeftRight, Banknote, ReceiptText } from "lucide-react";

import { EmptyState, PrimitivePageHeader } from "./ui";
import { FinanceModelCard } from "./CompanyBudgetsTab";
import "@/styles/overview.css";

export default function CompanyTransactionsTab() {
  return (
    <div className="company-overview company-apps-page">
      <PrimitivePageHeader
        className="company-apps-page-header company-apps-page-header--summary"
        title={
          <span className="company-primitive-page-title">
            <span className="company-primitive-page-title-text">Transactions</span>
            <span className="company-primitive-page-count" aria-hidden="true">
              0
            </span>
          </span>
        }
        aria-label="Transaction controls"
      />

      <div className="company-primitive-context-strip" role="status">
        <span className="company-primitive-context-text">
          0 recorded · ledger pending · reconciliation not started
        </span>
      </div>

      <section
        className="company-cockpit-card company-cockpit-card--wide"
        aria-labelledby="transactions-model-heading"
      >
        <header className="company-cockpit-card-header">
          <div>
            <h2 id="transactions-model-heading" className="company-cockpit-card-title">
              Transaction ledger
            </h2>
            <p className="company-cockpit-card-sub">
              Actual money movement from subscriptions, campaign spend, payouts, tools, and fees.
            </p>
          </div>
        </header>
        <div className="company-apps-grid company-apps-grid--workspace">
          <FinanceModelCard
            icon={<ReceiptText size={18} strokeWidth={1.5} />}
            title="Receipts"
            summary="Show every charge, payment, refund, credit, and invoice line."
            label="Rows"
            value="0"
          />
          <FinanceModelCard
            icon={<ArrowLeftRight size={18} strokeWidth={1.5} />}
            title="Reconciliation"
            summary="Connect spend back to budgets, campaigns, quests, and agent actions."
            label="Status"
            value="Pending"
          />
          <FinanceModelCard
            icon={<Banknote size={18} strokeWidth={1.5} />}
            title="Balances"
            summary="Track available funds and obligations without mixing them into planning."
            label="Balance"
            value="Unset"
          />
        </div>
      </section>

      <section className="company-cockpit-card company-cockpit-card--wide">
        <EmptyState
          eyebrow="Transactions"
          title="No transactions yet"
          description="Transactions will become the COMPANY ledger for payments, charges, credits, and reconciliation."
        />
      </section>
    </div>
  );
}
