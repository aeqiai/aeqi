import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { indexerEnabled } from "@/lib/indexer";
import { COMPANY_MONTHLY, formatCents, RESOURCE_PACK } from "@/lib/pricing";
import { useTreasury, type TreasuryTransfer, type TokenBalance } from "@/hooks/useTreasury";
import { useDaemonStore } from "@/store/daemon";

// ── Constants ─────────────────────────────────────────────────────────────────

const BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org/address";

interface TreasuryPageProps {
  entityId: string;
}

interface CompanyBillingRow {
  name: string;
  agent_id: string | null;
  plan: "company";
  stripe_subscription_id: string | null;
  status: "active" | "trialing" | "past_due" | "canceled";
  next_charge_at: string | null;
}

const STATUS_VARIANT: Record<
  CompanyBillingRow["status"],
  "success" | "info" | "warning" | "muted"
> = {
  active: "success",
  trialing: "info",
  past_due: "warning",
  canceled: "muted",
};

const STATUS_LABEL: Record<CompanyBillingRow["status"], string> = {
  active: "Active",
  trialing: "Trial",
  past_due: "Past due",
  canceled: "Canceled",
};

/**
 * Treasury tab for a Company entity.
 *
 * Sections (top → bottom):
 *   1. Contract info row — trust address linking to block explorer.
 *   2. Holdings — token balances from the indexed TRUST.
 *   3. Recent transfers — last 20 transfers (graceful-degrade until indexer extends).
 *   4. Subscription card — Stripe billing state.
 *   5. Resource pack — plan limits.
 */
export default function TreasuryPage({ entityId }: TreasuryPageProps) {
  const entity = useDaemonStore((s) => s.entities.find((e) => e.id === entityId));
  const trustAddress = entity?.trust_address;
  const isPersonal = entity?.type === "human";
  const entityTerm = isPersonal ? "account" : "Company";

  const [billing, setBilling] = useState<CompanyBillingRow | null | undefined>(undefined);
  const [paymentLast4, setPaymentLast4] = useState<string | null>(null);
  const [billingError, setBillingError] = useState<string | null>(null);
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBilling(undefined);
    setBillingError(null);
    (async () => {
      try {
        const overview = await api.getBillingOverview();
        if (cancelled) return;
        const row = overview.companies.find((c) => c.agent_id === entityId) ?? null;
        setBilling(row);
        setPaymentLast4(overview.payment_method_last4);
      } catch (err) {
        if (!cancelled) {
          setBillingError(err instanceof Error ? err.message : String(err));
          setBilling(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const openPortal = async () => {
    setPortalBusy(true);
    try {
      const { url } = await api.openBillingPortal();
      window.location.href = url;
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : String(err));
      setPortalBusy(false);
    }
  };

  if (billing === undefined) {
    return (
      <div
        className="asv-main"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-xl)",
        }}
      >
        <Spinner />
      </div>
    );
  }

  return (
    <div className="asv-main" style={{ padding: "var(--space-lg)" }}>
      <header style={{ marginBottom: "var(--space-lg)" }}>
        <h2 style={{ margin: 0 }}>Treasury</h2>
        <p style={{ color: "var(--color-text-muted)", margin: "var(--space-xs) 0 0 0" }}>
          Subscription, resources, and on-chain balances for this {entityTerm}.
        </p>
      </header>

      {trustAddress && indexerEnabled() && <ContractInfoRow trustAddress={trustAddress} />}

      {indexerEnabled() && trustAddress && <OnChainHoldings trustAddress={trustAddress} />}

      {billingError && (
        <div
          style={{
            padding: "var(--space-sm) var(--space-md)",
            background: "var(--color-card)",
            borderRadius: "var(--radius-md)",
            marginBottom: "var(--space-md)",
            color: "var(--color-text-muted)",
            fontSize: "var(--text-sm)",
          }}
        >
          Couldn't load billing: {billingError}
        </div>
      )}

      {!billing && !billingError && (
        <EmptyState
          title={`No subscription on this ${entityTerm}`}
          description={
            isPersonal
              ? "This account isn't billed through Stripe yet. Personal accounts are exempt."
              : "This Company isn't billed through Stripe yet. Personal Companies on the founder account are exempt; joint Companies bill the creator."
          }
        />
      )}

      {billing && (
        <BillingCard
          billing={billing}
          paymentLast4={paymentLast4}
          onManage={openPortal}
          portalBusy={portalBusy}
        />
      )}

      <ResourcePack />
    </div>
  );
}

// ── Contract info row ─────────────────────────────────────────────────────────

function ContractInfoRow({ trustAddress }: { trustAddress: string }) {
  const short = `${trustAddress.slice(0, 6)}…${trustAddress.slice(-4)}`;
  const explorerUrl = `${BASE_SEPOLIA_EXPLORER}/${trustAddress}`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-sm)",
        padding: "var(--space-xs) var(--space-md)",
        background: "var(--color-card)",
        borderRadius: "var(--radius-md)",
        marginBottom: "var(--space-md)",
        fontSize: "var(--text-sm)",
        color: "var(--color-text-muted)",
      }}
    >
      <span>Treasury contract</span>
      <code
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--color-text)",
          fontSize: "var(--text-xs)",
        }}
      >
        {short}
      </code>
      <a
        href={explorerUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          color: "var(--color-text-muted)",
          fontSize: "var(--text-xs)",
          textDecoration: "underline",
          textUnderlineOffset: "2px",
        }}
      >
        Base Sepolia
      </a>
    </div>
  );
}

// ── On-chain holdings + transfers ─────────────────────────────────────────────

function OnChainHoldings({ trustAddress }: { trustAddress: string }) {
  const { balances, transfers, loading } = useTreasury(trustAddress);

  return (
    <>
      <HoldingsSection balances={balances} loading={loading} />
      <TransfersSection transfers={transfers} loading={loading} />
    </>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: "0 0 var(--space-sm) 0",
        fontSize: "var(--text-sm)",
        color: "var(--color-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.04em",
      }}
    >
      {children}
    </h3>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow({ widths }: { widths: string[] }) {
  return (
    <div
      style={{
        display: "flex",
        gap: "var(--space-md)",
        padding: "var(--space-sm) var(--space-md)",
        alignItems: "center",
      }}
    >
      {widths.map((w, i) => (
        <div
          key={i}
          style={{
            height: "var(--space-md)",
            width: w,
            background: "var(--color-card)",
            borderRadius: "var(--radius-sm)",
            opacity: 0.6,
          }}
        />
      ))}
    </div>
  );
}

// ── Holdings section ──────────────────────────────────────────────────────────

function HoldingsSection({
  balances,
  loading,
}: {
  balances: TokenBalance[] | null;
  loading: boolean;
}) {
  return (
    <section style={{ marginBottom: "var(--space-lg)" }}>
      <SectionLabel>Holdings</SectionLabel>

      <div
        style={{
          background: "var(--color-card)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <>
            <SkeletonRow widths={["60px", "120px", "80px"]} />
            <SkeletonRow widths={["60px", "120px", "80px"]} />
          </>
        ) : !balances || balances.length === 0 ? (
          <div
            style={{
              padding: "var(--space-lg) var(--space-md)",
              color: "var(--color-text-muted)",
              fontSize: "var(--text-sm)",
              textAlign: "center",
            }}
          >
            No treasury activity yet.{" "}
            <span style={{ display: "block", marginTop: "var(--space-xs)" }}>
              Token balances appear here once the TRUST holds assets.
            </span>
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "var(--text-sm)",
            }}
          >
            <thead>
              <tr style={{ color: "var(--color-text-muted)" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "var(--space-xs) var(--space-md)",
                    fontWeight: 500,
                  }}
                >
                  Token
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "var(--space-xs) var(--space-md)",
                    fontWeight: 500,
                  }}
                >
                  Amount
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "var(--space-xs) var(--space-md)",
                    fontWeight: 500,
                  }}
                >
                  Holder
                </th>
              </tr>
            </thead>
            <tbody>
              {balances.map((b, i) => (
                <tr
                  key={i}
                  style={{
                    background: i % 2 === 1 ? "var(--bg-subtle)" : undefined,
                  }}
                >
                  <td style={{ padding: "var(--space-xs) var(--space-md)", fontWeight: 500 }}>
                    {b.symbol}
                  </td>
                  <td
                    style={{
                      padding: "var(--space-xs) var(--space-md)",
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-xs)",
                    }}
                  >
                    {b.amount}
                  </td>
                  <td
                    style={{
                      padding: "var(--space-xs) var(--space-md)",
                      color: "var(--color-text-muted)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-xs)",
                    }}
                  >
                    {truncateAddress(b.holderAddress)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ── Transfers section ─────────────────────────────────────────────────────────

function TransfersSection({
  transfers,
  loading,
}: {
  transfers: TreasuryTransfer[] | null;
  loading: boolean;
}) {
  return (
    <section style={{ marginBottom: "var(--space-lg)" }}>
      <SectionLabel>Recent transfers</SectionLabel>

      <div
        style={{
          background: "var(--color-card)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
        }}
      >
        {loading ? (
          <>
            <SkeletonRow widths={["48px", "120px", "80px", "60px"]} />
            <SkeletonRow widths={["48px", "120px", "80px", "60px"]} />
            <SkeletonRow widths={["48px", "120px", "80px", "60px"]} />
          </>
        ) : !transfers || transfers.length === 0 ? (
          <div
            style={{
              padding: "var(--space-lg) var(--space-md)",
              color: "var(--color-text-muted)",
              fontSize: "var(--text-sm)",
              textAlign: "center",
            }}
          >
            No treasury activity yet.{" "}
            <span style={{ display: "block", marginTop: "var(--space-xs)" }}>
              Transfers in and out of this TRUST will appear here.
            </span>
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "var(--text-sm)",
            }}
          >
            <thead>
              <tr style={{ color: "var(--color-text-muted)" }}>
                <th
                  style={{
                    textAlign: "left",
                    padding: "var(--space-xs) var(--space-md)",
                    fontWeight: 500,
                  }}
                >
                  Direction
                </th>
                <th
                  style={{
                    textAlign: "left",
                    padding: "var(--space-xs) var(--space-md)",
                    fontWeight: 500,
                  }}
                >
                  Counterparty
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "var(--space-xs) var(--space-md)",
                    fontWeight: 500,
                  }}
                >
                  Amount
                </th>
                <th
                  style={{
                    textAlign: "right",
                    padding: "var(--space-xs) var(--space-md)",
                    fontWeight: 500,
                  }}
                >
                  Block
                </th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((t, i) => (
                <tr
                  key={i}
                  style={{
                    background: i % 2 === 1 ? "var(--bg-subtle)" : undefined,
                  }}
                >
                  <td style={{ padding: "var(--space-xs) var(--space-md)" }}>
                    <Badge variant={t.direction === "in" ? "success" : "muted"} size="sm">
                      {t.direction === "in" ? "In" : "Out"}
                    </Badge>
                  </td>
                  <td
                    style={{
                      padding: "var(--space-xs) var(--space-md)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-xs)",
                      color: "var(--color-text-muted)",
                    }}
                  >
                    {truncateAddress(t.counterparty)}
                  </td>
                  <td
                    style={{
                      padding: "var(--space-xs) var(--space-md)",
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-xs)",
                    }}
                  >
                    {t.amount}
                  </td>
                  <td
                    style={{
                      padding: "var(--space-xs) var(--space-md)",
                      textAlign: "right",
                      color: "var(--color-text-muted)",
                      fontSize: "var(--text-xs)",
                    }}
                  >
                    {t.block.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ── Billing card ──────────────────────────────────────────────────────────────

interface BillingCardProps {
  billing: CompanyBillingRow;
  paymentLast4: string | null;
  onManage: () => void;
  portalBusy: boolean;
}

function BillingCard({ billing, paymentLast4, onManage, portalBusy }: BillingCardProps) {
  const nextCharge = billing.next_charge_at
    ? new Date(billing.next_charge_at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      })
    : "—";

  return (
    <section
      style={{
        background: "var(--color-card)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-md)",
        marginBottom: "var(--space-lg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-md)",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
            <span style={{ fontWeight: 500 }}>Company subscription</span>
            <Badge variant={STATUS_VARIANT[billing.status]} size="sm">
              {STATUS_LABEL[billing.status]}
            </Badge>
          </div>
          <div
            style={{
              color: "var(--color-text-muted)",
              fontSize: "var(--text-sm)",
              marginTop: "var(--space-xs)",
            }}
          >
            {formatCents(COMPANY_MONTHLY * 100)} / month
            {billing.status === "active" && billing.next_charge_at
              ? ` · next charge ${nextCharge}`
              : ""}
            {paymentLast4 ? ` · card ending ${paymentLast4}` : ""}
          </div>
        </div>
        <Button onClick={onManage} variant="secondary" disabled={portalBusy}>
          {portalBusy ? "Opening…" : "Manage billing"}
        </Button>
      </div>
    </section>
  );
}

// ── Resource pack ─────────────────────────────────────────────────────────────

function ResourcePack() {
  const items = [
    { label: "Inference / month", value: RESOURCE_PACK.inferenceUsd },
    { label: "Compute", value: RESOURCE_PACK.cpu },
    { label: "Memory", value: RESOURCE_PACK.ram },
    { label: "Storage", value: RESOURCE_PACK.storage },
  ];

  return (
    <section style={{ marginBottom: "var(--space-lg)" }}>
      <SectionLabel>Resource pack</SectionLabel>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
          gap: "var(--space-sm)",
        }}
      >
        {items.map((it) => (
          <div
            key={it.label}
            style={{
              background: "var(--color-card)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-md)",
            }}
          >
            <div style={{ color: "var(--color-text-muted)", fontSize: "var(--text-sm)" }}>
              {it.label}
            </div>
            <div style={{ fontWeight: 500, marginTop: "var(--space-xs)" }}>{it.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
