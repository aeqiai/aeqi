import type { ReactNode } from "react";
import { Globe, Mail, Megaphone } from "lucide-react";

import { formatInteger } from "@/lib/i18n";
import { Button, CardTrigger, PrimitivePageHeader } from "./ui";

export type OperatingAppId = "mails" | "websites" | "campaigns";

export type OperatingAppItem = {
  id: OperatingAppId;
  name: string;
  category: "Communication" | "Presence" | "Growth";
  summary: string;
  statusLabel: string;
  icon: ReactNode;
  meta: Array<{ label: string; value: string }>;
  actionLabel: string;
  onAction: () => void;
  detail: string[];
};

export function buildOperatingAppItems({
  basePath,
  emailCount,
  emailIdentities,
  emailLoading,
  externalDomainCount,
  outboundReady,
  trustDomainCount,
  websiteLoading,
  websiteViews,
  navigate,
}: {
  basePath: string;
  emailCount: number;
  emailIdentities: number;
  emailLoading: boolean;
  externalDomainCount: number;
  outboundReady: boolean;
  trustDomainCount: number;
  websiteLoading: boolean;
  websiteViews: string;
  navigate: (href: string) => void;
}): OperatingAppItem[] {
  return [
    {
      id: "mails",
      name: "Mails",
      category: "Communication",
      summary: "Company-owned addresses for inbound and outbound mail.",
      statusLabel: emailLoading ? "Checking" : `${formatInteger(emailIdentities)} mailboxes`,
      icon: <AppRegistryLogo icon={<Mail size={18} strokeWidth={1.5} />} />,
      meta: [
        { label: "Mailboxes", value: formatInteger(emailIdentities) },
        { label: "Messages", value: formatInteger(emailCount) },
        { label: "Outbound", value: outboundReady ? "Ready" : "Setup" },
      ],
      actionLabel: "Open Mails",
      onAction: () => navigate(`${basePath}/mails`),
      detail: ["Mailboxes", "Inbound routing", "Outbound test"],
    },
    {
      id: "websites",
      name: "Websites",
      category: "Presence",
      summary: "Public company websites, domains, and traffic status.",
      statusLabel: websiteLoading ? "Checking" : `${formatInteger(trustDomainCount)} domains`,
      icon: <AppRegistryLogo icon={<Globe size={18} strokeWidth={1.5} />} />,
      meta: [
        { label: "Domains", value: formatInteger(trustDomainCount) },
        { label: "External", value: formatInteger(externalDomainCount) },
        { label: "Today", value: websiteViews },
      ],
      actionLabel: "Open Websites",
      onAction: () => navigate(`${basePath}/websites`),
      detail: ["Default website", "Custom domains", "Analytics"],
    },
    {
      id: "campaigns",
      name: "Campaigns",
      category: "Growth",
      summary: "Governed outbound work across mail, websites, and gateways.",
      statusLabel: "Planned",
      icon: <AppRegistryLogo icon={<Megaphone size={18} strokeWidth={1.5} />} />,
      meta: [
        { label: "Active", value: "0" },
        { label: "Primary", value: "Mails" },
        { label: "Budget", value: "Unset" },
      ],
      actionLabel: "Open Campaigns",
      onAction: () => navigate(`${basePath}/campaigns`),
      detail: ["Audience", "Gateway mix", "Budget guardrail"],
    },
  ];
}

export function AppRegistryPage({
  headerTitle,
  items,
  onSelectApp,
  selectedAppId,
  toolbarSummary,
}: {
  headerTitle: ReactNode;
  items: OperatingAppItem[];
  onSelectApp: (id: OperatingAppId) => void;
  selectedAppId: string;
  toolbarSummary: string;
}) {
  const selectedApp = items.find((item) => item.id === selectedAppId) ?? items[0];

  return (
    <div className="company-apps-page company-primitive-shell">
      <PrimitivePageHeader
        className="company-apps-page-header company-primitive-shell-header company-apps-page-header--summary"
        title={headerTitle}
        aria-label="App controls"
        padding="none"
      />

      <main className="company-apps-main company-primitive-shell-surface company-apps-shell-surface">
        <div className="company-primitive-context-strip" role="status">
          <span className="company-primitive-context-text">{toolbarSummary}</span>
        </div>

        <div className="company-apps-register-layout" aria-label="App registry">
          <section className="company-apps-register-card" aria-labelledby="app-register-heading">
            <header className="company-apps-register-head">
              <div>
                <h2 id="app-register-heading" className="company-apps-register-title">
                  Operating Surfaces
                </h2>
                <p className="company-apps-register-subtitle">
                  Concrete apps this COMPANY can run.
                </p>
              </div>
            </header>

            <div className="company-apps-table-head company-apps-table-head--app" aria-hidden>
              <span>App</span>
              <span>Type</span>
              <span>Status</span>
            </div>
            <div className="company-apps-register-list">
              {items.map((item) => (
                <CardTrigger
                  key={item.id}
                  className="company-apps-register-row company-apps-register-row--app"
                  data-selected={item.id === selectedApp?.id ? "true" : undefined}
                  onClick={() => onSelectApp(item.id)}
                >
                  <span className="company-apps-row-main company-apps-row-main--with-icon">
                    <span className="company-apps-row-icon" aria-hidden>
                      {item.icon}
                    </span>
                    <span>
                      <span className="company-apps-row-title">{item.name}</span>
                      <span className="company-apps-row-subtitle">{item.summary}</span>
                    </span>
                  </span>
                  <span className="company-apps-row-cell">{item.category}</span>
                  <span className="company-apps-row-cell">{item.statusLabel}</span>
                </CardTrigger>
              ))}
            </div>
          </section>

          {selectedApp && <AppRegistryDetail item={selectedApp} />}
        </div>
      </main>
    </div>
  );
}

function AppRegistryLogo({ icon }: { icon: ReactNode }) {
  return (
    <span className="company-app-logo" aria-hidden>
      {icon}
    </span>
  );
}

function AppRegistryDetail({ item }: { item: OperatingAppItem }) {
  const actionIcon =
    item.id === "mails" ? (
      <Mail size={14} strokeWidth={1.5} />
    ) : item.id === "websites" ? (
      <Globe size={14} strokeWidth={1.5} />
    ) : (
      <Megaphone size={14} strokeWidth={1.5} />
    );

  return (
    <aside className="company-apps-detail-panel" aria-label="App detail">
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

      <section className="company-apps-mini-section" aria-labelledby="app-detail-heading">
        <h3 id="app-detail-heading" className="company-apps-mini-title">
          Includes
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
        <Button variant="primary" size="md" onClick={item.onAction} leadingIcon={actionIcon}>
          {item.actionLabel}
        </Button>
      </div>
    </aside>
  );
}
