import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { EquityGenesisCurveSection } from "@/components/EquityGenesisCurveSection";
import { EquityShareControls } from "@/components/EquityShareControls";
import { EquityVestingControls } from "@/components/EquityVestingControls";
import EquityFundingRoundControl from "@/components/EquityFundingRoundControl";
import { EquityPrefillProvider, useEquityPrefill } from "@/components/equity/equityPrefillContext";
import { HolderDrawer } from "@/components/equity/HolderDrawer";
import { MintIdentitySection } from "@/components/equity/MintIdentitySection";
import { VestingSection } from "@/components/equity/VestingSection";
import { useDaemonStore } from "@/store/daemon";
import { useEquity } from "@/hooks/useEquity";
import type { TokenHolder, VestingPositionWithPda } from "@/solana";
import {
  EmptyState,
  Loading,
  Menu,
  Page,
  PageBody,
  PageHeader,
  PageSection,
  Table,
  ToolbarRadioPopover,
  Tooltip,
  type TableColumn,
} from "@/components/ui";

/**
 * Equity — `e` in the AEQI grammar (assets · equity · quorum · identity).
 *
 * v1 = read-only cap table for Venture-shape TRUSTs. Foundation-shape
 * TRUSTs (the signup default) have no `TokenModuleState` and render a
 * quiet empty state inviting the user to start a Company instead.
 *
 * Sections (only rendered for Venture TRUSTs):
 *   1. Mint identity — mint pubkey (copy), supply (formatted with
 *      decimals), max_supply_cap (or "uncapped"), decimals.
 *   2. Cap table — every Token-2022 holder of the mint, sorted by
 *      amount desc, with % of supply.
 *   3. Vesting — every `VestingPosition` keyed to the cap-table mint,
 *      with recipient + total/claimed/end_time. Empty when no
 *      positions exist; silent when the vesting module isn't deployed.
 *
 * Iter-3 added vesting Claim (per-row jade-tone button, claimable
 * computed client-side from the on-chain schedule, posts to an honest
 * stub of `/api/solana/vesting-claim`), funding-round Activate CTAs
 * (modal on Pending rows, posts to `/api/solana/funding-activate`),
 * and a polished MintIdentity hero (avatar + explorer link + 3-column
 * MetricGrid). The bonding-curve chart hover crosshair lives in
 * `EquityGenesisCurveSection.tsx`.
 *
 * Anti-scope: no share-class editor.
 */
export default function EquityPage({ trustId }: { trustId: string }) {
  const entities = useDaemonStore((s) => s.entities);
  const entity = useMemo(() => entities.find((e) => e.id === trustId), [entities, trustId]);
  const trustAddress = entity?.trust_address ?? null;

  const {
    tokenModuleState,
    mint,
    mintAddress,
    holders,
    vesting,
    fundingRequests,
    isLoading,
    error,
    isFoundation,
  } = useEquity(trustAddress);

  // ── Pre-bridge state: entity exists but has no on-chain mirror yet.
  if (!trustAddress) {
    return (
      <Page>
        <PageHeader title="Equity" description="The TRUST's cap table." />
        <PageBody>
          <EmptyState
            title="Not yet on-chain"
            description="This entity does not have a TRUST proxy address yet. Once the click-to-DAO bridge fires, the on-chain cap table will render here."
          />
        </PageBody>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page>
        <PageHeader title="Equity" description="The TRUST's cap table." />
        <PageBody>
          <Loading variant="section" label="Reading on-chain cap table" />
        </PageBody>
      </Page>
    );
  }

  if (error) {
    return (
      <Page>
        <PageHeader title="Equity" description="The TRUST's cap table." />
        <PageBody>
          <EmptyState
            title="Couldn't read cap table"
            description={error.message || "The RPC call to the configured Solana cluster failed."}
          />
        </PageBody>
      </Page>
    );
  }

  // ── Foundation TRUST: no equity module deployed. Quiet empty state +
  //    pointer to the path that DOES issue equity (start a Company).
  if (isFoundation) {
    return (
      <Page>
        <PageHeader title="Equity" description="The TRUST's cap table." />
        <PageBody>
          <EmptyState
            title="This TRUST has no equity module"
            description="Equity issuance is a Company feature — personal TRUSTs are Foundation-shape and don't carry a cap table."
            action={<Link to="/start">+ New Company</Link>}
          />
        </PageBody>
      </Page>
    );
  }

  // Defensive: `useEquity` only marks `isFoundation` when the module
  // query resolved with `null`. If `tokenModuleState` is present but the
  // mint fetch returned null (shouldn't happen on a healthy cluster —
  // the module's `mint` field IS the PDA), render an honest empty
  // state instead of crashing the decimals math below.
  if (!tokenModuleState || !mint || !mintAddress) {
    return (
      <Page>
        <PageHeader title="Equity" description="The TRUST's cap table." />
        <PageBody>
          <EmptyState
            title="Cap-table mint not found"
            description={`TokenModuleState exists at this TRUST but the mint account at ${mintAddress ? shortAddress(mintAddress) : "the derived PDA"} is missing on the configured cluster. Check that the RPC URL matches the cluster the TRUST was deployed to.`}
          />
        </PageBody>
      </Page>
    );
  }

  return (
    <EquityPrefillProvider>
      <Page>
        <PageHeader title="Equity" description="The TRUST's cap table." />
        <PageBody>
          {/* Coherent ownership story top-to-bottom:
           *   1. Mint identity — the on-chain anchor for this cap table.
           *   2. Cap table — who holds what right now (row menu → prefill
           *      Share/Vesting forms below).
           *   3. Share controls — mint / transfer / burn (the primary
           *      action surface against the cap table above).
           *   4. Genesis curve — live linear bonding curve + Buy/Sell.
           *   5. Funding round — declare a structured raise + see what's
           *      already declared.
           *   6. Vesting positions — outstanding grants tied to this mint.
           *   7. Grant vesting — issue a new position.
           */}
          <MintIdentitySection
            mintAddress={mintAddress}
            supply={mint.supply}
            decimals={mint.decimals}
            maxSupplyCap={tokenModuleState.maxSupplyCap}
            mintAuthority={mint.mintAuthority}
            freezeAuthority={mint.freezeAuthority}
          />
          <CapTableSection
            holders={holders ?? []}
            totalSupply={mint.supply}
            decimals={mint.decimals}
            vestingPositions={vesting ?? []}
          />
          <EquityShareControls trustId={trustId} />
          <EquityGenesisCurveSection trustId={trustId} />
          <EquityFundingRoundControl trustId={trustId} declaredRounds={fundingRequests ?? []} />
          <VestingSection trustId={trustId} positions={vesting ?? []} decimals={mint.decimals} />
          <EquityVestingControls trustId={trustId} holders={holders ?? []} />
        </PageBody>
      </Page>
    </EquityPrefillProvider>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Sections                                                            */
/* ────────────────────────────────────────────────────────────────── */

/* Toolbar glyphs — match the canonical set used by Agents/Ideas/Quests
   toolbars so the cap-table sort/filter affordance reads identically to
   every other "view this primitive" surface in the app. */
const CAP_TABLE_GLYPHS = {
  sort: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path d="M3 3.5h7M3 6.5h5M3 9.5h3" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  filter: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path d="M2 3.25h9M3.5 6.5h6M5 9.75h3" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  ),
};

/* Cap-table sort options. `largest` is iter-3's default; `smallest` and
   `address` give the operator a way to find tiny holdings + spot
   address-sort patterns when reconciling against an external list. */
type CapTableSort = "largest" | "smallest" | "address";
const CAP_TABLE_SORT_LABELS: Record<CapTableSort, string> = {
  largest: "Largest first",
  smallest: "Smallest first",
  address: "By address",
};

/* Cap-table filters. `vested` and `no_vesting` lean on the
   page-wide vesting list — same plumbing the drawer uses. */
type CapTableFilter = "all" | "vested" | "no_vesting";
const CAP_TABLE_FILTER_LABELS: Record<CapTableFilter, string> = {
  all: "All holders",
  vested: "With vesting",
  no_vesting: "No vesting",
};

function CapTableSection({
  holders,
  totalSupply,
  decimals,
  vestingPositions,
}: {
  holders: TokenHolder[];
  totalSupply: bigint;
  decimals: number;
  vestingPositions: VestingPositionWithPda[];
}) {
  const { mintTo, transferTo, vestingRecipient } = useEquityPrefill();
  const [drawerHolder, setDrawerHolder] = useState<TokenHolder | null>(null);
  const [sort, setSort] = useState<CapTableSort>("largest");
  const [filter, setFilter] = useState<CapTableFilter>("all");

  // Pre-compute "owners with at least one vesting position" — sub-linear
  // for cap-table filters. Built once per vesting list change.
  const vestedOwners = useMemo(() => {
    const set = new Set<string>();
    for (const p of vestingPositions) set.add(p.account.recipient.toBase58());
    return set;
  }, [vestingPositions]);

  const filteredHolders = useMemo(() => {
    const after = holders.filter((h) => {
      if (filter === "all") return true;
      const isVested = vestedOwners.has(h.owner.toBase58());
      return filter === "vested" ? isVested : !isVested;
    });
    return [...after].sort((a, b) => {
      if (sort === "largest") {
        if (a.amount === b.amount) return 0;
        return a.amount > b.amount ? -1 : 1;
      }
      if (sort === "smallest") {
        if (a.amount === b.amount) return 0;
        return a.amount < b.amount ? -1 : 1;
      }
      return a.owner.toBase58().localeCompare(b.owner.toBase58());
    });
  }, [holders, filter, sort, vestedOwners]);

  const columns: Array<TableColumn<TokenHolder>> = [
    {
      key: "owner",
      header: "Holder",
      cell: (row) => {
        const owner = row.owner.toBase58();
        const hasVesting = vestedOwners.has(owner);
        return (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-2)" }}>
            <CopyableMono full={owner} display={shortAddress(owner)} />
            {hasVesting && (
              <Tooltip content="Holder has at least one vesting position.">
                <span
                  aria-label="Has vesting"
                  style={{
                    display: "inline-block",
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--color-success)",
                  }}
                />
              </Tooltip>
            )}
          </span>
        );
      },
    },
    {
      key: "amount",
      header: "Amount",
      align: "end",
      cell: (row) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatBaseUnits(row.amount, decimals)}
        </span>
      ),
    },
    {
      key: "percent",
      header: "% of supply",
      align: "end",
      cell: (row) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatPercent(row.amount, totalSupply)}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      align: "end",
      cell: (row) => {
        const owner = row.owner.toBase58();
        return (
          <Menu
            trigger={
              <button
                type="button"
                aria-label={`Holder actions for ${shortAddress(owner)}`}
                /* Prevent the row-click drawer from opening when the
                   operator is targeting the menu trigger. The Table
                   primitive's onRowClick fires on the row's onClick;
                   stopping propagation here keeps the drawer closed. */
                onClick={(e) => e.stopPropagation()}
                style={{
                  background: "transparent",
                  border: 0,
                  color: "var(--color-text-muted)",
                  cursor: "pointer",
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--text-sm)",
                  padding: "0 var(--space-2)",
                  lineHeight: 1,
                }}
              >
                ⋯
              </button>
            }
            items={[
              {
                key: "open",
                label: "Open holder",
                onSelect: () => setDrawerHolder(row),
              },
              {
                key: "mint",
                label: "Mint more to holder",
                onSelect: () => mintTo(owner),
              },
              {
                key: "transfer",
                label: "Transfer to holder",
                onSelect: () => transferTo(owner),
              },
              {
                key: "vesting",
                label: "Grant vesting to holder",
                onSelect: () => vestingRecipient(owner),
              },
            ]}
          />
        );
      },
    },
  ];

  const description = useMemo(() => {
    if (holders.length === 0) {
      return "No holders yet — mint the first LAUNCH from Share controls below.";
    }
    const total = holders.length;
    const shown = filteredHolders.length;
    const noun = total === 1 ? "holder" : "holders";
    if (filter === "all") {
      return `${total} ${noun}. Click a row to open the holder drawer; ⋯ menu prefills the action forms below.`;
    }
    return `${shown} of ${total} ${noun} match the active filter.`;
  }, [holders.length, filteredHolders.length, filter]);

  return (
    <>
      <PageSection
        title="Cap table"
        description={description}
        actions={
          holders.length > 1 ? (
            <span style={{ display: "inline-flex", gap: "var(--space-2)", alignItems: "center" }}>
              <ToolbarRadioPopover
                label="Sort"
                current={CAP_TABLE_SORT_LABELS[sort]}
                glyph={CAP_TABLE_GLYPHS.sort}
                options={(Object.keys(CAP_TABLE_SORT_LABELS) as CapTableSort[]).map((id) => ({
                  id,
                  label: CAP_TABLE_SORT_LABELS[id],
                }))}
                value={sort}
                onChange={(next) => setSort(next as CapTableSort)}
              />
              <ToolbarRadioPopover
                label="Filter"
                current={CAP_TABLE_FILTER_LABELS[filter]}
                glyph={CAP_TABLE_GLYPHS.filter}
                options={(Object.keys(CAP_TABLE_FILTER_LABELS) as CapTableFilter[]).map((id) => ({
                  id,
                  label: CAP_TABLE_FILTER_LABELS[id],
                }))}
                value={filter}
                onChange={(next) => setFilter(next as CapTableFilter)}
                indicator={filter !== "all"}
              />
            </span>
          ) : undefined
        }
      >
        <Table
          columns={columns}
          data={filteredHolders}
          rowKey={(row) => row.tokenAccount.toBase58()}
          onRowClick={(row) => setDrawerHolder(row)}
          empty={
            <EmptyState
              title={filter === "all" ? "No holders" : "No holders match the filter"}
              description={
                filter === "all"
                  ? "Once the cap-table token is minted to a wallet, holders appear here."
                  : "Try clearing the filter or grant a vesting position from the form below."
              }
            />
          }
          ariaLabel="Cap table holders"
        />
      </PageSection>
      <HolderDrawer
        holder={drawerHolder}
        totalSupply={totalSupply}
        decimals={decimals}
        vestingPositions={vestingPositions}
        onClose={() => setDrawerHolder(null)}
      />
    </>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Helpers                                                             */
/* ────────────────────────────────────────────────────────────────── */

function CopyableMono({ full, display }: { full: string; display: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.SyntheticEvent) => {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard.writeText(full);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };
  return (
    <Tooltip content={copied ? "Copied" : "Copy"}>
      <span
        role="button"
        tabIndex={0}
        onClick={handleCopy}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") handleCopy(e);
        }}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-sm)",
          cursor: "pointer",
        }}
      >
        {display}
        {copied ? " ✓" : ""}
      </span>
    </Tooltip>
  );
}

function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Format a raw base-unit amount with the given decimals into a
 * human-readable token quantity. Splits at the decimal place, groups
 * the integer part with thousands separators, and trims trailing zeros
 * in the fractional part so "100000000.000000000" renders as
 * "100,000,000".
 *
 * Why not `formatInteger` (from `@/lib/i18n`)? Cap-table token amounts
 * can exceed `Number.MAX_SAFE_INTEGER` (a 9-decimal mint with 1B supply
 * = 10^18 base units, well past 2^53). `Intl.NumberFormat` supports
 * `bigint` natively, but the project's i18n helpers take `number`.
 * The manual grouping below stays exact for any size bigint.
 */
function formatBaseUnits(amount: bigint, decimals: number): string {
  if (decimals === 0) return groupThousands(amount.toString());
  const divisor = 10n ** BigInt(decimals);
  const integerPart = amount / divisor;
  const fractionalPart = amount % divisor;
  const integerStr = groupThousands(integerPart.toString());
  if (fractionalPart === 0n) return integerStr;
  const fracStr = fractionalPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${integerStr}.${fracStr}` : integerStr;
}

/**
 * Insert `,` thousands separators into a digit string. Locale-neutral
 * by design — the project's i18n helpers can't handle bigint, and this
 * function is only used for non-localized numeric formatting.
 */
function groupThousands(digits: string): string {
  if (digits.length <= 3) return digits;
  const isNegative = digits.startsWith("-");
  const body = isNegative ? digits.slice(1) : digits;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return isNegative ? `-${grouped}` : grouped;
}

/**
 * Render `holderAmount / totalSupply` as a two-decimal percentage.
 * Falls back to "—" when supply is zero (avoid divide-by-zero on a
 * never-minted mint; the cap-table section should be empty in that
 * case anyway, but the column renders defensively).
 */
function formatPercent(amount: bigint, total: bigint): string {
  if (total === 0n) return "—";
  // Scale to ten-thousandths then divide back — keeps two-decimal
  // precision without leaving bigint.
  const basisPoints = (amount * 10_000n) / total;
  const whole = basisPoints / 100n;
  const frac = basisPoints % 100n;
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}%`;
}
