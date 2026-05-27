import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  ArrowUpRight,
  Check,
  Cloud,
  Copy,
  Globe,
  Mail,
  MessageCircle,
  Send,
  Smartphone,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { integrationsApi } from "@/api/integrations";
import { useTrustApps } from "@/hooks/useTrustApps";
import { api } from "@/lib/api";
import { entityBasePath } from "@/lib/entityPath";
import { formatDateTime, formatInteger } from "@/lib/i18n";
import { goExternal } from "@/lib/navigation";
import { publicWebsiteDomain, publicWebsiteUrl } from "@/lib/publicWebsite";
import { trustEmailAddress, trustEmailDomain } from "@/lib/trustEmail";
import type { TrustAppKind, TrustAppSummary } from "@/lib/trustApps";
import { useDaemonStore } from "@/store/daemon";
import { Button } from "./ui";
import "@/styles/overview.css";

const APP_ICONS: Record<TrustAppKind, ReactNode> = {
  telegram: <Send size={18} strokeWidth={1.5} />,
  whatsapp: <MessageCircle size={18} strokeWidth={1.5} />,
};

export default function TrustAppsTab({ trustId }: { trustId: string }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selectedKind = params.get("app");
  const entities = useDaemonStore((s) => s.entities);
  const entity = entities.find((item) => item.id === trustId);
  const basePath = entity ? entityBasePath(entity) : "/launch";
  const { defaultAgent, installed, isLoading, summaries, trustAgents } = useTrustApps(trustId);
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
  const googleConnected = googleStatus.data?.connected === true;
  const identityApps = entity ? 2 : 0;
  const connectedApps = installed.connectedApps + (googleConnected ? 1 : 0);
  const agentChannelsPath = defaultAgent
    ? `${basePath}/agents/${encodeURIComponent(defaultAgent.id)}/settings/channels`
    : `${basePath}/agents`;
  const channelActionLabel = defaultAgent ? "Open Channels" : "Open Agents";
  return (
    <div className="trust-overview trust-apps-page">
      <header className="trust-apps-page-header">
        <h1 className="trust-apps-page-title">Apps</h1>
        <div className="ideas-toolbar trust-apps-toolbar" aria-label="App controls">
          <span className="ideas-toolbar-meta trust-apps-toolbar-summary">
            {isLoading
              ? "Loading app status"
              : `${formatInteger(connectedApps)} connected · ${formatInteger(
                  identityApps,
                )} identity · ${formatInteger(
                  installed.enabledChannels,
                )} channels · ${formatInteger(trustAgents.length)} agents${
                  entity?.public ? " · website live" : ""
                }`}
          </span>
          <Button
            variant="secondary"
            size="md"
            onClick={() => navigate(agentChannelsPath)}
            leadingIcon={<Smartphone size={14} strokeWidth={1.6} />}
          >
            {defaultAgent ? "Channels" : "Agents"}
          </Button>
        </div>
      </header>

      {entity && (
        <section
          className="trust-cockpit-card trust-cockpit-card--wide"
          aria-labelledby="launch-apps-heading"
        >
          <header className="trust-cockpit-card-header">
            <div>
              <h2 id="launch-apps-heading" className="trust-cockpit-card-title">
                Launch apps
              </h2>
              <p className="trust-cockpit-card-sub">
                The public company surface every TRUST gets at formation.
              </p>
            </div>
          </header>
          <div className="trust-apps-grid trust-apps-grid--launch">
            <WebsiteAppCard
              domain={publicWebsiteDomain(entity)}
              href={publicWebsiteUrl(entity)}
              live={entity.public === true}
              loading={websiteAnalytics.isLoading}
              analytics={websiteAnalytics.data}
            />
            <TrustEmailCard
              email={trustEmailAddress(entity)}
              domain={trustEmailDomain(entity)}
              loading={emailStatus.isLoading}
              status={emailStatus.data}
            />
          </div>
        </section>
      )}

      <section
        className="trust-cockpit-card trust-cockpit-card--wide"
        aria-labelledby="workspace-apps-heading"
      >
        <header className="trust-cockpit-card-header">
          <h2 id="workspace-apps-heading" className="trust-cockpit-card-title">
            Workspace apps
          </h2>
        </header>
        <div className="trust-apps-grid trust-apps-grid--workspace">
          <GoogleWorkspaceCard
            connected={googleConnected}
            loading={googleStatus.isLoading}
            status={googleStatus.data}
            trustId={trustId}
          />
        </div>
      </section>

      <section
        className="trust-cockpit-card trust-cockpit-card--wide"
        aria-labelledby="channel-apps-heading"
      >
        <header className="trust-cockpit-card-header">
          <h2 id="channel-apps-heading" className="trust-cockpit-card-title">
            Channel apps
          </h2>
          <Link to={agentChannelsPath} className="trust-apps-link">
            {channelActionLabel}
          </Link>
        </header>
        <div className="trust-apps-grid">
          {summaries.map((summary) => (
            <AppDetailCard
              key={summary.entry.kind}
              selected={selectedKind === summary.entry.kind}
              summary={summary}
              channelsPath={agentChannelsPath}
              actionLabel={channelActionLabel}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function WebsiteAppCard({
  analytics,
  domain,
  href,
  live,
  loading,
}: {
  analytics?: Awaited<ReturnType<typeof api.getTrustWebsiteAnalytics>>;
  domain: string;
  href: string;
  live: boolean;
  loading: boolean;
}) {
  const tracking = analyticsTrackingLabel(analytics, loading, live);
  const views24h = analytics?.stats ? formatInteger(analytics.stats.last_24h.pageviews) : "—";
  const viewsValue = loading
    ? "Checking"
    : analytics?.status === "setup_required"
      ? "Setup"
      : views24h;
  return (
    <article className="trust-app-card trust-app-card--identity" data-selected="true">
      <header className="trust-app-card-header">
        <span className="trust-app-card-icon" aria-hidden>
          <Globe size={18} strokeWidth={1.5} />
        </span>
        <div className="trust-app-card-title-block">
          <h3 className="trust-app-card-title">Website</h3>
          <p className="trust-app-card-summary">Public TRUST website and launch page</p>
        </div>
        <span className="trust-app-status-pill" data-status={live ? "connected" : undefined}>
          {live ? "Live" : "Private"}
        </span>
      </header>
      <div className="trust-app-card-stats trust-app-card-stats--identity">
        <Stat label="Domain" value={domain} />
        <Stat label="Visibility" value={live ? "Public" : "Private"} />
        <Stat label="Tracking" value={tracking} />
        <Stat label="Today Views" value={viewsValue} />
      </div>
      <a className="trust-app-card-action" href={href} target="_blank" rel="noreferrer">
        <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden />
        Open Website
      </a>
    </article>
  );
}

function analyticsTrackingLabel(
  analytics: Awaited<ReturnType<typeof api.getTrustWebsiteAnalytics>> | undefined,
  loading: boolean,
  live: boolean,
): string {
  if (loading) return "Checking";
  if (analytics?.tracking_status === "installed") return "Installed";
  if (live) return "Installed";
  return "Ready";
}

function TrustEmailCard({
  domain,
  email,
  loading,
  status,
}: {
  domain: string;
  email: string;
  loading: boolean;
  status?: Awaited<ReturnType<typeof api.getTrustEmailMessages>>;
}) {
  const [copied, setCopied] = useState(false);
  const messages = status?.messages ?? [];
  const latest = messages[0];
  const routingLabel = loading
    ? "Checking"
    : status?.routing_status === "maildrop"
      ? "Active"
      : "Ready";

  async function copyEmail() {
    try {
      await navigator.clipboard?.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  return (
    <article className="trust-app-card trust-app-card--identity" data-selected="true">
      <header className="trust-app-card-header">
        <span className="trust-app-card-icon" aria-hidden>
          <Mail size={18} strokeWidth={1.5} />
        </span>
        <div className="trust-app-card-title-block">
          <h3 className="trust-app-card-title">Email</h3>
          <p className="trust-app-card-summary">Canonical inbox identity for this TRUST</p>
        </div>
        <span
          className="trust-app-status-pill"
          data-status={status?.routing_status === "maildrop" ? "connected" : undefined}
        >
          {routingLabel}
        </span>
      </header>
      <div className="trust-app-card-stats trust-app-card-stats--email">
        <Stat label="Address" value={email} />
        <Stat label="Domain" value={domain} />
        <Stat label="Inbox" value={formatInteger(status?.message_count ?? messages.length)} />
        <Stat
          label="Latest"
          value={latest?.received_at ? formatInboxTime(latest.received_at) : "None"}
        />
      </div>
      <Button
        className="trust-app-card-button"
        variant="secondary"
        size="md"
        onClick={copyEmail}
        leadingIcon={
          copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />
        }
      >
        {copied ? "Copied" : "Copy Email"}
      </Button>
    </article>
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

function formatInboxTime(value: string): string {
  return formatDateTime(value, { fallback: "Received" });
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
      <div className="trust-app-card-stats">
        <Stat label="Channels" value={formatInteger(summary.connectedChannels)} />
        <Stat label="Enabled" value={formatInteger(summary.enabledChannels)} />
        <Stat label="Chats" value={formatInteger(summary.allowedChats)} />
        <Stat label="Agents" value={formatInteger(summary.agentCount)} />
      </div>
      <Link to={channelsPath} className="trust-app-card-action">
        <Smartphone size={14} strokeWidth={1.5} aria-hidden />
        {actionLabel}
      </Link>
    </article>
  );
}
