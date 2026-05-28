import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Cloud, CreditCard, MessageCircle, Plus, Send, Smartphone } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { integrationsApi } from "@/api/integrations";
import { useTrustApps } from "@/hooks/useTrustApps";
import { api } from "@/lib/api";
import { entityBasePath } from "@/lib/entityPath";
import { formatInteger } from "@/lib/i18n";
import { goExternal } from "@/lib/navigation";
import { publicWebsiteDomain, publicWebsiteUrl } from "@/lib/publicWebsite";
import { trustEmailAddress, trustEmailDomain } from "@/lib/trustEmail";
import type { TrustAppKind, TrustAppSummary } from "@/lib/trustApps";
import { useDaemonStore } from "@/store/daemon";
import { Button, PrimitivePageHeader } from "./ui";
import {
  MailPrimitivePage,
  WebsitesPrimitivePage,
  normalizeEmailIdentities,
  normalizeWebsiteDomains,
} from "./TrustPrimitiveApps";
import "@/styles/overview.css";

const APP_ICONS: Record<TrustAppKind, ReactNode> = {
  telegram: <Send size={18} strokeWidth={1.5} />,
  whatsapp: <MessageCircle size={18} strokeWidth={1.5} />,
  stripe: <CreditCard size={18} strokeWidth={1.5} />,
};

export type TrustAppsSurface = "integrations" | "mail" | "websites";

export default function TrustAppsTab({
  surface = "integrations",
  trustId,
}: {
  surface?: TrustAppsSurface;
  trustId: string;
}) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mailCreatorOpen, setMailCreatorOpen] = useState(false);
  const [websiteCreatorOpen, setWebsiteCreatorOpen] = useState(false);
  const selectedKind = params.get("app");
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
    enabled: surface === "websites" && Boolean(entity),
    staleTime: 20_000,
  });
  const googleConnected = googleStatus.data?.connected === true;
  const connectedIntegrations = installed.connectedApps + (googleConnected ? 1 : 0);
  const gatewaysPath = `${basePath}/gateways`;
  const gatewayActionLabel = "Open Gateways";
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
  const pageTitle =
    surface === "mail" ? "Mails" : surface === "websites" ? "Websites" : "Integrations";
  const primitiveCount =
    surface === "mail"
      ? emailIdentities.length
      : surface === "websites"
        ? trustDomains.length
        : null;
  const headerTitle =
    primitiveCount == null ? (
      pageTitle
    ) : (
      <span className="trust-primitive-page-title">
        <span className="trust-primitive-page-title-text">{pageTitle}</span>
        <span className="trust-primitive-page-count" aria-hidden="true">
          {primitiveCount}
        </span>
      </span>
    );
  const toolbarSummary =
    surface === "mail"
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
          : `${formatInteger(connectedIntegrations)} connected · ${formatInteger(
              installed.enabledChannels,
            )} gateway endpoints · ${formatInteger(
              trustAgents.length,
            )} agents${billingReady ? " · billing ready" : ""}`;
  return (
    <div className="trust-overview trust-apps-page">
      <PrimitivePageHeader
        className="trust-apps-page-header"
        title={headerTitle}
        aria-label={`${pageTitle} controls`}
        actions={
          surface === "mail" ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setMailCreatorOpen((value) => !value)}
              leadingIcon={<Plus size={14} strokeWidth={1.6} />}
            >
              New Mail
            </Button>
          ) : surface === "websites" ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setWebsiteCreatorOpen((value) => !value)}
              leadingIcon={<Plus size={14} strokeWidth={1.6} />}
            >
              New Website
            </Button>
          ) : surface === "integrations" ? (
            <Button
              variant="secondary"
              size="md"
              onClick={() => navigate(gatewaysPath)}
              leadingIcon={<Smartphone size={14} strokeWidth={1.6} />}
            >
              Gateways
            </Button>
          ) : undefined
        }
      >
        <div className="ideas-toolbar trust-apps-toolbar">
          <span className="ideas-toolbar-meta trust-apps-toolbar-summary">{toolbarSummary}</span>
        </div>
      </PrimitivePageHeader>

      {surface === "mail" && entity && (
        <MailPrimitivePage
          accessBasePath={basePath}
          creatorOpen={mailCreatorOpen}
          domain={emailDomain}
          identities={emailIdentities}
          loading={emailStatus.isLoading}
          status={emailStatus.data}
          trustAgents={trustAgents}
          trustId={trustId}
        />
      )}

      {surface === "websites" && entity && (
        <WebsitesPrimitivePage
          analytics={websiteAnalytics.data}
          basePath={basePath}
          creatorOpen={websiteCreatorOpen}
          domains={trustDomains}
          href={publicWebsiteUrl(entity)}
          live={entity.public === true}
          loading={websiteAnalytics.isLoading || hostingDomains.isLoading}
          onDomainAdded={() => void hostingDomains.refetch()}
          primaryDomain={primaryWebsiteDomain}
          trustId={trustId}
        />
      )}

      {surface === "integrations" && (
        <>
          <section
            className="trust-cockpit-card trust-cockpit-card--wide"
            aria-labelledby="platform-integrations-heading"
          >
            <header className="trust-cockpit-card-header">
              <div>
                <h2 id="platform-integrations-heading" className="trust-cockpit-card-title">
                  Platform integrations
                </h2>
                <p className="trust-cockpit-card-sub">
                  Workspace, billing, and account-level services.
                </p>
              </div>
            </header>
            <div className="trust-apps-grid trust-apps-grid--workspace">
              <GoogleWorkspaceCard
                connected={googleConnected}
                loading={googleStatus.isLoading}
                status={googleStatus.data}
                trustId={trustId}
              />
              {billingApps.map((summary) => (
                <AppDetailCard
                  key={summary.entry.kind}
                  selected={selectedKind === summary.entry.kind}
                  summary={summary}
                  channelsPath="/account/billing"
                  actionLabel="Open Billing"
                />
              ))}
            </div>
          </section>

          <section
            className="trust-cockpit-card trust-cockpit-card--wide"
            aria-labelledby="gateway-integrations-heading"
          >
            <header className="trust-cockpit-card-header">
              <div>
                <h2 id="gateway-integrations-heading" className="trust-cockpit-card-title">
                  Gateway integrations
                </h2>
                <p className="trust-cockpit-card-sub">
                  External messaging providers managed through Gateways.
                </p>
              </div>
              <Link to={gatewaysPath} className="trust-apps-link">
                {gatewayActionLabel}
              </Link>
            </header>
            <div className="trust-apps-grid">
              {channelApps.map((summary) => (
                <AppDetailCard
                  key={summary.entry.kind}
                  selected={selectedKind === summary.entry.kind}
                  summary={summary}
                  channelsPath={gatewaysPath}
                  actionLabel={gatewayActionLabel}
                />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function GoogleWorkspaceCard({
  connected,
  loading,
  status,
  trustId,
}: {
  connected: boolean;
  loading: boolean;
  status?: Awaited<ReturnType<typeof integrationsApi.getTrustGoogleStatus>>;
  trustId: string;
}) {
  const [connecting, setConnecting] = useState(false);
  const account = status?.account_email || "TRUST";
  const scopes = status?.scopes?.length ?? 0;

  async function connect() {
    setConnecting(true);
    try {
      const res = await integrationsApi.startTrustGoogle(trustId);
      goExternal(res.authorize_url);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <article className="trust-app-card" data-selected={connected ? "true" : undefined}>
      <header className="trust-app-card-header">
        <span className="trust-app-card-icon" aria-hidden>
          <Cloud size={18} strokeWidth={1.5} />
        </span>
        <div className="trust-app-card-title-block">
          <h3 className="trust-app-card-title">Google Workspace</h3>
          <p className="trust-app-card-summary">Gmail, Calendar, Drive, Slides</p>
        </div>
        <span className="trust-app-status-pill" data-status={connected ? "connected" : undefined}>
          {loading ? "Checking" : connected ? "Connected" : "Ready"}
        </span>
      </header>
      <div className="trust-app-card-stats trust-app-card-stats--workspace">
        <Stat label="Account" value={account} />
        <Stat label="Scopes" value={formatInteger(scopes)} />
        <Stat label="Owner" value="Trust" />
      </div>
      <Button
        className="trust-app-card-button"
        variant={connected ? "secondary" : "primary"}
        size="md"
        loading={connecting}
        onClick={connect}
        leadingIcon={<Cloud size={14} strokeWidth={1.5} />}
      >
        {connected ? "Reconnect" : "Connect"}
      </Button>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <span className="trust-apps-stat">
      <span className="trust-apps-stat-value">{value}</span>
      <span className="trust-apps-stat-label">{label}</span>
    </span>
  );
}

function AppDetailCard({
  actionLabel,
  channelsPath,
  selected,
  summary,
}: {
  actionLabel: string;
  channelsPath: string;
  selected: boolean;
  summary: TrustAppSummary;
}) {
  const connected = summary.status === "connected";
  const billing = summary.entry.category === "billing";

  return (
    <article className="trust-app-card" data-selected={selected ? "true" : undefined}>
      <header className="trust-app-card-header">
        <span className="trust-app-card-icon" aria-hidden>
          {APP_ICONS[summary.entry.kind]}
        </span>
        <div className="trust-app-card-title-block">
          <h3 className="trust-app-card-title">{summary.entry.name}</h3>
          <p className="trust-app-card-summary">{summary.entry.summary}</p>
        </div>
        <span className="trust-app-status-pill" data-status={summary.status}>
          {connected ? "Connected" : "Ready"}
        </span>
      </header>
      {billing ? (
        <div className="trust-app-card-stats trust-app-card-stats--billing">
          <Stat label="Scope" value="Account" />
          <Stat label="Checkout" value="Ready" />
          <Stat label="Webhooks" value="Ready" />
          <Stat label="Portal" value="Stripe" />
        </div>
      ) : (
        <div className="trust-app-card-stats">
          <Stat label="Gateways" value={formatInteger(summary.connectedChannels)} />
          <Stat label="Enabled" value={formatInteger(summary.enabledChannels)} />
          <Stat label="Routes" value={formatInteger(summary.allowedChats)} />
          <Stat label="Agents" value={formatInteger(summary.agentCount)} />
        </div>
      )}
      <Link to={channelsPath} className="trust-app-card-action">
        {billing ? (
          <CreditCard size={14} strokeWidth={1.5} aria-hidden />
        ) : (
          <Smartphone size={14} strokeWidth={1.5} aria-hidden />
        )}
        {actionLabel}
      </Link>
    </article>
  );
}
