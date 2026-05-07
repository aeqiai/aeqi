import { useEffect, useState } from "react";
import { useBalance } from "wagmi";
import { anvil } from "wagmi/chains";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Spinner } from "@/components/ui/Spinner";
import { api } from "@/lib/api";
import { indexerEnabled } from "@/lib/indexer";
import { COMPANY_MONTHLY, formatCents, RESOURCE_PACK } from "@/lib/pricing";
import { useTreasury, type TreasuryTransfer, type TokenBalance } from "@/hooks/useTreasury";
import { useDaemonStore } from "@/store/daemon";
import type { InferenceCallRow } from "@/lib/types";
import { formatSpendUsd } from "@/lib/spend";

// ── Chain config ──────────────────────────────────────────────────────────────

// VITE_CHAIN_NAME / VITE_CHAIN_EXPLORER let the operator configure the active
// network without a code change. Defaults match the local anvil dev environment.
// For Base Sepolia: VITE_CHAIN_NAME="Base Sepolia" VITE_CHAIN_EXPLORER="https://sepolia.basescan.org/address"
// For Base Mainnet: VITE_CHAIN_NAME="Base" VITE_CHAIN_EXPLORER="https://basescan.org/address"
const CHAIN_NAME = (import.meta.env.VITE_CHAIN_NAME as string | undefined) || "anvil";
const CHAIN_EXPLORER = (import.meta.env.VITE_CHAIN_EXPLORER as string | undefined) || "";

interface TreasuryPageProps {
  entityId: string;
  /**
   * When set, the page renders an "Inference" zone at the top: a
   * Lifetime Spend stat card + a recent-calls table sourced from
   * `inference_calls`. Drives the per-agent Treasury tab. Omitted on
   * Company / Personal Treasury.
   */
  agentId?: string;
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
export default function TreasuryPage({ entityId, agentId }: TreasuryPageProps) {
  const entity = useDaemonStore((s) => s.entities.find((e) => e.id === entityId));
  const trustAddress = entity?.trust_address;
  const trustId = entity?.trust_id;

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
          {agentId
            ? "Lifetime inference spend and recent calls for this agent."
            : "Subscription, resources, and on-chain balances for this Company."}
        </p>
      </header>

      {agentId && <InferenceZone agentId={agentId} />}

      {trustAddress && indexerEnabled() && <ContractInfoRow trustAddress={trustAddress} />}

      {(indexerEnabled() || trustAddress) && (
        <OnChainHoldings trustAddress={trustAddress} trustId={trustId} />
      )}

      {billingError && (
        <div
          style={{
            padding: "var(--space-sm) var(--space-md)",
            background: "var(--color-card)",
            borderRadius: "var(--radius-md)",
            marginBottom: "var(--space-md)",
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-sm)",
          }}
        >
          Couldn't load billing: {billingError}
        </div>
      )}

      {!billing && !billingError && (
        <EmptyState
          title="No active plan"
          description="Add a plan to this Company to unlock inference and on-chain features."
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
  const explorerUrl = CHAIN_EXPLORER ? `${CHAIN_EXPLORER}/${trustAddress}` : null;

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
        fontSize: "var(--font-size-sm)",
        color: "var(--color-text-muted)",
      }}
    >
      <span>Treasury contract</span>
      <code
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--color-text)",
          fontSize: "var(--font-size-xs)",
        }}
      >
        {short}
      </code>
      {explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--color-text-muted)",
            fontSize: "var(--font-size-xs)",
            textDecoration: "underline",
            textUnderlineOffset: "2px",
          }}
        >
          {CHAIN_NAME}
        </a>
      ) : (
        <span style={{ fontSize: "var(--font-size-xs)" }}>{CHAIN_NAME}</span>
      )}
    </div>
  );
}

// ── On-chain holdings + transfers ─────────────────────────────────────────────

function OnChainHoldings({ trustAddress, trustId }: { trustAddress?: string; trustId?: string }) {
  const { balances, transfers, loading } = useTreasury(trustId);

  // Native ETH balance — read directly from RPC via wagmi.
  // Uses anvil chain (ID 31337) with the /chain/rpc proxy transport.
  const { data: ethBalance } = useBalance({
    address: trustAddress as `0x${string}` | undefined,
    chainId: anvil.id,
    query: { enabled: Boolean(trustAddress) },
  });

  return (
    <>
      <HoldingsSection
        balances={balances}
        loading={loading}
        trustAddress={trustAddress}
        nativeEth={ethBalance?.formatted}
      />
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
        fontSize: "var(--font-size-sm)",
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
  trustAddress,
  nativeEth,
}: {
  balances: TokenBalance[] | null;
  loading: boolean;
  trustAddress?: string;
  nativeEth?: string;
}) {
  const hasEth = nativeEth !== undefined && nativeEth !== "0";
  const hasErc20 = balances && balances.length > 0;
  const hasAny = hasEth || hasErc20;

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
        {loading && !nativeEth ? (
          <>
            <SkeletonRow widths={["60px", "120px", "80px"]} />
            <SkeletonRow widths={["60px", "120px", "80px"]} />
          </>
        ) : !hasAny ? (
          <div
            style={{
              padding: "var(--space-lg) var(--space-md)",
              textAlign: "center",
            }}
          >
            <div
              style={{
                fontWeight: 500,
                fontSize: "var(--font-size-base)",
                marginBottom: "var(--space-xs)",
              }}
            >
              0 ETH · 0 USDC
            </div>
            <div
              style={{
                color: "var(--color-text-muted)",
                fontSize: "var(--font-size-sm)",
              }}
            >
              Nothing here yet — fund this Treasury to get started.
            </div>
            {trustAddress && (
              <div
                style={{
                  marginTop: "var(--space-md)",
                  color: "var(--color-text-muted)",
                  fontSize: "var(--font-size-xs)",
                }}
              >
                Send ETH or USDC to{" "}
                <code style={{ fontFamily: "var(--font-mono)" }}>
                  {`${trustAddress.slice(0, 6)}…${trustAddress.slice(-4)}`}
                </code>{" "}
                to fund this Treasury.
              </div>
            )}
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "var(--font-size-sm)",
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
                  Contract
                </th>
              </tr>
            </thead>
            <tbody>
              {/* Native ETH row — sourced from RPC, not the indexer */}
              {nativeEth && (
                <tr>
                  <td style={{ padding: "var(--space-xs) var(--space-md)", fontWeight: 500 }}>
                    ETH
                  </td>
                  <td
                    style={{
                      padding: "var(--space-xs) var(--space-md)",
                      textAlign: "right",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--font-size-xs)",
                    }}
                  >
                    {Number(nativeEth).toFixed(4)}
                  </td>
                  <td
                    style={{
                      padding: "var(--space-xs) var(--space-md)",
                      color: "var(--color-text-muted)",
                      fontSize: "var(--font-size-xs)",
                    }}
                  >
                    native
                  </td>
                </tr>
              )}
              {/* ERC-20 rows — sourced from indexer treasuryBalances */}
              {(balances ?? []).map((b, i) => (
                <tr
                  key={i}
                  style={{
                    background:
                      (i + (nativeEth ? 1 : 0)) % 2 === 1 ? "var(--bg-subtle)" : undefined,
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
                      fontSize: "var(--font-size-xs)",
                    }}
                  >
                    {b.amount}
                  </td>
                  <td
                    style={{
                      padding: "var(--space-xs) var(--space-md)",
                      color: "var(--color-text-muted)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--font-size-xs)",
                    }}
                  >
                    {truncateAddress(b.tokenAddress)}
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
              fontSize: "var(--font-size-sm)",
              textAlign: "center",
            }}
          >
            No transfers yet.
          </div>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "var(--font-size-sm)",
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
                      fontSize: "var(--font-size-xs)",
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
                      fontSize: "var(--font-size-xs)",
                    }}
                  >
                    {t.amount}
                  </td>
                  <td
                    style={{
                      padding: "var(--space-xs) var(--space-md)",
                      textAlign: "right",
                      color: "var(--color-text-muted)",
                      fontSize: "var(--font-size-xs)",
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
              fontSize: "var(--font-size-sm)",
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
            <div style={{ color: "var(--color-text-muted)", fontSize: "var(--font-size-sm)" }}>
              {it.label}
            </div>
            <div style={{ fontWeight: 500, marginTop: "var(--space-xs)" }}>{it.value}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Inference zone (per-agent) ────────────────────────────────────────────────

/**
 * Per-agent inference accounting block: a Lifetime Spend stat sourced
 * from `agent.lifetime_cost_usd` (denormalized rollup) plus the last 30
 * `inference_calls` rows in a tabular ledger. Lazy-loads more on demand.
 *
 * The lifetime number is read from the daemon store rather than computed
 * client-side from the calls list — the runtime maintains the rollup
 * atomically alongside the audit-row INSERT, so it's the source of truth
 * even for agents whose call history exceeds the visible window.
 */
function InferenceZone({ agentId }: { agentId: string }) {
  const agent = useDaemonStore((s) => s.agents.find((a) => a.id === agentId));
  const [calls, setCalls] = useState<InferenceCallRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(30);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCalls(null);
    setError(null);
    api
      .getAgentRecentInferenceCalls(agentId, limit)
      .then((resp) => {
        if (cancelled) return;
        if (resp.ok && resp.calls) setCalls(resp.calls);
        else setError(resp.error || "Could not load inference history.");
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || "Could not load inference history.");
      })
      .finally(() => {
        if (!cancelled) setLoadingMore(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, limit]);

  const lifetime = agent?.lifetime_cost_usd ?? 0;
  const totalTokens = agent?.total_tokens ?? 0;

  return (
    <section style={{ marginBottom: "var(--space-lg)" }}>
      <SectionLabel>Inference</SectionLabel>

      {/* Lifetime stat card */}
      <div
        style={{
          background: "var(--color-card)",
          borderRadius: "var(--radius-md)",
          padding: "var(--space-md)",
          marginBottom: "var(--space-md)",
          display: "flex",
          alignItems: "baseline",
          gap: "var(--space-md)",
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
              marginBottom: "var(--space-xs)",
            }}
          >
            Lifetime spend
          </div>
          <div
            style={{
              fontSize: "var(--font-size-2xl, 24px)",
              fontWeight: 600,
              fontFamily: "var(--font-mono)",
            }}
          >
            {formatSpendUsd(lifetime)}
          </div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div
            style={{
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
              marginBottom: "var(--space-xs)",
            }}
          >
            Tokens
          </div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "var(--font-size-base)",
            }}
          >
            {totalTokens.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Recent calls table */}
      <div
        style={{
          background: "var(--color-card)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
        }}
      >
        {error ? (
          <div
            style={{
              padding: "var(--space-lg) var(--space-md)",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
              textAlign: "center",
            }}
          >
            {error}
          </div>
        ) : calls === null ? (
          <>
            <SkeletonRow widths={["80px", "60px", "60px", "60px", "70px"]} />
            <SkeletonRow widths={["80px", "60px", "60px", "60px", "70px"]} />
            <SkeletonRow widths={["80px", "60px", "60px", "60px", "70px"]} />
          </>
        ) : calls.length === 0 ? (
          <div
            style={{
              padding: "var(--space-lg) var(--space-md)",
              color: "var(--color-text-muted)",
              fontSize: "var(--font-size-sm)",
              textAlign: "center",
            }}
          >
            No inference calls yet.
          </div>
        ) : (
          <>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: "var(--font-size-sm)",
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
                    Model
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "var(--space-xs) var(--space-md)",
                      fontWeight: 500,
                    }}
                  >
                    Tokens (in / out)
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "var(--space-xs) var(--space-md)",
                      fontWeight: 500,
                    }}
                  >
                    Cost
                  </th>
                  <th
                    style={{
                      textAlign: "left",
                      padding: "var(--space-xs) var(--space-md)",
                      fontWeight: 500,
                    }}
                  >
                    Stop
                  </th>
                  <th
                    style={{
                      textAlign: "right",
                      padding: "var(--space-xs) var(--space-md)",
                      fontWeight: 500,
                    }}
                  >
                    When
                  </th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c, i) => (
                  <tr
                    key={c.id}
                    style={{
                      background: i % 2 === 1 ? "var(--bg-subtle)" : undefined,
                    }}
                  >
                    <td style={{ padding: "var(--space-xs) var(--space-md)", fontWeight: 500 }}>
                      {c.model}
                    </td>
                    <td
                      style={{
                        padding: "var(--space-xs) var(--space-md)",
                        textAlign: "right",
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--font-size-xs)",
                      }}
                    >
                      {c.prompt_tokens.toLocaleString()} / {c.completion_tokens.toLocaleString()}
                    </td>
                    <td
                      style={{
                        padding: "var(--space-xs) var(--space-md)",
                        textAlign: "right",
                        fontFamily: "var(--font-mono)",
                        fontSize: "var(--font-size-xs)",
                      }}
                    >
                      {formatSpendUsd(c.cost_usd)}
                    </td>
                    <td
                      style={{
                        padding: "var(--space-xs) var(--space-md)",
                        color: "var(--color-text-muted)",
                        fontSize: "var(--font-size-xs)",
                      }}
                    >
                      {formatStopReason(c.stop_reason)}
                    </td>
                    <td
                      style={{
                        padding: "var(--space-xs) var(--space-md)",
                        textAlign: "right",
                        color: "var(--color-text-muted)",
                        fontSize: "var(--font-size-xs)",
                      }}
                    >
                      {formatRelativeTime(c.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {calls.length === limit && limit < 500 && (
              <div
                style={{
                  padding: "var(--space-sm) var(--space-md)",
                  textAlign: "center",
                  borderTop: "0",
                }}
              >
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => {
                    setLoadingMore(true);
                    setLimit((l) => Math.min(l + 30, 500));
                  }}
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function formatStopReason(raw: string | null): string {
  if (!raw) return "—";
  // Rust emits `format!("{:?}", result.stop_reason)` — strip enum-debug
  // wrapping like `Some("end_turn")` → `end_turn`.
  const m = raw.match(/^Some\("?([^")]+)"?\)$/);
  if (m) return m[1];
  return raw;
}

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d`;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
