import { useMemo, useState } from "react";

import { useDaemonStore } from "@/store/daemon";
import { useAssets } from "@/hooks/useAssets";
import { lookupTokenMeta } from "@/solana";
import type { BudgetAccountWithPda, VaultHolding, VestingPositionWithPda } from "@/solana/assets";
import { formatCurrency, formatInteger } from "@/lib/i18n";
import {
  Badge,
  Banner,
  Button,
  Card,
  DetailField,
  EmptyState,
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
} from "./AssetsSections";
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
        />
        <CapitalizeSection vaultAuthority={vault.vaultAuthorityPda.toBase58()} />
        <VaultIdentitySection
          moduleStatePda={vault.moduleStatePda.toBase58()}
          vaultAuthorityPda={vault.vaultAuthorityPda.toBase58()}
          treasuryAuthority={vault.moduleState?.treasuryAuthority.toBase58() ?? null}
          moduleInitialized={!!vault.moduleState}
        />
        <HoldingsSection holdings={holdings ?? []} />
        {(budgets?.length ?? 0) > 0 && <BudgetsSection budgets={budgets ?? []} />}
        {(vestingPositions?.length ?? 0) > 0 && (
          <VestingPositionsSection positions={vestingPositions ?? []} />
        )}
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
}: {
  holdings: VaultHolding[];
  budgets: BudgetAccountWithPda[];
  vestingPositions: VestingPositionWithPda[];
}) {
  const { stableUsd, nonZeroCount, mintCount } = useMemo(() => {
    let stable = 0;
    let nonZero = 0;
    const mints = new Set<string>();
    for (const h of holdings) {
      mints.add(h.mint.toBase58());
      if (h.amount > 0n) nonZero += 1;
      const meta = lookupTokenMeta(h.mint);
      if (meta.symbol && isStableSymbol(meta.symbol) && meta.decimals !== null) {
        stable += rawToFloat(h.amount, meta.decimals);
      }
    }
    return { stableUsd: stable, nonZeroCount: nonZero, mintCount: mints.size };
  }, [holdings]);

  const activeBudgets = useMemo(() => budgets.filter((b) => !b.account.frozen).length, [budgets]);
  const claimableCount = useMemo(
    () => vestingPositions.filter((p) => p.account.claimedAmount < p.account.totalAmount).length,
    [vestingPositions],
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
              <CopyableMono full={vaultAuthority} display={vaultAuthority} mode="full" />
            </DetailField>
            <span className={styles.capitalizeNote}>
              The deposit address is a program-owned PDA — only the TRUST&apos;s configured treasury
              authority can authorize a withdrawal.
            </span>
          </Stack>
        </Inline>
      </Card>
    </PageSection>
  );
}

function VaultIdentitySection({
  moduleStatePda,
  vaultAuthorityPda,
  treasuryAuthority,
  moduleInitialized,
}: {
  moduleStatePda: string;
  vaultAuthorityPda: string;
  treasuryAuthority: string | null;
  moduleInitialized: boolean;
}) {
  return (
    <PageSection title="Vault identity">
      <DetailField label="Vault authority (PDA)">
        <CopyableMono full={vaultAuthorityPda} display={shortAddress(vaultAuthorityPda)} />
      </DetailField>
      <DetailField label="Module state (PDA)">
        <CopyableMono full={moduleStatePda} display={shortAddress(moduleStatePda)} />
      </DetailField>
      <DetailField label="Treasury authority">
        {treasuryAuthority ? (
          <CopyableMono full={treasuryAuthority} display={shortAddress(treasuryAuthority)} />
        ) : (
          <span className={styles.mutedDash}>—</span>
        )}
      </DetailField>
      <DetailField label="Module">
        <Badge variant={moduleInitialized ? "success" : "muted"} dot>
          {moduleInitialized ? "Initialized" : "Not initialized"}
        </Badge>
      </DetailField>
    </PageSection>
  );
}

interface HoldingRow {
  mint: string;
  amount: bigint;
  tokenAccount: string;
  symbol: string | null;
  decimals: number | null;
  /** Stablecoin USD value at par, or null when not a registered stable. */
  usdValue: number | null;
}

function HoldingsSection({ holdings }: { holdings: VaultHolding[] }) {
  const [hideZero, setHideZero] = useState(true);

  // Group by mint so multiple ATAs against the same mint collapse to one
  // row with aggregate amount. Rare in practice (one mint normally has
  // one ATA per owner) but possible after wallet weirdness.
  const allRows = useMemo<HoldingRow[]>(() => {
    const byMint = new Map<string, HoldingRow>();
    for (const h of holdings) {
      const key = h.mint.toBase58();
      const meta = lookupTokenMeta(key);
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
  }, [holdings]);

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
          <span className={styles.tokenSymbol}>{row.symbol ?? "Unknown"}</span>
          <span className={styles.tokenMintMono}>{shortAddress(row.mint)}</span>
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
      cell: (row) => <span className={styles.monoCell}>{shortAddress(row.tokenAccount)}</span>,
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

  return (
    <PageSection title="Holdings" description={description} actions={sectionActions}>
      <Table
        columns={columns}
        data={rows}
        rowKey={(row) => row.mint}
        empty={
          <EmptyState
            title="No holdings yet"
            description="Send USDC or any other SPL token to the vault deposit address above to capitalize the TRUST."
          />
        }
        ariaLabel="Vault holdings"
      />
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
