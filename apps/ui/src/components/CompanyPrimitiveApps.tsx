import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Check, Copy, Globe, Mail, Send } from "lucide-react";

import { Button, CardTrigger } from "@/components/ui";
import { api } from "@/lib/api";
import { formatDateTime, formatInteger } from "@/lib/i18n";
import {
  NewMailModal,
  NewWebsiteModal,
  sanitizeLocalPart,
  titleFromLocalPart,
} from "./CompanyPrimitiveAppModals";

export type CompanyEmailIdentitySummary = {
  kind: string;
  label: string;
  local_part: string;
  address: string;
};

type HostingDomainSummary = Awaited<ReturnType<typeof api.listHostingDomains>>["domains"][number];
type CompanyEmailStatus = Awaited<ReturnType<typeof api.getCompanyEmailMessages>>;
type CompanyEmailMessage = CompanyEmailStatus["messages"][number];
type WebsiteAnalytics = Awaited<ReturnType<typeof api.getCompanyWebsiteAnalytics>>;

export type CompanyWebsiteDomain = {
  domain: string;
  kind: "aeqi" | "external";
  status: string;
  ssl?: boolean | null;
  created_at?: string | null;
};

export function MailPrimitivePage({
  creatorOpen,
  domain,
  identities,
  loading,
  onCreatorClose,
  status,
  companyId,
}: {
  creatorOpen: boolean;
  domain: string;
  identities: CompanyEmailIdentitySummary[];
  loading: boolean;
  onCreatorClose: () => void;
  status?: CompanyEmailStatus;
  companyId: string;
}) {
  const [localIdentities, setLocalIdentities] = useState<CompanyEmailIdentitySummary[]>([]);
  const mailboxes = useMemo(() => {
    const byAddress = new Map<string, CompanyEmailIdentitySummary>();
    for (const identity of [...identities, ...localIdentities]) {
      byAddress.set(identity.address.toLowerCase(), identity);
    }
    return [...byAddress.values()];
  }, [identities, localIdentities]);
  const [selectedAddress, setSelectedAddress] = useState(mailboxes[0]?.address ?? "");

  useEffect(() => {
    if (!mailboxes.length) return;
    if (!mailboxes.some((identity) => identity.address === selectedAddress)) {
      setSelectedAddress(mailboxes[0].address);
    }
  }, [mailboxes, selectedAddress]);

  const selected =
    mailboxes.find((identity) => identity.address === selectedAddress) ?? mailboxes[0];
  const messages = status?.messages ?? [];

  function handleCreateMailbox(localPart: string, label: string) {
    const local = sanitizeLocalPart(localPart);
    if (!local) return;
    const address = `${local}@${domain}`;
    const next = {
      kind: "alias",
      label: label.trim() || titleFromLocalPart(local),
      local_part: local,
      address,
    };
    setLocalIdentities((current) => {
      if (current.some((identity) => identity.address.toLowerCase() === address.toLowerCase())) {
        return current;
      }
      return [...current, next];
    });
    setSelectedAddress(address);
    onCreatorClose();
  }

  return (
    <div className="company-apps-register-layout" aria-label="Mail management">
      <section className="company-apps-register-card" aria-labelledby="mail-register-heading">
        <header className="company-apps-register-head">
          <div>
            <h2 id="mail-register-heading" className="company-apps-register-title">
              Mailboxes
            </h2>
            <p className="company-apps-register-subtitle">{domain}</p>
          </div>
          <StatusPill
            loading={loading}
            connected={status?.outbound_status === "ready"}
            label={status?.outbound_status === "ready" ? "Ready" : "Inbound"}
          />
        </header>

        <div className="company-apps-table-head company-apps-table-head--mail" aria-hidden>
          <span>Address</span>
          <span>Messages</span>
          <span>Outbound</span>
        </div>
        <div className="company-apps-register-list">
          {mailboxes.map((identity) => (
            <CardTrigger
              key={identity.address}
              className="company-apps-register-row company-apps-register-row--mail"
              data-selected={identity.address === selected?.address ? "true" : undefined}
              onClick={() => setSelectedAddress(identity.address)}
            >
              <span className="company-apps-row-main">
                <span className="company-apps-row-title">{identity.label}</span>
                <span className="company-apps-row-subtitle">{identity.address}</span>
              </span>
              <span className="company-apps-row-cell">
                {formatInteger(status?.message_count ?? messages.length)}
              </span>
              <span className="company-apps-row-cell">
                {status?.outbound_status === "ready" ? "Ready" : "Setup"}
              </span>
            </CardTrigger>
          ))}
        </div>
      </section>

      <MailDetail
        identity={selected}
        loading={loading}
        messages={messages}
        status={status}
        companyId={companyId}
      />

      <NewMailModal
        domain={domain}
        existing={mailboxes}
        onClose={onCreatorClose}
        onCreate={handleCreateMailbox}
        open={creatorOpen}
      />
    </div>
  );
}

function MailDetail({
  identity,
  loading,
  messages,
  status,
  companyId,
}: {
  identity?: CompanyEmailIdentitySummary;
  loading: boolean;
  messages: CompanyEmailMessage[];
  status?: CompanyEmailStatus;
  companyId: string;
}) {
  const [copied, setCopied] = useState(false);
  const [sendState, setSendState] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const relatedMessages = identity
    ? messages.filter((message) => {
        const recipient = (message.recipient ?? "").toLowerCase();
        return (
          recipient === identity.address.toLowerCase() ||
          recipient.startsWith(`${identity.local_part.toLowerCase()}@`)
        );
      })
    : messages;
  const visibleMessages = relatedMessages.length ? relatedMessages : messages;

  async function copyEmail() {
    if (!identity) return;
    try {
      await navigator.clipboard?.writeText(identity.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }

  async function sendTestEmail() {
    setSendState("sending");
    try {
      await api.sendCompanyEmailTest(companyId);
      setSendState("sent");
      window.setTimeout(() => setSendState("idle"), 2400);
    } catch {
      setSendState("failed");
    }
  }

  return (
    <aside className="company-apps-detail-panel" aria-label="Mailbox detail">
      <header className="company-apps-detail-header">
        <span className="company-apps-detail-icon" aria-hidden>
          <Mail size={18} strokeWidth={1.5} />
        </span>
        <div>
          <h2 className="company-apps-detail-title">{identity?.label ?? "Mailbox"}</h2>
          <p className="company-apps-detail-subtitle">
            {identity?.address ?? "No mailbox selected"}
          </p>
        </div>
      </header>

      <div className="company-apps-detail-grid">
        <DetailField label="Address" value={identity?.address ?? "-"} />
        <DetailField
          label="Routing"
          value={loading ? "Checking" : status?.routing_status === "maildrop" ? "Active" : "Ready"}
        />
        <DetailField
          label="Outbound"
          value={loading ? "Checking" : status?.outbound_status === "ready" ? "Ready" : "Setup"}
        />
        <DetailField
          label="Messages"
          value={formatInteger(status?.message_count ?? messages.length)}
        />
      </div>

      <div className="company-apps-detail-actions">
        <Button
          variant="secondary"
          size="md"
          onClick={copyEmail}
          disabled={!identity}
          leadingIcon={
            copied ? <Check size={14} strokeWidth={1.5} /> : <Copy size={14} strokeWidth={1.5} />
          }
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button
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

      <section className="company-apps-mini-section" aria-labelledby="mail-inbound-heading">
        <h3 id="mail-inbound-heading" className="company-apps-mini-title">
          Inbound
        </h3>
        {visibleMessages.length ? (
          <div className="company-apps-mini-list">
            {visibleMessages.slice(0, 4).map((message) => (
              <article key={message.id} className="company-apps-mini-row">
                <span className="company-apps-mini-row-title">
                  {message.subject || "No subject"}
                </span>
                <span className="company-apps-mini-row-subtitle">
                  {message.sender || message.recipient} · {formatInboxTime(message.received_at)}
                </span>
              </article>
            ))}
          </div>
        ) : (
          <div className="company-apps-empty-row">No inbound yet.</div>
        )}
      </section>
    </aside>
  );
}

export function WebsitesPrimitivePage({
  analytics,
  creatorOpen,
  domains,
  href,
  live,
  loading,
  onCreatorClose,
  onDomainAdded,
  primaryDomain,
  companyId,
}: {
  analytics?: WebsiteAnalytics;
  creatorOpen: boolean;
  domains: CompanyWebsiteDomain[];
  href: string;
  live: boolean;
  loading: boolean;
  onCreatorClose: () => void;
  onDomainAdded: () => void;
  primaryDomain: string;
  companyId: string;
}) {
  const [selectedDomain, setSelectedDomain] = useState(domains[0]?.domain ?? primaryDomain);

  useEffect(() => {
    if (!domains.length) return;
    if (!domains.some((domain) => domain.domain === selectedDomain)) {
      setSelectedDomain(domains[0].domain);
    }
  }, [domains, selectedDomain]);

  const selected = domains.find((domain) => domain.domain === selectedDomain) ?? domains[0];

  return (
    <div className="company-apps-register-layout" aria-label="Website management">
      <section className="company-apps-register-card" aria-labelledby="website-register-heading">
        <header className="company-apps-register-head">
          <div>
            <h2 id="website-register-heading" className="company-apps-register-title">
              Websites
            </h2>
            <p className="company-apps-register-subtitle">{primaryDomain}</p>
          </div>
          <StatusPill loading={loading} connected={live} label={live ? "Live" : "Private"} />
        </header>

        <div className="company-apps-table-head company-apps-table-head--website" aria-hidden>
          <span>Domain</span>
          <span>Kind</span>
          <span>Status</span>
        </div>
        <div className="company-apps-register-list">
          {domains.map((domain) => (
            <CardTrigger
              key={domain.domain}
              className="company-apps-register-row company-apps-register-row--website"
              data-selected={domain.domain === selected?.domain ? "true" : undefined}
              onClick={() => setSelectedDomain(domain.domain)}
            >
              <span className="company-apps-row-main">
                <span className="company-apps-row-title">{domain.domain}</span>
                <span className="company-apps-row-subtitle">
                  {domain.kind === "aeqi" ? "Default subdomain" : "External domain"}
                </span>
              </span>
              <span className="company-apps-row-cell">
                {domain.kind === "aeqi" ? "aeqi" : "External"}
              </span>
              <span className="company-apps-row-cell">{domain.status}</span>
            </CardTrigger>
          ))}
        </div>
      </section>

      <WebsiteDetail
        analytics={analytics}
        domain={selected}
        href={href}
        live={live}
        loading={loading}
      />

      <NewWebsiteModal
        onClose={onCreatorClose}
        onDomainAdded={onDomainAdded}
        open={creatorOpen}
        primaryDomain={primaryDomain}
        companyId={companyId}
      />
    </div>
  );
}

function WebsiteDetail({
  analytics,
  domain,
  href,
  live,
  loading,
}: {
  analytics?: WebsiteAnalytics;
  domain?: CompanyWebsiteDomain;
  href: string;
  live: boolean;
  loading: boolean;
}) {
  const tracking = analyticsTrackingLabel(analytics, loading, live);
  const views24h = analytics?.stats ? formatInteger(analytics.stats.last_24h.pageviews) : "-";
  const visitors7d = analytics?.stats ? formatInteger(analytics.stats.last_7d.visitors) : "-";
  const openHref = domain?.domain ? `https://${domain.domain}` : href;

  return (
    <aside className="company-apps-detail-panel" aria-label="Website detail">
      <header className="company-apps-detail-header">
        <span className="company-apps-detail-icon" aria-hidden>
          <Globe size={18} strokeWidth={1.5} />
        </span>
        <div>
          <h2 className="company-apps-detail-title">{domain?.domain ?? "Website"}</h2>
          <p className="company-apps-detail-subtitle">
            {domain?.kind === "external" ? "External domain" : "Default website"}
          </p>
        </div>
      </header>

      <div className="company-apps-detail-grid">
        <DetailField label="Visibility" value={live ? "Public" : "Private"} />
        <DetailField label="DNS" value={domain?.status ?? "Ready"} />
        <DetailField label="Tracking" value={tracking} />
        <DetailField label="Today" value={loading ? "Checking" : views24h} />
        <DetailField label="7d Visitors" value={loading ? "Checking" : visitors7d} />
        <DetailField label="SSL" value={domain?.ssl === false ? "Pending" : "Ready"} />
      </div>

      <div className="company-apps-detail-actions">
        <a className="company-apps-inline-action" href={openHref} target="_blank" rel="noreferrer">
          <ArrowUpRight size={14} strokeWidth={1.5} aria-hidden />
          Open Website
        </a>
      </div>
    </aside>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <span className="company-apps-detail-field">
      <span className="company-apps-detail-field-value">{value}</span>
      <span className="company-apps-detail-field-label">{label}</span>
    </span>
  );
}

function StatusPill({
  connected,
  label,
  loading,
}: {
  connected: boolean;
  label: string;
  loading: boolean;
}) {
  return (
    <span className="company-app-status-pill" data-status={connected ? "connected" : undefined}>
      {loading ? "Checking" : label}
    </span>
  );
}

function analyticsTrackingLabel(
  analytics: WebsiteAnalytics | undefined,
  loading: boolean,
  live: boolean,
): string {
  if (loading) return "Checking";
  if (analytics?.tracking_status === "installed") return "Installed";
  if (live) return "Ready";
  return "Setup";
}

function formatInboxTime(value: string): string {
  return formatDateTime(value, { fallback: "Received" });
}

export function normalizeEmailIdentities(
  identities: CompanyEmailIdentitySummary[] | undefined,
  fallbackEmail: string,
): CompanyEmailIdentitySummary[] {
  if (identities?.length) return identities;
  const [localPart = "hello", domain = "aeqi.ai"] = fallbackEmail.split("@");
  return [
    {
      kind: "company",
      label: "Company",
      local_part: localPart,
      address: `${localPart}@${domain}`,
    },
  ];
}

export function normalizeWebsiteDomains(
  primaryDomain: string,
  domains: HostingDomainSummary[] | undefined,
  companyId: string,
): CompanyWebsiteDomain[] {
  const external = (domains ?? [])
    .filter((item) => item.root === companyId)
    .filter((item) => item.domain && item.domain !== primaryDomain);
  return [
    { domain: primaryDomain, kind: "aeqi", status: "Default", ssl: true },
    ...external.map((item) => ({
      domain: item.domain,
      kind: "external" as const,
      status: item.ssl === false ? "DNS pending" : "Attached",
      ssl: item.ssl,
      created_at: item.created_at,
    })),
  ];
}
