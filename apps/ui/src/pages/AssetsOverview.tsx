/**
 * Top-of-page Assets surfaces — Treasury overview metrics, Capitalize
 * action card, Holdings table, and the per-mint composition bar.
 * Extracted from `AssetsPage.tsx` in iter-5 to keep the host page under
 * the 600-line lint ceiling. Everything here is tightly coupled to the
 * Assets domain (vault holdings, treasury USD curve, send/receive
 * state machine wiring) and not consumed from other pages.
 *
 * Render order on the host page is:
 *   1. TreasuryOverviewSection — four MetricCards + the activity strip
 *      (USD curve when decoded events exist, signature-count fallback
 *      otherwise).
 *   2. CapitalizeSection — vault deposit address + Deposit / Receive /
 *      Withdraw action row.
 *   3. HoldingsSection — per-mint table + inline detail panel +
 *      composition bar.
 */
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import type { DecodedActivity } from "@/hooks/useDecodedVaultActivity";
import type { ResolvedTokenMeta } from "@/hooks/useTokenMetas";
import { useTreasuryUsdCurve } from "@/hooks/useTreasuryUsdCurve";
import type { BudgetAccountWithPda, VaultHolding, VestingPositionWithPda } from "@/solana/assets";
import { formatCurrency, formatInteger, formatNumber } from "@/lib/i18n";
import { explorerAddressUrl } from "@/lib/solana-explorer";
import {
  Button,
  Card,
  DetailField,
  EmptyState,
  Icon,
  Inline,
  MetricCard,
  MetricGrid,
  PageSection,
  QRCode,
  Stack,
  Table,
  Tooltip,
  type TableColumn,
} from "@/components/ui";

import {
  CopyableMono,
  formatTokenAmount,
  isStableSymbol,
  rawToFloat,
  shortAddress,
  type TokenMetaMap,
} from "./AssetsSections";
import {
  HoldingDetailPanel,
  HoldingReceiveCard,
  VaultActivityStrip,
  WithdrawFormShell,
  type HoldingRow,
} from "./AssetsExtras";
import styles from "./AssetsPage.module.css";

const COMP_TONES = ["accent", "ink", "muted", "subtle", "soft"] as const;

/**
 * Treasury overview — the at-a-glance answer to "how much does this
 * TRUST hold and where is it allocated". Total USD value is computed
 * permissively: every holding whose mint resolves to a registered
 * stablecoin (USDC) is summed at par; unknown mints don't contribute
 * (we don't fake prices). The headline is "stablecoin USD" — not "total
 * USD" — so the operator isn't misled when SPL governance tokens or
 * AEQI-issued equity sit alongside USDC.
 */
export function TreasuryOverviewSection({
  holdings,
  budgets,
  vestingPositions,
  metas,
  decodedActivity,
  activitySparkline,
}: {
  holdings: VaultHolding[];
  budgets: BudgetAccountWithPda[];
  vestingPositions: VestingPositionWithPda[];
  metas: TokenMetaMap;
  /** Decoded vault flows — fed into `useTreasuryUsdCurve` to project a
   *  per-day USD balance backwards from the current stable balance. */
  decodedActivity: DecodedActivity[];
  activitySparkline: number[];
}) {
  const { stableUsd, nonZeroCount, mintCount } = useMemo(() => {
    let stable = 0;
    let nonZero = 0;
    const mints = new Set<string>();
    for (const h of holdings) {
      const key = h.mint.toBase58();
      mints.add(key);
      if (h.amount > 0n) nonZero += 1;
      const meta = metas[key];
      if (meta?.symbol && isStableSymbol(meta.symbol) && meta.decimals !== null) {
        stable += rawToFloat(h.amount, meta.decimals);
      }
    }
    return { stableUsd: stable, nonZeroCount: nonZero, mintCount: mints.size };
  }, [holdings, metas]);

  const activeBudgets = useMemo(() => budgets.filter((b) => !b.account.frozen).length, [budgets]);
  const claimableCount = useMemo(
    () => vestingPositions.filter((p) => p.account.claimedAmount < p.account.totalAmount).length,
    [vestingPositions],
  );

  const activityTotal = useMemo(
    () => activitySparkline.reduce((a, b) => a + b, 0),
    [activitySparkline],
  );

  // Project a USD value-over-time curve from decoded stablecoin flows.
  // When we have at least one stable deposit/withdraw in the decode
  // window the strip switches to a real USD curve; otherwise we fall
  // back to the signature-count line so the strip stays useful in
  // pre-activity states.
  const usdCurve = useTreasuryUsdCurve(decodedActivity, stableUsd, metas);

  return (
    <PageSection title="Treasury overview" description="At-a-glance of vault, budgets, and grants.">
      <MetricGrid columns={4}>
        <MetricCard
          label="Stablecoin balance"
          value={formatCurrency(stableUsd, "USD", { maximumFractionDigits: 2 })}
          detail={stableUsd > 0 ? "Summed at par across registered USD stablecoins." : "—"}
        />
        <MetricCard
          label="Holdings"
          value={formatInteger(nonZeroCount)}
          detail={
            mintCount > nonZeroCount
              ? `${formatInteger(mintCount - nonZeroCount)} historical mint${
                  mintCount - nonZeroCount === 1 ? "" : "s"
                } with zero balance`
              : "Distinct mints with a non-zero balance."
          }
        />
        <MetricCard
          label="Active budgets"
          value={formatInteger(activeBudgets)}
          detail={
            budgets.length > activeBudgets
              ? `${formatInteger(budgets.length - activeBudgets)} frozen`
              : "Allocated to roles."
          }
        />
        <MetricCard
          label="Vesting grants"
          value={formatInteger(vestingPositions.length)}
          detail={
            vestingPositions.length === 0
              ? "—"
              : `${formatInteger(claimableCount)} with outstanding claim balance`
          }
        />
      </MetricGrid>
      {usdCurve.hasStableEvents ? (
        <VaultActivityStrip series={usdCurve.series} mode="usd" total={usdCurve.currentUsd} />
      ) : (
        <VaultActivityStrip series={activitySparkline} mode="count" total={activityTotal} />
      )}
    </PageSection>
  );
}

/**
 * Capitalize section — iter-5 promotion from a buried QR card to a real
 * action card with Deposit USDC / Receive other token / Withdraw
 * buttons. The buttons drive the page-level send/receive state machine
 * so the corresponding inline shells (WithdrawFormShell /
 * HoldingReceiveCard) render where the operator is already looking.
 */
export function CapitalizeSection({
  vaultAuthority,
  onSend,
  onReceive,
}: {
  vaultAuthority: string;
  onSend: () => void;
  onReceive: () => void;
}) {
  return (
    <PageSection
      title="Capitalize your TRUST"
      description="Send USDC (or any SPL token) to the vault address from any Solana wallet. The TRUST owns the balance the moment it lands."
    >
      <Card padding="lg">
        <Inline gap="6" align="start">
          <QRCode value={vaultAuthority} size={160} />
          <Stack gap="3" className={styles.capitalizeStack}>
            <DetailField label="Vault deposit address">
              <CopyableMono
                full={vaultAuthority}
                display={vaultAuthority}
                mode="full"
                withExplorer
              />
            </DetailField>
            <span className={styles.capitalizeNote}>
              The deposit address is a program-owned PDA — only the TRUST&apos;s configured treasury
              authority can authorize a withdrawal. Withdrawals route through governance or the
              runtime-upgrade rail.
            </span>
            <Inline gap="2" align="center" className={styles.capitalizeActions}>
              <Button variant="primary" size="sm" onClick={onReceive}>
                Deposit USDC
              </Button>
              <Button variant="secondary" size="sm" onClick={onReceive}>
                Receive other token
              </Button>
              <Button variant="secondary" size="sm" onClick={onSend}>
                Withdraw
              </Button>
              <a
                href={explorerAddressUrl(vaultAuthority)}
                target="_blank"
                rel="noreferrer noopener"
                className={styles.capitalizeExplorer}
                aria-label="Open vault address in Solana explorer"
              >
                <Icon icon={ExternalLink} size="xs" />
                <span>View on explorer</span>
              </a>
            </Inline>
          </Stack>
        </Inline>
      </Card>
    </PageSection>
  );
}

/**
 * Holdings table — every SPL token account owned by the vault authority
 * across the legacy Token program + Token-2022. Multiple ATAs against
 * one mint collapse to one row; clicking a row expands the
 * HoldingDetailPanel. The composition bar above the table shows the
 * USD share of each stablecoin (registered mints only).
 */
export function HoldingsSection({
  holdings,
  metas,
  vaultAuthority,
  onSendRow,
  onReceiveRow,
  sendPrefill,
  receivePrefill,
  onClearSend,
  onClearReceive,
}: {
  holdings: VaultHolding[];
  metas: TokenMetaMap;
  vaultAuthority: string | null;
  onSendRow: (row: HoldingRow) => void;
  onReceiveRow: (row: HoldingRow) => void;
  sendPrefill: { mint: string; symbol: string | null } | null;
  receivePrefill: { mint: string; symbol: string | null } | null;
  onClearSend: () => void;
  onClearReceive: () => void;
}) {
  const [hideZero, setHideZero] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Group by mint so multiple ATAs against the same mint collapse to one
  // row with aggregate amount. Rare in practice (one mint normally has
  // one ATA per owner) but possible after wallet weirdness.
  const allRows = useMemo<HoldingRow[]>(() => {
    const byMint = new Map<string, HoldingRow>();
    for (const h of holdings) {
      const key = h.mint.toBase58();
      const meta: ResolvedTokenMeta = metas[key] ?? {
        symbol: null,
        decimals: null,
        resolvedOnChain: false,
      };
      const prev = byMint.get(key);
      if (prev) {
        prev.amount = prev.amount + h.amount;
        if (prev.usdValue !== null && meta.decimals !== null && isStableSymbol(meta.symbol ?? "")) {
          prev.usdValue = rawToFloat(prev.amount, meta.decimals);
        }
      } else {
        const isStable = !!(meta.symbol && isStableSymbol(meta.symbol) && meta.decimals !== null);
        byMint.set(key, {
          mint: key,
          amount: h.amount,
          tokenAccount: h.tokenAccount.toBase58(),
          symbol: meta.symbol,
          decimals: meta.decimals,
          usdValue: isStable ? rawToFloat(h.amount, meta.decimals as number) : null,
          tokenProgram: h.programId.toBase58(),
          metaResolvedOnChain: meta.resolvedOnChain,
        });
      }
    }
    return [...byMint.values()].sort((a, b) => {
      // Surface non-zero balances first; alphabetize the rest.
      const aZero = a.amount === 0n;
      const bZero = b.amount === 0n;
      if (aZero !== bZero) return aZero ? 1 : -1;
      return a.mint.localeCompare(b.mint);
    });
  }, [holdings, metas]);

  const zeroCount = useMemo(() => allRows.filter((r) => r.amount === 0n).length, [allRows]);
  const rows = useMemo(
    () => (hideZero ? allRows.filter((r) => r.amount > 0n) : allRows),
    [allRows, hideZero],
  );
  const totalUsd = useMemo(() => allRows.reduce((sum, r) => sum + (r.usdValue ?? 0), 0), [allRows]);

  const columns: Array<TableColumn<HoldingRow>> = [
    {
      key: "token",
      header: "Token",
      cell: (row) => (
        <span className={styles.tokenCell}>
          <span className={styles.tokenSymbol}>{row.symbol ?? "SPL"}</span>
          <CopyableMono
            full={row.mint}
            display={shortAddress(row.mint)}
            tone="muted"
            withExplorer
          />
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      align: "end",
      cell: (row) => (
        <span className={styles.numCell}>{formatTokenAmount(row.amount, row.decimals)}</span>
      ),
    },
    {
      key: "usd",
      header: "USD value",
      align: "end",
      cell: (row) =>
        row.usdValue !== null ? (
          <span className={styles.numCell}>
            {formatCurrency(row.usdValue, "USD", { maximumFractionDigits: 2 })}
          </span>
        ) : (
          <Tooltip content="USD value is only computed for registered stablecoin mints.">
            <span className={styles.mutedDash}>—</span>
          </Tooltip>
        ),
    },
    {
      key: "ata",
      header: "Token account",
      cell: (row) => (
        <CopyableMono
          full={row.tokenAccount}
          display={shortAddress(row.tokenAccount)}
          withExplorer
        />
      ),
    },
  ];

  const description =
    "SPL token accounts owned by the vault authority across the Token and Token-2022 programs.";

  const sectionActions =
    zeroCount > 0 ? (
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setHideZero((v) => !v)}
        aria-pressed={!hideZero}
      >
        {hideZero
          ? `Show ${formatInteger(zeroCount)} zero balance${zeroCount === 1 ? "" : "s"}`
          : "Hide zero balances"}
      </Button>
    ) : null;

  const expandedRow = expanded ? (rows.find((r) => r.mint === expanded) ?? null) : null;

  return (
    <PageSection title="Holdings" description={description} actions={sectionActions}>
      <TreasuryCompositionBar rows={allRows} totalUsd={totalUsd} />
      <Table
        columns={columns}
        data={rows}
        rowKey={(row) => row.mint}
        onRowClick={(row) => setExpanded((cur) => (cur === row.mint ? null : row.mint))}
        empty={
          <EmptyState
            title="No holdings yet"
            description="Send USDC or any other SPL token to the vault deposit address above to capitalize the TRUST."
          />
        }
        ariaLabel="Vault holdings"
      />
      {expandedRow && (
        <HoldingDetailPanel
          row={expandedRow}
          onClose={() => setExpanded(null)}
          onSend={(row) => onSendRow(row)}
          onReceive={(row) => onReceiveRow(row)}
        />
      )}
      {sendPrefill && (
        <WithdrawFormShell
          headline={`Send ${sendPrefill.symbol ?? "SPL"} from the vault`}
          prefillMint={sendPrefill}
          onClearPrefill={onClearSend}
        />
      )}
      {receivePrefill && vaultAuthority && (
        <HoldingReceiveCard
          vaultAuthority={vaultAuthority}
          symbol={receivePrefill.symbol}
          onClose={onClearReceive}
        />
      )}
      {totalUsd > 0 && rows.length > 0 && (
        <div className={styles.totalsRow}>
          <span>Stablecoin total</span>
          <span className={styles.totalsValue}>
            {formatCurrency(totalUsd, "USD", { maximumFractionDigits: 2 })}
          </span>
        </div>
      )}
    </PageSection>
  );
}

/**
 * Treasury composition — a single stacked bar showing the USD share of
 * each stablecoin mint in the vault. Honest about its scope: only
 * registered stablecoins contribute, since we have no oracle for SPL
 * governance tokens or AEQI-issued equity. When the vault holds no
 * stablecoins (a Foundation TRUST that just spawned, or a fresh Venture
 * pre-deposit) the bar collapses and the section renders a small
 * explainer instead.
 */
function TreasuryCompositionBar({ rows, totalUsd }: { rows: HoldingRow[]; totalUsd: number }) {
  const stableRows = rows.filter((r) => r.usdValue !== null && r.usdValue > 0);
  if (totalUsd <= 0 || stableRows.length === 0) return null;
  // Group remaining mints into "Other tracked" when more than four;
  // small mints visually disappear and the legend gets crowded.
  const sorted = [...stableRows].sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0));
  const HEAD = 4;
  const head = sorted.slice(0, HEAD);
  const tail = sorted.slice(HEAD);
  const tailSum = tail.reduce((s, r) => s + (r.usdValue ?? 0), 0);

  const segments = [
    ...head.map((r, i) => ({
      key: r.mint,
      label: r.symbol ?? "SPL",
      value: r.usdValue ?? 0,
      // Token-2022 AEQI-issued mints sit in the secondary slot via the
      // accent ladder — segment 1 = primary, 2..N = step-down tints.
      tone: COMP_TONES[i % COMP_TONES.length],
    })),
    ...(tail.length > 0
      ? [
          {
            key: "other",
            label: `Other (${tail.length})`,
            value: tailSum,
            tone: COMP_TONES[HEAD % COMP_TONES.length],
          },
        ]
      : []),
  ];

  return (
    <div className={styles.composition}>
      <div className={styles.compositionBar} role="img" aria-label="Treasury composition">
        {segments.map((seg) => {
          const widthPct = (seg.value / totalUsd) * 100;
          return (
            <div
              key={seg.key}
              className={styles.compositionSegment}
              data-tone={seg.tone}
              style={{ width: `${widthPct}%` }}
              title={`${seg.label} · ${formatCurrency(seg.value, "USD", {
                maximumFractionDigits: 2,
              })}`}
            />
          );
        })}
      </div>
      <ul className={styles.compositionLegend}>
        {segments.map((seg) => {
          const pct = (seg.value / totalUsd) * 100;
          return (
            <li key={seg.key} className={styles.compositionLegendItem}>
              <span className={styles.compositionDot} data-tone={seg.tone} aria-hidden />
              <span className={styles.compositionLabel}>{seg.label}</span>
              <span className={styles.compositionPct}>
                {formatNumber(pct, { maximumFractionDigits: pct < 1 ? 2 : 0 })}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
