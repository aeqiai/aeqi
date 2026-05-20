import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";

import { useDaemonStore } from "@/store/daemon";
import { useAssets } from "@/hooks/useAssets";
import { useDecodedVaultActivity } from "@/hooks/useDecodedVaultActivity";
import { useIncorporation } from "@/hooks/useIncorporation";
import { useTokenMetas } from "@/hooks/useTokenMetas";
import { useVaultActivity } from "@/hooks/useVaultActivity";
import type { ResolvedTokenMeta } from "@/hooks/useTokenMetas";
import type { BudgetAccountWithPda, VaultHolding, VestingPositionWithPda } from "@/solana/assets";
import { formatCurrency, formatInteger, formatNumber } from "@/lib/i18n";
import { explorerAddressUrl } from "@/lib/solana-explorer";
import {
  Banner,
  Button,
  Card,
  DetailField,
  EmptyState,
  Icon,
  Inline,
  Loading,
  MetricCard,
  MetricGrid,
  Page,
  PageBody,
  PageHeader,
  PageSection,
  QRCode,
  Stack,
  Table,
  Tooltip,
  type TableColumn,
} from "@/components/ui";

import {
  BudgetsSection,
  CopyableMono,
  VestingPositionsSection,
  formatTokenAmount,
  isStableSymbol,
  rawToFloat,
  shortAddress,
  type TokenMetaMap,
} from "./AssetsSections";
import { BudgetDetailModal } from "./AssetsBudgetModal";
import { NewBudgetModal } from "./AssetsNewBudgetModal";
import { VaultActivitySection } from "./AssetsActivity";
import {
  HoldingDetailPanel,
  HoldingReceiveCard,
  VaultActivityStrip,
  VaultIdentitySection,
  WithdrawFormShell,
  type HoldingRow,
} from "./AssetsExtras";
import styles from "./AssetsPage.module.css";

/**
 * Assets — `a` in the AEQI grammar (assets · equity · quorum · identity).
 *
 * The TRUST's wealth surface — "what does this TRUST hold?" — and the
 * public-facing answer to the "TRUST capitalizes self → buys runtime"
 * model. The hero affordance is the vault deposit address: any Solana
 * wallet sending USDC to it credits the TRUST. Everything else is
 * supporting context (holdings, budgets, vesting list).
 *
 * Sections (order is load-bearing — the deposit CTA sits before the
 * read-only context):
 *   1. Treasury overview — USD value + holdings/budgets/vesting counts.
 *   2. Capitalize your TRUST — vault authority pubkey with copy + QR.
 *      First-class call to action; renders even before the treasury
 *      module is initialized (PDAs are deterministic from `trust_pda`).
 *   3. Vault identity — module-state + vault authority PDAs, treasury
 *      authority, module status.
 *   4. Holdings — every SPL token account owned by the vault, across
 *      Token-2022 and legacy Token programs, with USD valuation for
 *      registered stablecoins.
 *   5. Active budgets — per-role allocations from `aeqi_budget` (hidden
 *      cleanly for Foundation-shaped TRUSTs that don't adopt budget).
 *   6. Vesting positions — outstanding grants from `aeqi_vesting` with
 *      per-recipient claimed/total ratio + lifecycle status. Hidden when
 *      no positions exist on this TRUST.
 *
 * Anti-scope: no deposit/withdraw write UI (deposits happen externally
 * via Solana wallets), no transfer history (deferred to indexer HTTP),
 * no fund management (Venture-specific, future quest).
 */
export default function AssetsPage({ trustId }: { trustId: string }) {
  const entities = useDaemonStore((s) => s.entities);
  const entity = useMemo(() => entities.find((e) => e.id === trustId), [entities, trustId]);
  const trustAddress = entity?.trust_address ?? null;

  const { vault, holdings, budgets, vestingPositions, isLoading, isFetching, error, refetch } =
    useAssets(trustAddress);
  const incorporation = useIncorporation(trustAddress);
  const vaultAuthorityB58 = vault?.vaultAuthorityPda.toBase58() ?? null;
  const vaultActivity = useVaultActivity(vaultAuthorityB58);
  const decodedActivity = useDecodedVaultActivity(
    vaultAuthorityB58,
    vaultActivity.data?.signatures ?? [],
  );

  // Gather every mint that any row on the page references (holdings,
  // vesting positions, budget-denomination USDC) and resolve them in one
  // batch. `useTokenMetas` short-circuits registry hits so we only spend
  // RPC on mints we haven't already pinned in `TOKEN_REGISTRY`.
  const allMints = useMemo<string[]>(() => {
    const set = new Set<string>();
    // The budget denomination — mainnet + localnet USDC — so the
    // "Active budgets" utilization meter picks up decimals.
    set.add("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
    set.add("BscBtSVDbZCzSHikQSwmCuszX4f4nbESdnfrFYkbv3F3");
    for (const h of holdings ?? []) set.add(h.mint.toBase58());
    for (const v of vestingPositions ?? []) set.add(v.account.mint.toBase58());
    return [...set];
  }, [holdings, vestingPositions]);
  const metas: TokenMetaMap = useTokenMetas(allMints);

  const [budgetDetail, setBudgetDetail] = useState<BudgetAccountWithPda | null>(null);
  const [newBudgetOpen, setNewBudgetOpen] = useState(false);
  /** Active "send" prefill — populated when an operator clicks Send on a
   *  holdings row. Drives the inline WithdrawFormShell at the top of the
   *  page so the form lands prefilled with that mint. */
  const [sendPrefill, setSendPrefill] = useState<{ mint: string; symbol: string | null } | null>(
    null,
  );
  /** Active "receive" prefill — drives the inline HoldingReceiveCard. */
  const [receivePrefill, setReceivePrefill] = useState<{
    mint: string;
    symbol: string | null;
  } | null>(null);

  if (!trustAddress) {
    return (
      <Page>
        <PageHeader title="Assets" description="What the TRUST holds." />
        <PageBody>
          <EmptyState
            title="Not yet on-chain"
            description="This entity does not have a TRUST proxy address yet. Once the click-to-DAO bridge fires, the treasury vault and on-chain holdings will render here."
          />
        </PageBody>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page>
        <PageHeader title="Assets" description="What the TRUST holds." />
        <PageBody>
          <Loading variant="section" label="Reading on-chain treasury state" />
        </PageBody>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <PageHeader title="Assets" description="What the TRUST holds." />
        <PageBody>
          <EmptyState
            title="Couldn't read treasury state"
            description={error.message || "The RPC call to the configured Solana cluster failed."}
          />
        </PageBody>
      </Page>
    );
  }

  if (!vault) {
    return (
      <Page>
        <PageHeader title="Assets" description="What the TRUST holds." />
        <PageBody>
          <EmptyState
            title="Treasury vault unavailable"
            description="The treasury vault PDAs could not be derived for this TRUST."
          />
        </PageBody>
      </Page>
    );
  }

  const headerActions = (
    <Button
      variant="secondary"
      size="sm"
      onClick={refetch}
      disabled={isFetching}
      aria-label="Refresh treasury reads"
    >
      {isFetching ? "Refreshing…" : "Refresh"}
    </Button>
  );

  return (
    <Page>
      <PageHeader title="Assets" description="What the TRUST holds." actions={headerActions} />
      <PageBody>
        {!vault.moduleState && (
          <Banner kind="info">
            Treasury module not yet initialized. Deposits to the vault address still credit the
            TRUST — the module-state record only flips on the first programmatic deposit or on-chain
            registration.
          </Banner>
        )}
        <TreasuryOverviewSection
          holdings={holdings ?? []}
          budgets={budgets ?? []}
          vestingPositions={vestingPositions ?? []}
          metas={metas}
          activitySparkline={vaultActivity.data?.sparkline ?? []}
        />
        <CapitalizeSection vaultAuthority={vault.vaultAuthorityPda.toBase58()} />
        <VaultIdentitySection
          moduleStatePda={vault.moduleStatePda.toBase58()}
          vaultAuthorityPda={vault.vaultAuthorityPda.toBase58()}
          treasuryAuthority={vault.moduleState?.treasuryAuthority.toBase58() ?? null}
          trustAuthority={incorporation.trust?.authority.toBase58() ?? null}
          moduleInitialized={!!vault.moduleState}
          modules={incorporation.modules ?? []}
        />
        <VaultActivitySection
          signatures={vaultActivity.data?.signatures ?? []}
          decoded={decodedActivity.rows}
          isLoading={vaultActivity.isLoading || decodedActivity.isLoading}
          metas={metas}
        />
        <HoldingsSection
          holdings={holdings ?? []}
          metas={metas}
          vaultAuthority={vaultAuthorityB58}
          onSendRow={(row) => {
            setSendPrefill({ mint: row.mint, symbol: row.symbol });
            setReceivePrefill(null);
          }}
          onReceiveRow={(row) => {
            setReceivePrefill({ mint: row.mint, symbol: row.symbol });
            setSendPrefill(null);
          }}
          sendPrefill={sendPrefill}
          receivePrefill={receivePrefill}
          onClearSend={() => setSendPrefill(null)}
          onClearReceive={() => setReceivePrefill(null)}
        />
        <BudgetsSection
          budgets={budgets ?? []}
          metas={metas}
          onSelect={(row) => setBudgetDetail(row)}
          actions={
            <Button variant="primary" size="sm" onClick={() => setNewBudgetOpen(true)}>
              + New budget
            </Button>
          }
        />
        {(vestingPositions?.length ?? 0) > 0 && (
          <VestingPositionsSection positions={vestingPositions ?? []} metas={metas} />
        )}
        <BudgetDetailModal
          budget={budgetDetail}
          metas={metas}
          onClose={() => setBudgetDetail(null)}
        />
        <NewBudgetModal
          open={newBudgetOpen}
          onClose={() => setNewBudgetOpen(false)}
          trustId={trustId}
          onCreated={() => {
            refetch();
          }}
        />
      </PageBody>
    </Page>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Sections                                                            */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Treasury overview — the at-a-glance answer to "how much does this
 * TRUST hold and where is it allocated". Total USD value is computed
 * permissively: every holding whose mint resolves to a registered
 * stablecoin (USDC) is summed at par; unknown mints don't contribute
 * (we don't fake prices). The headline is "stablecoin USD" — not "total
 * USD" — so the operator isn't misled when SPL governance tokens or
 * AEQI-issued equity sit alongside USDC.
 */
function TreasuryOverviewSection({
  holdings,
  budgets,
  vestingPositions,
  metas,
  activitySparkline,
}: {
  holdings: VaultHolding[];
  budgets: BudgetAccountWithPda[];
  vestingPositions: VestingPositionWithPda[];
  metas: TokenMetaMap;
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
      <VaultActivityStrip series={activitySparkline} total={activityTotal} />
    </PageSection>
  );
}

function CapitalizeSection({ vaultAuthority }: { vaultAuthority: string }) {
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
              runtime-upgrade rail; direct ad-hoc withdraw UI is not exposed here.
            </span>
            <a
              href={explorerAddressUrl(vaultAuthority)}
              target="_blank"
              rel="noreferrer noopener"
              className={styles.capitalizeExplorer}
              aria-label="Open vault address in Solana explorer"
            >
              <Icon icon={ExternalLink} size="xs" />
              <span>View vault on Solana explorer</span>
            </a>
          </Stack>
        </Inline>
      </Card>
      <WithdrawFormShell />
    </PageSection>
  );
}

function HoldingsSection({
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

const COMP_TONES = ["accent", "ink", "muted", "subtle", "soft"] as const;
