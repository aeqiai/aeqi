import { useMemo, useState } from "react";

import { useDaemonStore } from "@/store/daemon";
import { useAssets } from "@/hooks/useAssets";
import { useDecodedVaultActivity } from "@/hooks/useDecodedVaultActivity";
import { useIncorporation } from "@/hooks/useIncorporation";
import { useTokenMetas } from "@/hooks/useTokenMetas";
import { useVaultActivity } from "@/hooks/useVaultActivity";
import type { ModuleAccountWithPda } from "@/solana";
import type { BudgetAccountWithPda } from "@/solana/assets";
import { Banner, Button, EmptyState, Loading, Page, PageBody, PageHeader } from "@/components/ui";

import { downloadVaultSnapshot } from "./AssetsSnapshot";
import { SnapshotDiffModal } from "./AssetsSnapshotDiff";
import { BudgetsSection, VestingPositionsSection, type TokenMetaMap } from "./AssetsSections";
import { BudgetDetailModal } from "./AssetsBudgetModal";
import { NewBudgetModal } from "./AssetsNewBudgetModal";
import { NewSpendModal } from "./AssetsNewSpendModal";
import { NewAllocateModal } from "./AssetsNewAllocateModal";
import { FreezeBudgetModal } from "./AssetsFreezeBudgetModal";
import { ModuleDetailModal } from "./AssetsModuleModal";
import { VaultActivitySection } from "./AssetsActivity";
import { VaultIdentitySection } from "./AssetsExtras";
import { TreasuryAlertsBanner } from "./AssetsAlerts";
import { CapitalizeSection, HoldingsSection, TreasuryOverviewSection } from "./AssetsOverview";

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
 *   1. Treasury overview — USD value + holdings/budgets/vesting counts
 *      + 30d USD curve (replayed from decoded stablecoin flows) or
 *      signature-count fallback when no decoded events yet.
 *   2. Capitalize your TRUST — vault deposit address + Deposit USDC /
 *      Receive other token / Withdraw action row.
 *   3. Vault identity — module-state + vault authority PDAs, treasury
 *      authority, per-module program / version / initialized state.
 *   4. Recent vault activity — decoded deposit/withdraw rows.
 *   5. Holdings — every SPL token account owned by the vault.
 *   6. Active budgets — per-role allocations from `aeqi_budget`.
 *   7. Vesting positions — outstanding grants from `aeqi_vesting`.
 *
 * Each Capitalize action drives the page's send/receive state machine
 * so the corresponding inline shell (WithdrawFormShell /
 * HoldingReceiveCard) renders below Holdings without scroll context loss.
 */
const USDC_MAINNET_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

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
    set.add(USDC_MAINNET_MINT);
    set.add("BscBtSVDbZCzSHikQSwmCuszX4f4nbESdnfrFYkbv3F3");
    for (const h of holdings ?? []) set.add(h.mint.toBase58());
    for (const v of vestingPositions ?? []) set.add(v.account.mint.toBase58());
    return [...set];
  }, [holdings, vestingPositions]);
  const metas: TokenMetaMap = useTokenMetas(allMints);

  const [budgetDetail, setBudgetDetail] = useState<BudgetAccountWithPda | null>(null);
  const [newBudgetOpen, setNewBudgetOpen] = useState(false);
  /** Iter-7: row-level Spend modal — open when an operator clicks
   *  "Spend" on a budget row. Lives in page state so a re-fetch after
   *  a successful spend collapses the modal cleanly. */
  const [spendBudget, setSpendBudget] = useState<BudgetAccountWithPda | null>(null);
  /** Iter-8: row-level Allocate-child modal — open when an operator
   *  clicks "Allocate" on a budget row. The parent budget seeds the
   *  on-chain `parent_budget_id` so the new sub-budget reads as a
   *  child in the hierarchy view. */
  const [allocateParent, setAllocateParent] = useState<BudgetAccountWithPda | null>(null);
  /** Iter-8: row-level Freeze / Unfreeze confirmation modal — flips
   *  the on-chain `frozen` bool. Active for either direction; the
   *  modal reads its title + verb off `budget.account.frozen`. */
  const [freezeBudget, setFreezeBudget] = useState<BudgetAccountWithPda | null>(null);
  /** Iter-6: click-through on a Vault identity module row opens the
   *  ModuleDetailModal with ACL bits + recent signatures. */
  const [moduleDetail, setModuleDetail] = useState<ModuleAccountWithPda | null>(null);
  /** Iter-11: snapshot diff modal — open from the "Compare
   *  snapshots" header action. Accepts two snapshot JSON files via
   *  plain file inputs and renders a deterministic per-budget /
   *  per-vesting / per-mint delta entirely client-side. */
  const [snapshotDiffOpen, setSnapshotDiffOpen] = useState(false);
  /** Active "send" prefill — populated when an operator clicks Send on a
   *  holdings row or the Capitalize Withdraw action. Drives the inline
   *  WithdrawFormShell beneath the Holdings table. */
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
        <TreasuryAlertsBanner
          holdings={holdings ?? []}
          budgets={budgets ?? []}
          vestingPositions={vestingPositions ?? []}
          metas={metas}
          decodedActivity={decodedActivity.rows}
        />
        <TreasuryOverviewSection
          holdings={holdings ?? []}
          budgets={budgets ?? []}
          vestingPositions={vestingPositions ?? []}
          metas={metas}
          decodedActivity={decodedActivity.rows}
          activitySparkline={vaultActivity.data?.sparkline ?? []}
          onCompareSnapshots={() => setSnapshotDiffOpen(true)}
          onExportSnapshot={() => {
            // Iter-10: serialise the on-chain state we already have in
            // memory (holdings + budgets + vesting + modules + roles +
            // signature tail + decoded activity) into a portable JSON
            // blob and trigger a browser download. Useful for off-
            // platform record-keeping, audit hand-off, or feeding into
            // a spreadsheet.
            downloadVaultSnapshot(
              {
                entity,
                trustAddress,
                vault: {
                  moduleStatePda: vault.moduleStatePda.toBase58(),
                  vaultAuthorityPda: vault.vaultAuthorityPda.toBase58(),
                  moduleInitialized: !!vault.moduleState,
                  treasuryAuthority: vault.moduleState?.treasuryAuthority.toBase58() ?? null,
                },
                holdings: holdings ?? [],
                budgets: budgets ?? [],
                vestingPositions: vestingPositions ?? [],
                modules: incorporation.modules,
                roles: incorporation.roles,
                signatures: vaultActivity.data?.signatures ?? [],
                decodedActivity: decodedActivity.rows,
                metas,
              },
              entity?.name,
            );
          }}
        />
        <CapitalizeSection
          vaultAuthority={vault.vaultAuthorityPda.toBase58()}
          entity={entity}
          holdings={holdings ?? []}
          onSend={() => {
            setSendPrefill({ mint: USDC_MAINNET_MINT, symbol: "USDC" });
            setReceivePrefill(null);
          }}
          onReceive={() => {
            setReceivePrefill({ mint: USDC_MAINNET_MINT, symbol: "USDC" });
            setSendPrefill(null);
          }}
        />
        <VaultIdentitySection
          moduleStatePda={vault.moduleStatePda.toBase58()}
          vaultAuthorityPda={vault.vaultAuthorityPda.toBase58()}
          treasuryAuthority={vault.moduleState?.treasuryAuthority.toBase58() ?? null}
          trustAuthority={incorporation.trust?.authority.toBase58() ?? null}
          moduleInitialized={!!vault.moduleState}
          modules={incorporation.modules ?? []}
          onSelectModule={(m) => setModuleDetail(m)}
        />
        <VaultActivitySection
          signatures={vaultActivity.data?.signatures ?? []}
          decoded={decodedActivity.rows}
          isLoading={vaultActivity.isLoading || decodedActivity.isLoading}
          metas={metas}
          roles={incorporation.roles}
          budgets={budgets ?? []}
          vestingPositions={vestingPositions ?? []}
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
          onSpend={(row) => setSpendBudget(row)}
          onAllocate={(row) => setAllocateParent(row)}
          onFreeze={(row) => setFreezeBudget(row)}
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
          budgets={budgets ?? []}
          trustAuthority={incorporation.trust?.authority.toBase58() ?? null}
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
        <NewSpendModal
          budget={spendBudget}
          onClose={() => setSpendBudget(null)}
          onSpent={() => {
            refetch();
          }}
        />
        <NewAllocateModal
          parent={allocateParent}
          trustId={trustId}
          onClose={() => setAllocateParent(null)}
          onAllocated={() => {
            refetch();
          }}
        />
        <FreezeBudgetModal
          budget={freezeBudget}
          trustId={trustId}
          onClose={() => setFreezeBudget(null)}
          onFlipped={() => {
            refetch();
          }}
        />
        <ModuleDetailModal module={moduleDetail} onClose={() => setModuleDetail(null)} />
        <SnapshotDiffModal
          open={snapshotDiffOpen}
          onClose={() => setSnapshotDiffOpen(false)}
        />
      </PageBody>
    </Page>
  );
}
