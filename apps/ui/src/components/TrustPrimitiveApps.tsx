import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight,
  AtSign,
  Check,
  Copy,
  Globe,
  Inbox,
  KeyRound,
  Mail,
  Send,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatInteger } from "@/lib/i18n";

export type TrustEmailIdentitySummary = {
  kind: string;
  label: string;
  local_part: string;
  address: string;
};

type HostingDomainSummary = Awaited<ReturnType<typeof api.listHostingDomains>>["domains"][number];

export function MailPrimitivePage({
  accessBasePath,
  creatorOpen,
  domain,
  identities,
  loading,
  status,
  trustAgents,
  trustId,
}: {
  accessBasePath: string;
  creatorOpen: boolean;
  domain: string;
  identities: TrustEmailIdentitySummary[];
  loading: boolean;
  status?: Awaited<ReturnType<typeof api.getTrustEmailMessages>>;
  trustAgents: Array<{ id: string; name?: string | null; status?: string | null }>;
  trustId: string;
}) {
  const messages = status?.messages ?? [];
  const outboundReady = status?.outbound_status === "ready";
  return (
    <div className="trust-primitive-layout" aria-label="Mail management">
      <section className="trust-primitive-panel trust-primitive-panel--main">
        <header className="trust-primitive-panel-header">
          <div>
            <h2 className="trust-primitive-title">Mailboxes</h2>
            <p className="trust-primitive-subtitle">{domain}</p>
          </div>
          <span
            className="trust-app-status-pill"
            data-status={outboundReady ? "connected" : undefined}
          >
            {loading ? "Checking" : outboundReady ? "Outbound ready" : "Inbound ready"}
          </span>
        </header>

        {creatorOpen && <NewMailPanel domain={domain} />}

        <div className="trust-mailbox-list">
          {identities.map((identity) => (
            <TrustEmailCard
              key={identity.address}
              email={identity.address}
              identity={identity}
              loading={loading}
              status={status}
              trustId={trustId}
            />
          ))}
        </div>
      </section>

      <aside className="trust-primitive-panel trust-primitive-panel--side">
        <header className="trust-primitive-panel-header">
          <div>
            <h2 className="trust-primitive-title">Access</h2>
            <p className="trust-primitive-subtitle">Humans, roles, and agents that can use mail.</p>
          </div>
        </header>
        <div className="trust-access-list">
          <AccessRow
            icon={<KeyRound size={16} strokeWidth={1.6} />}
            label="Roles"
            value="Use role grants"
            to={`${accessBasePath}/roles`}
          />
          <AccessRow
            icon={<Users size={16} strokeWidth={1.6} />}
            label="Humans"
            value="Members and invitees"
            to={`${accessBasePath}/members`}
          />
          <AccessRow
            icon={<Inbox size={16} strokeWidth={1.6} />}
            label="Agents"
            value={`${formatInteger(trustAgents.length)} available`}
            to={`${accessBasePath}/agents`}
          />
        </div>
      </aside>

      <section className="trust-primitive-panel trust-primitive-panel--wide">
        <header className="trust-primitive-panel-header">
          <div>
            <h2 className="trust-primitive-title">Recent inbound</h2>
            <p className="trust-primitive-subtitle">
              {messages.length
                ? `${formatInteger(messages.length)} latest messages`
                : "No replies yet"}
            </p>
          </div>
        </header>
        <div className="trust-mail-preview-list">
          {messages.length ? (
            messages.slice(0, 4).map((message) => (
              <article key={message.id} className="trust-mail-preview-row">
                <span className="trust-mail-preview-from">
                  {message.sender || message.recipient}
                </span>
                <span className="trust-mail-preview-subject">
                  {message.subject || "No subject"}
                </span>
                <span className="trust-mail-preview-time">
                  {formatInboxTime(message.received_at)}
                </span>
              </article>
            ))
          ) : (
            <div className="trust-primitive-empty">Replies to trust mail will appear here.</div>
          )}
        </div>
      </section>
    </div>
  );
}

function NewMailPanel({ domain }: { domain: string }) {
  return (
    <div className="trust-primitive-create-panel">
      <div className="trust-primitive-create-icon" aria-hidden>
        <AtSign size={16} strokeWidth={1.7} />
      </div>
      <div className="trust-primitive-create-copy">
        <span className="trust-primitive-create-title">New mailbox</span>
        <span className="trust-primitive-create-subtitle">name@{domain}</span>
      </div>
      <div className="trust-primitive-create-fields">
        <input aria-label="Mailbox name" placeholder="press" />
        <span>@{domain}</span>
      </div>
    </div>
  );
}

export function WebsitesPrimitivePage({
  analytics,
  basePath,
  creatorOpen,
  domains,
  href,
  live,
  loading,
  onDomainAdded,
  primaryDomain,
  trustId,
}: {
  analytics?: Awaited<ReturnType<typeof api.getTrustWebsiteAnalytics>>;
  basePath: string;
  creatorOpen: boolean;
  domains: Array<{
    domain: string;
    kind: "aeqi" | "external";
    status: string;
  }>;
  href: string;
  live: boolean;
  loading: boolean;
  onDomainAdded: () => void;
  primaryDomain: string;
  trustId: string;
}) {
  return (
    <div className="trust-primitive-layout" aria-label="Website management">
      <section className="trust-primitive-panel trust-primitive-panel--main">
        <header className="trust-primitive-panel-header">
          <div>
            <h2 className="trust-primitive-title">Canonical website</h2>
            <p className="trust-primitive-subtitle">{primaryDomain}</p>
          </div>
          <span className="trust-app-status-pill" data-status={live ? "connected" : undefined}>
            {loading ? "Checking" : live ? "Live" : "Private"}
          </span>
        </header>
        {creatorOpen && (
          <NewWebsitePanel
            onDomainAdded={onDomainAdded}
            primaryDomain={primaryDomain}
            trustId={trustId}
          />
        )}
        <WebsiteAppCard
          analytics={analytics}
          domain={primaryDomain}
          href={href}
          live={live}
          loading={loading}
        />
      </section>

      <aside className="trust-primitive-panel trust-primitive-panel--side">
        <header className="trust-primitive-panel-header">
          <div>
            <h2 className="trust-primitive-title">Website modules</h2>
            <p className="trust-primitive-subtitle">Public trust surface</p>
          </div>
        </header>
        <div className="trust-access-list">
          <AccessRow
            icon={<Globe size={16} strokeWidth={1.6} />}
            label="Hello page"
            value="Canonical"
            href={href}
          />
          <AccessRow
            icon={<KeyRound size={16} strokeWidth={1.6} />}
            label="Roles"
            value="Public view"
            to={`${basePath}/roles`}
          />
          <AccessRow
            icon={<Inbox size={16} strokeWidth={1.6} />}
            label="Activity"
            value="Trust record"
            to={`${basePath}/quests`}
          />
        </div>
      </aside>

      <section className="trust-primitive-panel trust-primitive-panel--wide">
        <header className="trust-primitive-panel-header">
          <div>
            <h2 className="trust-primitive-title">Domains</h2>
            <p className="trust-primitive-subtitle">One AEQI subdomain plus external domains.</p>
          </div>
        </header>
        <div className="trust-domain-list">
          {domains.map((domain) => (
            <DomainRow key={domain.domain} domain={domain} />
          ))}
        </div>
      </section>
    </div>
  );
}

function NewWebsitePanel({
  onDomainAdded,
  primaryDomain,
  trustId,
}: {
  onDomainAdded: () => void;
  primaryDomain: string;
  trustId: string;
}) {
  const [domain, setDomain] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "failed">("idle");
  const normalizedDomain = domain.trim().toLowerCase();
  const canSubmit = normalizedDomain.length > 3 && normalizedDomain.includes(".");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || state === "saving") return;
    setState("saving");
    try {
      await api.addHostingDomain({
        domain: normalizedDomain,
        app_id: `website:${trustId}`,
        trust_id: trustId,
      });
      setDomain("");
      setState("saved");
      onDomainAdded();
      window.setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("failed");
    }
  }

  return (
    <form className="trust-primitive-create-panel" onSubmit={handleSubmit}>
      <div className="trust-primitive-create-icon" aria-hidden>
        <Globe size={16} strokeWidth={1.7} />
      </div>
      <div className="trust-primitive-create-copy">
        <span className="trust-primitive-create-title">Attach website</span>
        <span className="trust-primitive-create-subtitle">
          External domains point at {primaryDomain}
        </span>
      </div>
      <div className="trust-primitive-create-fields trust-primitive-create-fields--wide">
        <input
          aria-label="External domain"
          onChange={(event) => setDomain(event.target.value)}
          placeholder="www.company.com"
          value={domain}
        />
      </div>
      <Button
        className="trust-primitive-create-action"
        disabled={!canSubmit}
        loading={state === "saving"}
        size="md"
        type="submit"
        variant={state === "saved" ? "secondary" : "primary"}
      >
        {state === "saved" ? "Attached" : state === "failed" ? "Retry" : "Add Domain"}
      </Button>
    </form>
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
  const views24h = analytics?.stats ? formatInteger(analytics.stats.last_24h.pageviews) : "-";
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
  email,
  identity,
  loading,
  status,
  trustId,
}: {
  email: string;
  identity: TrustEmailIdentitySummary;
  loading: boolean;
  status?: Awaited<ReturnType<typeof api.getTrustEmailMessages>>;
  trustId: string;
}) {
  const [copied, setCopied] = useState(false);
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const messages = status?.messages ?? [];
  const latest = messages[0];
  const routingLabel = loading
    ? "Checking"
    : status?.routing_status === "maildrop"
      ? "Active"
      : "Ready";
  const outboundLabel = loading
    ? "Checking"
    : status?.outbound_status === "ready"
      ? "Ready"
      : "Setup";

  async function copyEmail() {
    try {
      await navigator.clipboard?.writeText(email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  async function sendTestEmail() {
    setSendState("sending");
    try {
      await api.sendTrustEmailTest(trustId);
      setSendState("sent");
      window.setTimeout(() => setSendState("idle"), 2400);
    } catch {
      setSendState("failed");
    }
  }

  return (
    <article className="trust-app-card trust-app-card--identity" data-selected="true">
      <header className="trust-app-card-header">
        <span className="trust-app-card-icon" aria-hidden>
          <Mail size={18} strokeWidth={1.5} />
        </span>
        <div className="trust-app-card-title-block">
          <h3 className="trust-app-card-title">{identity.label}</h3>
          <p className="trust-app-card-summary">{identity.address}</p>
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
        <Stat label="Local" value={identity.local_part} />
        <Stat label="Inbox" value={formatInteger(status?.message_count ?? messages.length)} />
        <Stat label="Outbound" value={outboundLabel} />
      </div>
      <div className="trust-app-card-actions">
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
        <Button
          className="trust-app-card-button"
          variant="secondary"
          size="md"
          onClick={sendTestEmail}
          disabled={sendState === "sending" || status?.outbound_status !== "ready"}
          leadingIcon={
            sendState === "sent" ? (
              <Check size={14} strokeWidth={1.5} />
            ) : (
              <Send size={14} strokeWidth={1.5} />
            )
          }
        >
          {sendState === "sending"
            ? "Sending"
            : sendState === "sent"
              ? "Sent"
              : sendState === "failed"
                ? "Failed"
                : "Send Test"}
        </Button>
      </div>
      <div className="trust-app-card-footnote">
        {latest?.received_at
          ? `Latest inbound ${formatInboxTime(latest.received_at)}`
          : "Replies land in this trust inbox."}
      </div>
    </article>
  );
}

function AccessRow({
  href,
  icon,
  label,
  to,
  value,
}: {
  href?: string;
  icon: ReactNode;
  label: string;
  to?: string;
  value: string;
}) {
  const content = (
    <>
      <span className="trust-access-icon" aria-hidden>
        {icon}
      </span>
      <span className="trust-access-copy">
        <span className="trust-access-label">{label}</span>
        <span className="trust-access-value">{value}</span>
      </span>
      <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden />
    </>
  );
  if (href) {
    return (
      <a className="trust-access-row" href={href} target="_blank" rel="noreferrer">
        {content}
      </a>
    );
  }
  return (
    <Link className="trust-access-row" to={to ?? "#"}>
      {content}
    </Link>
  );
}

function DomainRow({
  domain,
}: {
  domain: {
    domain: string;
    kind: "aeqi" | "external";
    status: string;
  };
}) {
  return (
    <article className="trust-domain-row">
      <span className="trust-domain-kind" data-kind={domain.kind}>
        {domain.kind === "aeqi" ? "AEQI" : "External"}
      </span>
      <span className="trust-domain-name">{domain.domain}</span>
      <span className="trust-domain-status">{domain.status}</span>
    </article>
  );
}

export function normalizeEmailIdentities(
  identities: TrustEmailIdentitySummary[] | undefined,
  fallbackEmail: string,
): TrustEmailIdentitySummary[] {
  if (identities?.length) return identities;
  const [localPart = "hello", domain = "aeqi.ai"] = fallbackEmail.split("@");
  return [
    {
      kind: "trust",
      label: "Company",
      local_part: localPart,
      address: `${localPart}@${domain}`,
    },
  ];
}

export function normalizeWebsiteDomains(
  primaryDomain: string,
  domains: HostingDomainSummary[] | undefined,
  trustId: string,
): Array<{ domain: string; kind: "aeqi" | "external"; status: string }> {
  const external = (domains ?? [])
    .filter((item) => item.root === trustId)
    .map((item) => item.domain)
    .filter((domain) => domain && domain !== primaryDomain);
  return [
    { domain: primaryDomain, kind: "aeqi", status: "Default subdomain" },
    ...[...new Set(external)].map((domain) => ({
      domain,
      kind: "external" as const,
      status: "Attached",
    })),
  ];
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
