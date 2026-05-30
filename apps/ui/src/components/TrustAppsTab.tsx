import { useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Cloud,
  CreditCard,
  FileText,
  FolderOpen,
  Mail,
  MessageCircle,
  Plus,
  Presentation,
  Send,
  Smartphone,
  Table2,
  Video,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { integrationsApi } from "@/api/integrations";
import { useTrustApps } from "@/hooks/useTrustApps";
import { api } from "@/lib/api";
import { entityBasePath } from "@/lib/entityPath";
import { formatInteger } from "@/lib/i18n";
import { goExternal } from "@/lib/navigation";
import { publicWebsiteDomain, publicWebsiteUrl } from "@/lib/publicWebsite";
import { trustEmailAddress, trustEmailDomain } from "@/lib/trustEmail";
import type { TrustAppKind } from "@/lib/trustApps";
import { useDaemonStore } from "@/store/daemon";
import { Button, CardTrigger, PrimitivePageHeader } from "./ui";
import { AppRegistryPage, buildOperatingAppItems } from "./TrustAppsRegistry";
import TrustIntegrationCreateModal from "./TrustIntegrationCreateModal";
import {
  MailPrimitivePage,
  WebsitesPrimitivePage,
  normalizeEmailIdentities,
  normalizeWebsiteDomains,
} from "./TrustPrimitiveApps";
import "@/styles/overview.css";

const APP_ICONS: Record<TrustAppKind, ReactNode> = {
  telegram: <AppLogo kind="telegram" icon={<Send size={18} strokeWidth={1.5} />} />,
  whatsapp: <AppLogo kind="whatsapp" icon={<MessageCircle size={18} strokeWidth={1.5} />} />,
  stripe: <AppLogo kind="stripe" icon={<CreditCard size={18} strokeWidth={1.5} />} />,
};

export type TrustAppsSurface = "apps" | "integrations" | "mail" | "websites";

type WorkspaceAppKind = "gmail" | "calendar" | "drive" | "docs" | "sheets" | "slides" | "meet";

const GOOGLE_WORKSPACE_APPS: readonly {
  kind: WorkspaceAppKind;
  name: string;
  summary: string;
  access: string;
  icon: ReactNode;
}[] = [
  {
    kind: "gmail",
    name: "Gmail",
    summary: "Read, draft, and send trust mail",
    access: "Mail",
    icon: <Mail size={18} strokeWidth={1.5} />,
  },
  {
    kind: "calendar",
    name: "Calendar",
    summary: "Schedule meetings and reminders",
    access: "Schedule",
    icon: <CalendarDays size={18} strokeWidth={1.5} />,
  },
  {
    kind: "drive",
    name: "Drive",
    summary: "Find and organize shared files",
    access: "Files",
    icon: <FolderOpen size={18} strokeWidth={1.5} />,
  },
  {
    kind: "docs",
    name: "Docs",
    summary: "Create and edit documents",
    access: "Docs",
    icon: <FileText size={18} strokeWidth={1.5} />,
  },
  {
    kind: "sheets",
    name: "Sheets",
    summary: "Work with spreadsheets and reports",
    access: "Tables",
    icon: <Table2 size={18} strokeWidth={1.5} />,
  },
  {
    kind: "slides",
    name: "Slides",
    summary: "Draft decks and presentation notes",
    access: "Decks",
    icon: <Presentation size={18} strokeWidth={1.5} />,
  },
  {
    kind: "meet",
    name: "Meet",
    summary: "Prepare and join video calls",
    access: "Calls",
    icon: <Video size={18} strokeWidth={1.5} />,
  },
];

export default function TrustAppsTab({
  surface = "integrations",
  trustId,
}: {
  surface?: TrustAppsSurface;
  trustId: string;
}) {
  const navigate = useNavigate();
  const [mailCreatorOpen, setMailCreatorOpen] = useState(false);
  const [websiteCreatorOpen, setWebsiteCreatorOpen] = useState(false);
  const [integrationCreatorOpen, setIntegrationCreatorOpen] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState("mails");
  const [selectedIntegrationId, setSelectedIntegrationId] = useState("google-workspace");
  const [connectingIntegration, setConnectingIntegration] = useState<string | null>(null);
  const entities = useDaemonStore((s) => s.entities);
  const entity = entities.find((item) => item.id === trustId);
  const basePath = entity ? entityBasePath(entity) : "/launch";
  const { installed, isLoading, summaries, trustAgents } = useTrustApps(trustId);
  const googleStatus = useQuery({
    queryKey: ["trust-google-status", trustId],
    queryFn: () => integrationsApi.getTrustGoogleStatus(trustId),
    enabled: Boolean(trustId),
    staleTime: 20_000,
  });
  const emailStatus = useQuery({
    queryKey: ["trust-email-messages", trustId],
    queryFn: () => api.getTrustEmailMessages(trustId),
    enabled: Boolean(entity),
    staleTime: 20_000,
  });
  const websiteAnalytics = useQuery({
    queryKey: ["trust-website-analytics", trustId],
    queryFn: () => api.getTrustWebsiteAnalytics(trustId),
    enabled: Boolean(entity),
    staleTime: 20_000,
  });
  const hostingDomains = useQuery({
    queryKey: ["hosting-domains", trustId],
    queryFn: () => api.listHostingDomains(),
    enabled: (surface === "websites" || surface === "apps") && Boolean(entity),
    staleTime: 20_000,
  });
  const googleConnected = googleStatus.data?.connected === true;
  const workspaceServices = GOOGLE_WORKSPACE_APPS.length;
  const gatewaysPath = `${basePath}/gateways`;
  const channelApps = summaries.filter((summary) => summary.entry.category === "channel");
  const billingApps = summaries.filter((summary) => summary.entry.category === "billing");
  const billingReady = billingApps.length > 0;
  const email = entity ? trustEmailAddress(entity) : "Trust mailbox";
  const emailDomain = entity ? trustEmailDomain(entity) : "aeqi.ai";
  const emailMessages = emailStatus.data?.messages ?? [];
  const emailCount = emailStatus.data?.message_count ?? emailMessages.length;
  const emailIdentities = normalizeEmailIdentities(emailStatus.data?.identities, email);
  const primaryWebsiteDomain = entity ? publicWebsiteDomain(entity) : "Trust website";
  const trustDomains = normalizeWebsiteDomains(
    primaryWebsiteDomain,
    hostingDomains.data?.domains,
    trustId,
  );
  const externalDomainCount = trustDomains.filter((domain) => domain.kind === "external").length;
  const websiteViews = websiteAnalytics.data?.stats
    ? formatInteger(websiteAnalytics.data.stats.last_24h.pageviews)
    : websiteAnalytics.isLoading
      ? "Checking"
      : "Ready";
  const appItems = buildOperatingAppItems({
    basePath,
    emailCount,
    emailIdentities: emailIdentities.length,
    emailLoading: emailStatus.isLoading,
    externalDomainCount,
    navigate,
    outboundReady: emailStatus.data?.outbound_status === "ready",
    trustDomainCount: trustDomains.length,
    websiteLoading: websiteAnalytics.isLoading || hostingDomains.isLoading,
    websiteViews,
  });

  async function startGoogleIntegration(source = "google-workspace") {
    setConnectingIntegration(source);
    try {
      const res = await integrationsApi.startTrustGoogle(trustId);
      goExternal(res.authorize_url);
    } finally {
      setConnectingIntegration(null);
    }
  }

  function openGatewayCreate(kind: "telegram" | "whatsapp" | "whatsapp-baileys") {
    navigate(`${gatewaysPath}?new=1&kind=${encodeURIComponent(kind)}`);
  }

  const integrationItems: IntegrationItem[] = [
    {
      id: "google-workspace",
      name: "Google Workspace",
      category: "Workspace",
      summary: "Mail, calendar, files, docs, sheets, slides, and meetings.",
      connected: googleConnected,
      statusLabel: googleStatus.isLoading ? "Checking" : googleConnected ? "Connected" : "Ready",
      icon: <AppLogo kind="gmail" icon={<Cloud size={18} strokeWidth={1.5} />} />,
      meta: [
        { label: "Account", value: googleStatus.data?.account_email || "Trust" },
        { label: "Scopes", value: formatInteger(googleStatus.data?.scopes?.length ?? 0) },
        { label: "Apps", value: formatInteger(workspaceServices) },
      ],
      actionLabel: googleConnected ? "Reconnect" : "Connect",
      onAction: () => void startGoogleIntegration("google-workspace"),
      detail: GOOGLE_WORKSPACE_APPS.map((app) => app.name),
    },
    ...billingApps.map(
      (summary): IntegrationItem => ({
        id: summary.entry.kind,
        name: summary.entry.name,
        category: "Billing",
        summary: summary.entry.summary,
        connected: summary.status === "connected",
        statusLabel: summary.status === "connected" ? "Connected" : "Ready",
        icon: APP_ICONS[summary.entry.kind],
        meta: [
          { label: "Scope", value: "Account" },
          { label: "Checkout", value: "Ready" },
          { label: "Webhooks", value: "Ready" },
        ],
        actionLabel: "Open Billing",
        onAction: () => navigate("/account/billing"),
        detail: ["Billing portal", "Checkout", "Webhooks"],
      }),
    ),
    ...channelApps.map(
      (summary): IntegrationItem => ({
        id: summary.entry.kind,
        name: summary.entry.name,
        category: "Gateway",
        summary: summary.entry.summary,
        connected: summary.status === "connected",
        statusLabel: summary.status === "connected" ? "Connected" : "Ready",
        icon: APP_ICONS[summary.entry.kind],
        meta: [
          { label: "Gateways", value: formatInteger(summary.connectedChannels) },
          { label: "Routes", value: formatInteger(summary.allowedChats) },
          { label: "Agents", value: formatInteger(summary.agentCount) },
        ],
        actionLabel: "Open Gateways",
        onAction: () => navigate(gatewaysPath),
        detail: ["Inbound sessions", "Auto-reply routing", "Read-only routes"],
      }),
    ),
  ];
  const selectedIntegration =
    integrationItems.find((item) => item.id === selectedIntegrationId) ?? integrationItems[0];
  const pageTitle =
    surface === "apps"
      ? "Apps"
      : surface === "mail"
        ? "Mails"
        : surface === "websites"
          ? "Websites"
          : "Integrations";
  const primitiveCount =
    surface === "apps"
      ? appItems.length
      : surface === "mail"
        ? emailIdentities.length
        : surface === "websites"
          ? trustDomains.length
          : workspaceServices + channelApps.length + billingApps.length;
  const headerTitle = (
    <span className="trust-primitive-page-title">
      <span className="trust-primitive-page-title-text">{pageTitle}</span>
      <span className="trust-primitive-page-count" aria-hidden="true">
        {primitiveCount}
      </span>
    </span>
  );
  const toolbarSummary =
    surface === "apps"
      ? `${formatInteger(appItems.length)} operating surfaces · ${formatInteger(
          emailIdentities.length,
        )} mailboxes · ${formatInteger(trustDomains.length)} websites`
      : surface === "mail"
        ? emailStatus.isLoading
          ? "Checking mailbox"
          : `${formatInteger(emailIdentities.length)} mailboxes · ${formatInteger(
              emailCount,
            )} messages · outbound ${
              emailStatus.data?.outbound_status === "ready" ? "ready" : "setup"
            }`
        : surface === "websites"
          ? websiteAnalytics.isLoading
            ? "Checking website status"
            : `${primaryWebsiteDomain} · ${formatInteger(externalDomainCount)} external domains · ${websiteViews} today`
          : isLoading
            ? "Loading integration status"
            : `${formatInteger(workspaceServices)} workspace apps · ${formatInteger(
                installed.enabledChannels,
              )} gateway endpoints · ${formatInteger(
                trustAgents.length,
              )} agents${billingReady ? " · billing ready" : ""}`;
  const headerActions =
    surface === "mail" ? (
      <Button
        variant="primary"
        size="md"
        onClick={() => setMailCreatorOpen(true)}
        leadingIcon={<Plus size={14} strokeWidth={1.6} />}
      >
        New Mail
      </Button>
    ) : surface === "websites" ? (
      <Button
        variant="primary"
        size="md"
        onClick={() => setWebsiteCreatorOpen(true)}
        leadingIcon={<Plus size={14} strokeWidth={1.6} />}
      >
        New Website
      </Button>
    ) : surface === "integrations" ? (
      <Button
        variant="primary"
        size="md"
        onClick={() => setIntegrationCreatorOpen(true)}
        leadingIcon={<Plus size={14} strokeWidth={1.6} />}
      >
        New Integration
      </Button>
    ) : undefined;

  if (surface === "apps") {
    return (
      <AppRegistryPage
        headerTitle={headerTitle}
        items={appItems}
        onSelectApp={setSelectedAppId}
        selectedAppId={selectedAppId}
        toolbarSummary={toolbarSummary}
      />
    );
  }

  if (surface === "mail" || surface === "websites") {
    return (
      <div className="trust-apps-page trust-primitive-shell">
        <PrimitivePageHeader
          className="trust-apps-page-header trust-primitive-shell-header"
          title={headerTitle}
          aria-label={`${pageTitle} controls`}
          actions={headerActions}
          padding="none"
        />

        <main className="trust-apps-main trust-primitive-shell-surface trust-apps-shell-surface">
          <div className="trust-primitive-context-strip" role="status">
            <span className="trust-primitive-context-text">{toolbarSummary}</span>
          </div>

          {surface === "mail" && entity && (
            <MailPrimitivePage
              creatorOpen={mailCreatorOpen}
              domain={emailDomain}
              identities={emailIdentities}
              loading={emailStatus.isLoading}
              onCreatorClose={() => setMailCreatorOpen(false)}
              status={emailStatus.data}
              trustId={trustId}
            />
          )}

          {surface === "websites" && entity && (
            <WebsitesPrimitivePage
              analytics={websiteAnalytics.data}
              creatorOpen={websiteCreatorOpen}
              domains={trustDomains}
              href={publicWebsiteUrl(entity)}
              live={entity.public === true}
              loading={websiteAnalytics.isLoading || hostingDomains.isLoading}
              onCreatorClose={() => setWebsiteCreatorOpen(false)}
              onDomainAdded={() => void hostingDomains.refetch()}
              primaryDomain={primaryWebsiteDomain}
              trustId={trustId}
            />
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="trust-apps-page trust-primitive-shell">
      <PrimitivePageHeader
        className="trust-apps-page-header trust-primitive-shell-header trust-apps-page-header--summary"
        title={headerTitle}
        aria-label={`${pageTitle} controls`}
        actions={headerActions}
        padding="none"
      />

      <main className="trust-apps-main trust-primitive-shell-surface trust-apps-shell-surface">
        <div className="trust-primitive-context-strip" role="status">
          <span className="trust-primitive-context-text">{toolbarSummary}</span>
        </div>

        {surface === "integrations" && (
          <div className="trust-apps-register-layout" aria-label="Integration management">
            <section
              className="trust-apps-register-card"
              aria-labelledby="integration-register-heading"
            >
              <header className="trust-apps-register-head">
                <div>
                  <h2 id="integration-register-heading" className="trust-apps-register-title">
                    Providers
                  </h2>
                  <p className="trust-apps-register-subtitle">
                    Accounts and gateways connected to this trust.
                  </p>
                </div>
              </header>

              <div className="trust-apps-table-head trust-apps-table-head--integration" aria-hidden>
                <span>Provider</span>
                <span>Type</span>
                <span>Status</span>
              </div>
              <div className="trust-apps-register-list">
                {integrationItems.map((item) => (
                  <CardTrigger
                    key={item.id}
                    className="trust-apps-register-row trust-apps-register-row--integration"
                    data-selected={item.id === selectedIntegration?.id ? "true" : undefined}
                    onClick={() => setSelectedIntegrationId(item.id)}
                  >
                    <span className="trust-apps-row-main trust-apps-row-main--with-icon">
                      <span className="trust-apps-row-icon" aria-hidden>
                        {item.icon}
                      </span>
                      <span>
                        <span className="trust-apps-row-title">{item.name}</span>
                        <span className="trust-apps-row-subtitle">{item.summary}</span>
                      </span>
                    </span>
                    <span className="trust-apps-row-cell">{item.category}</span>
                    <span className="trust-apps-row-cell">{item.statusLabel}</span>
                  </CardTrigger>
                ))}
              </div>
            </section>

            {selectedIntegration && (
              <IntegrationDetail
                connecting={connectingIntegration === selectedIntegration.id}
                item={selectedIntegration}
              />
            )}

            <TrustIntegrationCreateModal
              connecting={connectingIntegration}
              onClose={() => setIntegrationCreatorOpen(false)}
              onGateway={openGatewayCreate}
              onGoogle={() => void startGoogleIntegration("modal-google")}
              onStripe={() => navigate("/account/billing")}
              open={integrationCreatorOpen}
            />
          </div>
        )}
      </main>
    </div>
  );
}

type IntegrationItem = {
  id: string;
  name: string;
  category: "Workspace" | "Billing" | "Gateway";
  summary: string;
  connected: boolean;
  statusLabel: string;
  icon: ReactNode;
  meta: Array<{ label: string; value: string }>;
  actionLabel: string;
  onAction: () => void;
  detail: string[];
};

function AppLogo({ icon, kind }: { icon: ReactNode; kind: WorkspaceAppKind | TrustAppKind }) {
  return (
    <span className="trust-app-logo" data-app={kind} aria-hidden>
      {icon}
    </span>
  );
}

function IntegrationDetail({ connecting, item }: { connecting: boolean; item: IntegrationItem }) {
  const actionIcon =
    item.category === "Billing" ? (
      <CreditCard size={14} strokeWidth={1.5} />
    ) : item.category === "Gateway" ? (
      <Smartphone size={14} strokeWidth={1.5} />
    ) : (
      <Cloud size={14} strokeWidth={1.5} />
    );

  return (
    <aside className="trust-apps-detail-panel" aria-label="Integration detail">
      <header className="trust-apps-detail-header">
        <span className="trust-apps-detail-icon" aria-hidden>
          {item.icon}
        </span>
        <div>
          <h2 className="trust-apps-detail-title">{item.name}</h2>
          <p className="trust-apps-detail-subtitle">{item.summary}</p>
        </div>
      </header>

      <div className="trust-apps-detail-grid">
        {item.meta.map((field) => (
          <span key={field.label} className="trust-apps-detail-field">
            <span className="trust-apps-detail-field-value">{field.value}</span>
            <span className="trust-apps-detail-field-label">{field.label}</span>
          </span>
        ))}
      </div>

      <section className="trust-apps-mini-section" aria-labelledby="integration-detail-heading">
        <h3 id="integration-detail-heading" className="trust-apps-mini-title">
          Capability
        </h3>
        <div className="trust-apps-chip-list">
          {item.detail.map((value) => (
            <span key={value} className="trust-apps-chip">
              {value}
            </span>
          ))}
        </div>
      </section>

      <div className="trust-apps-detail-actions">
        <Button
          variant={item.connected ? "secondary" : "primary"}
          size="md"
          onClick={item.onAction}
          loading={connecting}
          leadingIcon={actionIcon}
        >
          {item.actionLabel}
        </Button>
      </div>
    </aside>
  );
}
