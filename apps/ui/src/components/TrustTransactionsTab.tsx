import { ArrowLeftRight, Banknote, ReceiptText } from "lucide-react";

import { EmptyState, PrimitivePageHeader } from "./ui";
import { FinanceModelCard } from "./TrustBudgetsTab";
import "@/styles/overview.css";

export default function TrustTransactionsTab() {
  return (
    <div className="trust-overview trust-apps-page">
      <PrimitivePageHeader
        className="trust-apps-page-header"
        title="Transactions"
        aria-label="Transaction controls"
      >
        <div className="ideas-toolbar trust-apps-toolbar">
          <span className="ideas-toolbar-meta trust-apps-toolbar-summary">
            0 recorded · ledger pending · reconciliation not started
          </span>
        </div>
      </PrimitivePageHeader>

      <section
        className="trust-cockpit-card trust-cockpit-card--wide"
        aria-labelledby="transactions-model-heading"
      >
        <header className="trust-cockpit-card-header">
          <div>
            <h2 id="transactions-model-heading" className="trust-cockpit-card-title">
              Transaction ledger
            </h2>
            <p className="trust-cockpit-card-sub">
              Actual money movement from subscriptions, campaign spend, payouts, tools, and fees.
            </p>
          </div>
        </header>
        <div className="trust-apps-grid trust-apps-grid--workspace">
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

      <section className="trust-cockpit-card trust-cockpit-card--wide">
        <EmptyState
          eyebrow="Transactions"
          title="No transactions yet"
          description="Transactions will become the TRUST ledger for payments, charges, credits, and reconciliation."
        />
      </section>
    </div>
  );
}
