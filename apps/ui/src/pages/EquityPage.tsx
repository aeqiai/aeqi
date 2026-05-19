import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { useDaemonStore } from "@/store/daemon";
import { useEquity } from "@/hooks/useEquity";
import { api } from "@/lib/api";
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
        <GenesisCurveSection trustId={trustId} />
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

/**
 * Genesis curve — live BondingCurve state pulled from the platform's
 * `/api/curves/{trust_id}/state` route (ja-016 platform half, 6f3933f).
 *
 * Renders only when the curve PDA is fully provisioned on chain. The
 * 409 `curve_not_provisioned` case (Foundation TRUSTs, ledger-reset
 * stranded placements, partially-provisioned ventures) silently hides
 * the section — Equity is the right home for "Venture token state" and
 * the rest of the page (mint, cap table, vesting) already renders the
 * non-curve view.
 *
 * Chart: inline SVG (no recharts dep). For linear curves
 * (`curve_type === 0`) plot price = start_price + (end_price -
 * start_price) * (supply / max_supply) over [0, max_supply], with a
 * marker dot at (current_supply, current_price) and a faint vertical
 * guide. u128 prices arrive as decimal strings — parsed to BigInt for
 * math, rendered as decimal-USDC labels (10^18 internal scaling per
 * `CURVE_PRICE_ONE_USDC`).
 */
function GenesisCurveSection({ trustId }: { trustId: string }) {
  type CurveState = Awaited<ReturnType<typeof api.getCurveState>>;
  const [state, setState] = useState<CurveState | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await api.getCurveState(trustId);
        if (cancelled) return;
        setState(next);
        setMissing(false);
        setLoadError(null);
      } catch (err) {
        if (cancelled) return;
        // 409 `curve_not_provisioned` is an expected state, not an
        // error worth surfacing — Foundation TRUSTs hit it, and so do
        // Venture TRUSTs whose on-chain curve hasn't landed yet.
        const message = err instanceof Error ? err.message : "";
        if (message.includes("curve_not_provisioned")) {
          setMissing(true);
          setLoadError(null);
        } else {
          setLoadError(message || "Failed to load curve state.");
        }
        setState(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [trustId]);

  if (missing) return null;
  if (loadError) return null;
  if (!state) return null;

  return (
    <PageSection
      title="Genesis curve"
      description={`Linear bonding curve · ${formatCurveAddress(state.curve_pubkey_b58)}`}
    >
      <CurveChart
        startPrice={BigInt(state.start_price)}
        endPrice={BigInt(state.end_price)}
        currentPrice={BigInt(state.current_price)}
        maxSupply={BigInt(state.max_supply)}
        currentSupply={BigInt(state.current_supply)}
      />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
          gap: "var(--space-3)",
          marginTop: "var(--space-3)",
        }}
      >
        <DetailField label="Current price">
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCurvePrice(BigInt(state.current_price))} USDC
          </span>
        </DetailField>
        <DetailField label="Supply minted">
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCurveSupply(BigInt(state.current_supply), BigInt(state.max_supply))}
          </span>
        </DetailField>
        <DetailField label="Reserve balance">
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatCurvePrice(BigInt(state.reserve_balance))} USDC
          </span>
        </DetailField>
      </div>
    </PageSection>
  );
}

/**
 * Inline SVG line chart for a linear bonding curve. ~50 lines instead
 * of the ~150kB recharts dep — single-purpose primitive doesn't justify
 * the bundle weight. Coordinates use a fixed 600×220 viewBox; the SVG
 * scales responsively to the container width via `width: 100%`.
 *
 * Math: y(supply) = start + (end - start) * (supply / max). bigint
 * inputs (u128 over the wire) are normalized to floats only at SVG-
 * coordinate time — far below any float-precision concerns for the
 * value ranges the curve permits.
 */
function CurveChart({
  startPrice,
  endPrice,
  currentPrice,
  maxSupply,
  currentSupply,
}: {
  startPrice: bigint;
  endPrice: bigint;
  currentPrice: bigint;
  maxSupply: bigint;
  currentSupply: bigint;
}) {
  const W = 600;
  const H = 220;
  const PAD_L = 12;
  const PAD_R = 12;
  const PAD_T = 16;
  const PAD_B = 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  // Defensive guards — render a flat line if max_supply or price span is 0.
  const supplySafe = maxSupply === 0n ? 1n : maxSupply;
  const priceSpan = endPrice > startPrice ? endPrice - startPrice : 1n;

  const xForSupply = (supply: bigint): number => {
    const ratio = Number(supply) / Number(supplySafe);
    return PAD_L + Math.max(0, Math.min(1, ratio)) * innerW;
  };
  const yForPrice = (price: bigint): number => {
    const delta = price >= startPrice ? price - startPrice : 0n;
    const ratio = Number(delta) / Number(priceSpan);
    // y axis inverted — higher price = lower y coordinate.
    return PAD_T + (1 - Math.max(0, Math.min(1, ratio))) * innerH;
  };

  const xStart = xForSupply(0n);
  const yStart = yForPrice(startPrice);
  const xEnd = xForSupply(maxSupply);
  const yEnd = yForPrice(endPrice);
  const xCur = xForSupply(currentSupply);
  const yCur = yForPrice(currentPrice);

  // Filled area below the curve — anchors at the bottom-left and
  // bottom-right of the inner plot, sweeps across the line. Low-opacity
  // fill so the line stays the primary signal.
  const areaPath = `M ${xStart} ${PAD_T + innerH} L ${xStart} ${yStart} L ${xEnd} ${yEnd} L ${xEnd} ${PAD_T + innerH} Z`;
  const linePath = `M ${xStart} ${yStart} L ${xEnd} ${yEnd}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      style={{
        display: "block",
        maxWidth: "100%",
        backgroundColor: "var(--bg-subtle)",
        borderRadius: "var(--radius-md)",
      }}
      role="img"
      aria-label="Genesis curve price-vs-supply"
    >
      {/* Bottom baseline */}
      <line
        x1={PAD_L}
        x2={W - PAD_R}
        y1={PAD_T + innerH}
        y2={PAD_T + innerH}
        stroke="var(--border-muted, var(--border))"
        strokeWidth={1}
      />
      {/* Area + line */}
      <path d={areaPath} fill="var(--accent)" fillOpacity={0.08} />
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {/* Vertical guide at current supply */}
      <line
        x1={xCur}
        x2={xCur}
        y1={yCur}
        y2={PAD_T + innerH}
        stroke="var(--border)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      {/* Current-supply marker */}
      <circle
        cx={xCur}
        cy={yCur}
        r={5}
        fill="var(--accent)"
        stroke="var(--color-card)"
        strokeWidth={2}
      />
      {/* Endpoint labels */}
      <text
        x={PAD_L + 4}
        y={yStart - 6}
        fontSize="11"
        fill="var(--text-muted)"
        fontFamily="var(--font-mono)"
      >
        {formatCurvePrice(startPrice)}
      </text>
      <text
        x={W - PAD_R - 4}
        y={yEnd - 6}
        fontSize="11"
        fill="var(--text-muted)"
        fontFamily="var(--font-mono)"
        textAnchor="end"
      >
        {formatCurvePrice(endPrice)}
      </text>
      <text
        x={PAD_L + 4}
        y={H - 6}
        fontSize="11"
        fill="var(--text-muted)"
        fontFamily="var(--font-mono)"
      >
        0
      </text>
      <text
        x={W - PAD_R - 4}
        y={H - 6}
        fontSize="11"
        fill="var(--text-muted)"
        fontFamily="var(--font-mono)"
        textAnchor="end"
      >
        {formatBigintCompact(maxSupply)}
      </text>
    </svg>
  );
}

/**
 * Curve prices live in u128 micro-USDC scaled by 10^18 per the
 * `CURVE_PRICE_ONE_USDC` on-chain constant. Render as a fixed-precision
 * USDC quantity with up to 4 fractional digits, trimming trailing zeros.
 * Returns "0" for the zero price.
 */
function formatCurvePrice(price: bigint): string {
  if (price === 0n) return "0";
  const scale = 1_000_000_000_000_000_000n; // 1e18
  const whole = price / scale;
  const frac = price % scale;
  if (frac === 0n) return whole.toString();
  // 4-digit fractional precision — enough to disambiguate $1.0000 from
  // $1.5000 on the genesis-curve scale; trailing zeros trimmed.
  const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
}

/**
 * Compact summary of supply progress: "100,000 / 1,000,000,000,000" for
 * easy at-a-glance read on the chart caption.
 */
function formatCurveSupply(current: bigint, max: bigint): string {
  return `${groupThousands(current.toString())} / ${groupThousands(max.toString())}`;
}

/**
 * Truncate a base58 curve pubkey to "8Yvuqq…SdWQ" shape for the
 * section subtitle. Mirrors the existing `shortAddress` helper but
 * lives standalone so the section doesn't depend on EquityPage's
 * top-level `shortAddress`.
 */
function formatCurveAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * SI-style compact rendering for large bigints (max_supply axis label).
 * Returns e.g. "1T" / "12.3B" / "456M" — Number coercion is safe up to
 * 2^53; max_supply is bounded by GENESIS_CURVE_MAX_SUPPLY = 1e12 which
 * sits well below that ceiling.
 */
function formatBigintCompact(value: bigint): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value.toString();
  if (n >= 1e12) return `${(n / 1e12).toFixed(n % 1e12 === 0 ? 0 : 1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}k`;
  return n.toString();
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
