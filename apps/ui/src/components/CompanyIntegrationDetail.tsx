import type { ReactNode } from "react";
import { Cloud, CreditCard, MessageCircle, ShoppingBag, Smartphone } from "lucide-react";
import { Button } from "./ui";

export type IntegrationItem = {
  id: string;
  name: string;
  category: "Workspace" | "Commerce" | "Messaging" | "Billing" | "Gateway";
  summary: string;
  connected: boolean;
  statusLabel: string;
  icon: ReactNode;
  meta: Array<{ label: string; value: string }>;
  actionLabel: string;
  onAction: () => void;
  actionDisabled?: boolean;
  detail: string[];
};

export default function IntegrationDetail({
  connecting,
  item,
}: {
  connecting: boolean;
  item: IntegrationItem;
}) {
  const actionIcon =
    item.category === "Billing" ? (
      <CreditCard size={14} strokeWidth={1.5} />
    ) : item.category === "Gateway" ? (
      <Smartphone size={14} strokeWidth={1.5} />
    ) : item.category === "Messaging" ? (
      <MessageCircle size={14} strokeWidth={1.5} />
    ) : item.category === "Commerce" ? (
      <ShoppingBag size={14} strokeWidth={1.5} />
    ) : (
      <Cloud size={14} strokeWidth={1.5} />
    );

  return (
    <aside className="company-apps-detail-panel" aria-label="Integration detail">
      <header className="company-apps-detail-header">
        <span className="company-apps-detail-icon" aria-hidden>
          {item.icon}
        </span>
        <div>
          <h2 className="company-apps-detail-title">{item.name}</h2>
          <p className="company-apps-detail-subtitle">{item.summary}</p>
        </div>
      </header>

      <div className="company-apps-detail-grid">
        {item.meta.map((field) => (
          <span key={field.label} className="company-apps-detail-field">
            <span className="company-apps-detail-field-value">{field.value}</span>
            <span className="company-apps-detail-field-label">{field.label}</span>
          </span>
        ))}
      </div>

      <section className="company-apps-mini-section" aria-labelledby="integration-detail-heading">
        <h3 id="integration-detail-heading" className="company-apps-mini-title">
          Capability
        </h3>
        <div className="company-apps-chip-list">
          {item.detail.map((value) => (
            <span key={value} className="company-apps-chip">
              {value}
            </span>
          ))}
        </div>
      </section>

      <div className="company-apps-detail-actions">
        <Button
          variant={item.connected ? "secondary" : "primary"}
          size="md"
          onClick={item.onAction}
          loading={connecting}
          disabled={item.actionDisabled}
          leadingIcon={actionIcon}
        >
          {item.actionLabel}
        </Button>
      </div>
    </aside>
  );
}
