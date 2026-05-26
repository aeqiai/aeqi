import { useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Cloud, MessageCircle, Send, Smartphone } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { integrationsApi } from "@/api/integrations";
import { useTrustApps } from "@/hooks/useTrustApps";
import { entityBasePath } from "@/lib/entityPath";
import { formatInteger } from "@/lib/i18n";
import { goExternal } from "@/lib/navigation";
import type { TrustAppKind, TrustAppSummary } from "@/lib/trustApps";
import { useDaemonStore } from "@/store/daemon";
import { Button } from "./ui";
import TrustWebsitePanel from "./TrustWebsitePanel";
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
  const googleConnected = googleStatus.data?.connected === true;
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

      <TrustWebsitePanel trustId={trustId} />

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
