import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { EquityGenesisCurveSection } from "@/components/EquityGenesisCurveSection";
import { useDaemonStore } from "@/store/daemon";
import { useEquity } from "@/hooks/useEquity";
import { formatShortDate } from "@/lib/i18n";
import type { TokenHolder, VestingPositionWithPda } from "@/solana";
import {
  Badge,
  DetailField,
  EmptyState,
  Loading,
  Page,
  PageBody,
  PageHeader,
  PageSection,
  Table,
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
 * Anti-scope: no write actions (mint, transfer, burn, vesting create or
 * claim), no bonding-curve UI (Overview's genesis-curve section owns
 * that), no share-class editor.
 */
export default function EquityPage({ trustId }: { trustId: string }) {
  const entities = useDaemonStore((s) => s.entities);
  const entity = useMemo(() => entities.find((e) => e.id === trustId), [entities, trustId]);
  const trustAddress = entity?.trust_address ?? null;

  const { tokenModuleState, mint, mintAddress, holders, vesting, isLoading, error, isFoundation } =
    useEquity(trustAddress);

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
    <Page>
      <PageHeader title="Equity" description="The TRUST's cap table." />
      <PageBody>
        <MintIdentitySection
          mintAddress={mintAddress}
          supply={mint.supply}
          decimals={mint.decimals}
          maxSupplyCap={tokenModuleState.maxSupplyCap}
        />
        <EquityGenesisCurveSection trustId={trustId} />
        <CapTableSection
          holders={holders ?? []}
          totalSupply={mint.supply}
          decimals={mint.decimals}
        />
        <VestingSection positions={vesting ?? []} decimals={mint.decimals} />
      </PageBody>
    </Page>
  );
}

/* ────────────────────────────────────────────────────────────────── */
/* Sections                                                            */
/* ────────────────────────────────────────────────────────────────── */

function MintIdentitySection({
  mintAddress,
  supply,
  decimals,
  maxSupplyCap,
}: {
  mintAddress: string;
  supply: bigint;
  decimals: number;
  maxSupplyCap: { toString(): string } | bigint;
}) {
  const capString = bnLikeToString(maxSupplyCap);
  const isUncapped = capString === "0";

  return (
    <PageSection title="Mint">
      <DetailField label="Mint address">
        <CopyableMono full={mintAddress} display={shortAddress(mintAddress)} />
      </DetailField>
      <DetailField label="Supply">
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatBaseUnits(supply, decimals)}
        </span>
      </DetailField>
      <DetailField label="Max supply cap">
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {isUncapped ? (
            <Badge variant="muted" size="sm">
              uncapped
            </Badge>
          ) : (
            formatBaseUnits(BigInt(capString), decimals)
          )}
        </span>
      </DetailField>
      <DetailField label="Decimals">
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{decimals}</span>
      </DetailField>
    </PageSection>
  );
}

function CapTableSection({
  holders,
  totalSupply,
  decimals,
}: {
  holders: TokenHolder[];
  totalSupply: bigint;
  decimals: number;
}) {
  const columns: Array<TableColumn<TokenHolder>> = [
    {
      key: "owner",
      header: "Holder",
      cell: (row) => (
        <CopyableMono full={row.owner.toBase58()} display={shortAddress(row.owner.toBase58())} />
      ),
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
  ];

  return (
    <PageSection
      title="Cap table"
      description={
        holders.length === 0
          ? "No holders yet."
          : `${holders.length} ${holders.length === 1 ? "holder" : "holders"}.`
      }
    >
      <Table
        columns={columns}
        data={holders}
        rowKey={(row) => row.tokenAccount.toBase58()}
        empty={
          <EmptyState
            title="No holders"
            description="Once the cap-table token is minted to a wallet, holders appear here."
          />
        }
        ariaLabel="Cap table holders"
      />
    </PageSection>
  );
}

function VestingSection({
  positions,
  decimals,
}: {
  positions: VestingPositionWithPda[];
  decimals: number;
}) {
  // Sort by end_time ascending so the soonest-to-fully-vest sits at the
  // top. Equal end_time falls back to recipient base58 for stability.
  const rows = useMemo(
    () =>
      [...positions].sort((a, b) => {
        const ae = bnLikeToBigInt(a.account.endTime);
        const be = bnLikeToBigInt(b.account.endTime);
        if (ae !== be) return ae < be ? -1 : 1;
        return a.account.recipient.toBase58().localeCompare(b.account.recipient.toBase58());
      }),
    [positions],
  );

  const columns: Array<TableColumn<VestingPositionWithPda>> = [
    {
      key: "recipient",
      header: "Recipient",
      cell: (row) => (
        <CopyableMono
          full={row.account.recipient.toBase58()}
          display={shortAddress(row.account.recipient.toBase58())}
        />
      ),
    },
    {
      key: "total",
      header: "Total",
      align: "end",
      cell: (row) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatBaseUnits(bnLikeToBigInt(row.account.totalAmount), decimals)}
        </span>
      ),
    },
    {
      key: "claimed",
      header: "Claimed",
      align: "end",
      cell: (row) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatBaseUnits(bnLikeToBigInt(row.account.claimedAmount), decimals)}
        </span>
      ),
    },
    {
      key: "endTime",
      header: "Ends",
      align: "end",
      cell: (row) => (
        <span style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatUnixTime(bnLikeToBigInt(row.account.endTime))}
        </span>
      ),
    },
  ];

  return (
    <PageSection
      title="Vesting"
      description={
        rows.length === 0
          ? "No vesting positions tied to this mint."
          : `${rows.length} ${rows.length === 1 ? "position" : "positions"} outstanding.`
      }
    >
      <Table
        columns={columns}
        data={rows}
        rowKey={(row) => row.publicKey.toBase58()}
        empty={
          <EmptyState
            title="No vesting positions"
            description="Vesting grants tied to the cap-table mint will appear here once issued."
          />
        }
        ariaLabel="Vesting positions"
      />
    </PageSection>
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
 * Anchor returns `u64` fields as either `bigint` (Anchor 0.31+ on web)
 * or `BN` (older runtimes); the spl-token `Mint.supply` is always
 * `bigint`. Coerce to a single canonical `bigint`.
 */
function bnLikeToBigInt(value: bigint | { toString(): string }): bigint {
  if (typeof value === "bigint") return value;
  return BigInt(value.toString());
}

function bnLikeToString(value: bigint | { toString(): string }): string {
  if (typeof value === "bigint") return value.toString();
  return value.toString();
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

/**
 * Format a unix timestamp (seconds, on-chain `i64`) as a short
 * locale-aware date. Returns "—" for sentinel zero (no end set) or any
 * value the i18n helper can't parse.
 */
function formatUnixTime(seconds: bigint): string {
  if (seconds === 0n) return "—";
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return "—";
  return formatShortDate(new Date(ms));
}
