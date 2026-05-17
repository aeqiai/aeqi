import { useEffect, useState } from "react";
import { useBalance } from "wagmi";
import { anvil } from "wagmi/chains";

import BudgetsBlock from "@/components/BudgetsBlock";
import {
  Badge,
  Button,
  EmptyState,
  MetricCard,
  MetricGrid,
  Page,
  PageBody,
  PageHeader,
  PageSection,
  Spinner,
  Table,
  type TableColumn,
} from "@/components/ui";
import { api } from "@/lib/api";
import { indexerEnabled } from "@/lib/indexer";
import { formatInteger, formatMediumDate, formatShortDate } from "@/lib/i18n";
import { goExternal } from "@/lib/navigation";
import { formatCents, launchPlanById, launchPlanResourceItems } from "@/lib/pricing";
import { useRelativeNow } from "@/hooks/useRelativeNow";
import { useTreasury, type TreasuryTransfer, type TokenBalance } from "@/hooks/useTreasury";
import { useDaemonStore } from "@/store/daemon";
import type { InferenceCallRow } from "@/lib/types";
import { formatSpendUsd } from "@/lib/spend";
import styles from "./TreasuryPage.module.css";

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
  plan: string | null;
  stripe_subscription_id: string | null;
  status: "active" | "trialing" | "past_due" | "canceled";
  next_charge_at: string | null;
}

interface HoldingRow {
  id: string;
  token: string;
  amount: string;
  contract: string;
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
  trialing: "Intro",
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
      goExternal(url);
    } catch (err) {
      setBillingError(err instanceof Error ? err.message : String(err));
      setPortalBusy(false);
    }
  };

  if (billing === undefined) {
    return (
      <Page className={`asv-main ${styles.loadingPage}`} width="full" padding="lg">
        <Spinner />
      </Page>
    );
  }

  return (
    <Page className="asv-main" width="full" padding="md" gap="6">
      <PageHeader
        title="Treasury"
        description={
          agentId
            ? "Lifetime inference spend and recent calls for this agent."
            : "Subscription, resources, and on-chain balances for this Company."
        }
      />

      <PageBody gap="6">
        {agentId && <InferenceZone agentId={agentId} />}

        {trustAddress && indexerEnabled() && <ContractInfoRow trustAddress={trustAddress} />}

        {(indexerEnabled() || trustAddress) && (
          <OnChainHoldings trustAddress={trustAddress} trustId={trustId} />
        )}

        {!agentId && trustId && <BudgetsBlock trustId={trustId} />}

        {billingError && (
          <div className={styles.billingError}>Couldn't load billing: {billingError}</div>
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

        <ResourcePack planId={billing?.plan} />
      </PageBody>
    </Page>
  );
}

// ── Contract info row ─────────────────────────────────────────────────────────

function ContractInfoRow({ trustAddress }: { trustAddress: string }) {
  const short = `${trustAddress.slice(0, 6)}…${trustAddress.slice(-4)}`;
  const explorerUrl = CHAIN_EXPLORER ? `${CHAIN_EXPLORER}/${trustAddress}` : null;

  return (
    <div className={styles.contractRow}>
      <span>Treasury contract</span>
      <code className={styles.contractCode}>{short}</code>
      {explorerUrl ? (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.chainLink}
        >
          {CHAIN_NAME}
        </a>
      ) : (
        <span className={styles.chainName}>{CHAIN_NAME}</span>
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
  const holdingRows: HoldingRow[] = [
    ...(nativeEth
      ? [
          {
            id: "native-eth",
            token: "ETH",
            amount: Number(nativeEth).toFixed(4),
            contract: "native",
          },
        ]
      : []),
    ...(balances ?? []).map((balance, index) => ({
      id: `${balance.tokenAddress}-${index}`,
      token: balance.symbol,
      amount: balance.amount,
      contract: truncateAddress(balance.tokenAddress),
    })),
  ];

  const columns: Array<TableColumn<HoldingRow>> = [
    {
      key: "token",
      header: "Token",
      width: "28%",
      cell: (row) => <span className={styles.cellStrong}>{row.token}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      width: "32%",
      align: "end",
      cell: (row) => <span className={styles.cellMono}>{row.amount}</span>,
    },
    {
      key: "contract",
      header: "Contract",
      width: "40%",
      cell: (row) => (
        <span className={row.contract === "native" ? styles.cellMuted : styles.cellMutedMono}>
          {row.contract}
        </span>
      ),
    },
  ];

  return (
    <PageSection title="Holdings">
      <div className={styles.tableSurface}>
        <Table
          columns={columns}
          data={holdingRows}
          rowKey={(row) => row.id}
          density="compact"
          ariaLabel="Treasury holdings"
          loading={loading && !nativeEth}
          skeletonRows={2}
          empty={
            <div className={styles.emptyPanel}>
              <div className={styles.emptyTitle}>0 ETH · 0 USDC</div>
              <div className={styles.emptyText}>
                Nothing here yet — fund this Treasury to get started.
              </div>
              {trustAddress && (
                <div className={styles.emptyHint}>
                  Send ETH or USDC to{" "}
                  <code
                    className={styles.inlineCode}
                  >{`${trustAddress.slice(0, 6)}…${trustAddress.slice(-4)}`}</code>{" "}
                  to fund this Treasury.
                </div>
              )}
            </div>
          }
        />
      </div>
    </PageSection>
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
  // Tick the relative-time column once a minute so "5s ago" advances.
  useRelativeNow();

  const columns: Array<TableColumn<TreasuryTransfer>> = [
    {
      key: "direction",
      header: "Direction",
      width: "18%",
      cell: (row) => (
        <Badge variant={row.direction === "in" ? "success" : "muted"} size="sm">
          {row.direction === "in" ? "In" : "Out"}
        </Badge>
      ),
    },
    {
      key: "counterparty",
      header: "Counterparty",
      width: "38%",
      cell: (row) => (
        <span className={styles.cellMutedMono}>{truncateAddress(row.counterparty)}</span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      width: "24%",
      align: "end",
      cell: (row) => <span className={styles.cellMono}>{row.amount}</span>,
    },
    {
      key: "block",
      header: "Block",
      width: "20%",
      align: "end",
      cell: (row) => <span className={styles.cellMuted}>{formatInteger(row.block)}</span>,
    },
  ];

  return (
    <PageSection title="Recent transfers">
      <div className={styles.tableSurface}>
        <Table
          columns={columns}
          data={transfers ?? []}
          rowKey={(row, index) => `${row.block}-${row.counterparty}-${index}`}
          density="compact"
          ariaLabel="Recent treasury transfers"
          loading={loading}
          skeletonRows={3}
          empty={<div className={styles.emptyPanelCompact}>No transfers yet.</div>}
        />
      </div>
    </PageSection>
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
  const plan = launchPlanById(billing.plan);
  const nextCharge = billing.next_charge_at ? formatMediumDate(billing.next_charge_at) : "—";

  return (
    <PageSection className={styles.billingCard}>
      <div className={styles.billingContent}>
        <div>
          <div className={styles.billingTitleRow}>
            <span className={styles.billingTitle}>Company subscription</span>
            <Badge variant={STATUS_VARIANT[billing.status]} size="sm">
              {STATUS_LABEL[billing.status]}
            </Badge>
            <Badge variant={plan.id === "growth" ? "accent" : "neutral"} size="sm">
              {plan.name}
            </Badge>
          </div>
          <div className={styles.billingDetail}>
            {billing.status === "trialing"
              ? `${plan.dueToday} first month, then ${formatCents(plan.monthlyCents)} / month`
              : `${formatCents(plan.monthlyCents)} / month`}
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
    </PageSection>
  );
}

// ── Resource pack ─────────────────────────────────────────────────────────────

function ResourcePack({ planId }: { planId?: string | null }) {
  const items = launchPlanResourceItems(planId);

  return (
    <PageSection title="Resource pack">
      <MetricGrid>
        {items.map((it) => (
          <MetricCard key={it.label} label={it.label} value={it.value} />
        ))}
      </MetricGrid>
    </PageSection>
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
  const columns: Array<TableColumn<InferenceCallRow>> = [
    {
      key: "model",
      header: "Model",
      width: "30%",
      cell: (row) => <span className={styles.cellStrong}>{row.model}</span>,
    },
    {
      key: "tokens",
      header: "Tokens (in / out)",
      width: "24%",
      align: "end",
      cell: (row) => (
        <span className={styles.cellMono}>
          {formatInteger(row.prompt_tokens)} / {formatInteger(row.completion_tokens)}
        </span>
      ),
    },
    {
      key: "cost",
      header: "Cost",
      width: "16%",
      align: "end",
      cell: (row) => <span className={styles.cellMono}>{formatSpendUsd(row.cost_usd)}</span>,
    },
    {
      key: "stop",
      header: "Stop",
      width: "14%",
      cell: (row) => <span className={styles.cellMuted}>{formatStopReason(row.stop_reason)}</span>,
    },
    {
      key: "when",
      header: "When",
      width: "16%",
      align: "end",
      cell: (row) => <span className={styles.cellMuted}>{formatRelativeTime(row.created_at)}</span>,
    },
  ];

  return (
    <PageSection title="Inference">
      <MetricGrid columns={2}>
        <MetricCard
          label="Lifetime spend"
          value={<span className={styles.metricMonoValue}>{formatSpendUsd(lifetime)}</span>}
        />
        <MetricCard
          label="Tokens"
          value={
            <span className={styles.metricMonoValueCompact}>{formatInteger(totalTokens)}</span>
          }
        />
      </MetricGrid>

      <div className={styles.tableSurface}>
        {error ? (
          <div className={styles.emptyPanelCompact}>{error}</div>
        ) : (
          <>
            <Table
              columns={columns}
              data={calls ?? []}
              rowKey={(row) => row.id}
              density="compact"
              ariaLabel="Recent inference calls"
              loading={calls === null}
              skeletonRows={3}
              scrollWidth="sm"
              empty={<div className={styles.emptyPanelCompact}>No inference calls yet.</div>}
            />
            {calls !== null && calls.length === limit && limit < 500 && (
              <div className={styles.loadMoreAction}>
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
    </PageSection>
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
  return formatShortDate(t);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
