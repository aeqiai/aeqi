import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { Button, EmptyState, Input, MetricCard, MetricGrid, PageSection } from "@/components/ui";
import "./EquityGenesisCurveSection.css";

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
 *
 * Phase 1a (ja-018): Buy button below the chart wires to the existing
 * `/api/solana/first-buy` endpoint (fixed 1.0 USDC amount). Sell +
 * custom amounts ship in Phase 1b once the platform-side
 * `/api/solana/curve-sell` endpoint lands.
 */
export function EquityGenesisCurveSection({ trustId }: { trustId: string }) {
  type CurveState = Awaited<ReturnType<typeof api.getCurveState>>;
  const [state, setState] = useState<CurveState | null>(null);
  const [missing, setMissing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // refreshTick bumps after a successful Buy/Sell so the curve state
  // re-fetches and the marker updates without a page reload.
  const [refreshTick, setRefreshTick] = useState(0);
  const [buying, setBuying] = useState(false);
  const [buySignature, setBuySignature] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  // Sell form — Phase 1b (ja-018b). `sellAmount` is the user-facing
  // pre-decimal string ("1.0"); converted to u64 base units against the
  // mint decimals when calling the endpoint. min_return defaults to 0
  // (no slippage protection); a future iteration can add a slippage
  // tolerance input.
  const [sellAmount, setSellAmount] = useState("");
  const [selling, setSelling] = useState(false);
  const [sellSignature, setSellSignature] = useState<string | null>(null);
  const [sellError, setSellError] = useState<string | null>(null);

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
  }, [trustId, refreshTick]);

  const handleBuy = async () => {
    setBuying(true);
    setBuyError(null);
    setBuySignature(null);
    try {
      const result = await api.tryUnifuturesFirstBuy({ entity_id: trustId });
      setBuySignature(result.signature_b58);
      setRefreshTick((t) => t + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Buy failed.";
      setBuyError(message);
    } finally {
      setBuying(false);
    }
  };

  // 6 decimals is the canonical mint setup
  // (`DEFAULT_TOKEN_DECIMALS = 6` in aeqi_token). Hard-coding here
  // avoids an extra round-trip through `useEquity` for a value that's
  // fixed at provisioning time. If the on-chain default ever changes,
  // this constant moves to a shared `solana/constants` module.
  const TOKEN_DECIMALS = 6;
  const sellAmountBaseUnits = useMemo(() => {
    const trimmed = sellAmount.trim();
    if (!trimmed) return null;
    // Reject anything that isn't a non-negative decimal — bad input
    // surfaces as a disabled button rather than a server-side rejection.
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const [integerPart, fractionalPart = ""] = trimmed.split(".");
    const padded = fractionalPart.padEnd(TOKEN_DECIMALS, "0").slice(0, TOKEN_DECIMALS);
    const combined = `${integerPart}${padded}`.replace(/^0+(?=\d)/, "");
    try {
      const value = BigInt(combined);
      return value > 0n ? value : null;
    } catch {
      return null;
    }
  }, [sellAmount]);

  const handleSell = async () => {
    if (sellAmountBaseUnits === null) return;
    setSelling(true);
    setSellError(null);
    setSellSignature(null);
    try {
      // u64 fits in JS Number for any amount up to ~9e15 base units
      // (= 9 billion LAUNCH at 6 decimals); GENESIS_CURVE_MAX_SUPPLY is
      // 1e12 base units. Number coercion is safe for every legal value.
      const result = await api.curveSell({
        entity_id: trustId,
        token_amount: Number(sellAmountBaseUnits),
      });
      setSellSignature(result.signature_b58);
      setSellAmount("");
      setRefreshTick((t) => t + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sell failed.";
      setSellError(message);
    } finally {
      setSelling(false);
    }
  };

  // Foundation TRUSTs and partially-provisioned ventures: the on-chain
  // curve PDA is not backed yet. Surface a quiet empty state rather than
  // hiding the section silently — Equity readers expect to see "why" the
  // chart isn't here.
  if (missing) {
    return (
      <PageSection
        title="Genesis curve"
        description="Live linear bonding curve for the LAUNCH cap-table token."
      >
        <EmptyState
          title="Curve not provisioned yet"
          description="This TRUST's bonding-curve PDA is not backed on the configured cluster. Once provisioning lands, the live curve and Buy/Sell rails appear here."
        />
      </PageSection>
    );
  }
  if (loadError) {
    return (
      <PageSection
        title="Genesis curve"
        description="Live linear bonding curve for the LAUNCH cap-table token."
      >
        <EmptyState title="Couldn't read curve state" description={loadError} />
      </PageSection>
    );
  }
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
        recentTrades={state.recent_trades ?? []}
      />
      <MetricGrid columns={3}>
        <MetricCard
          label="Current price"
          value={
            <span className="curve-metric-value">
              {formatCurvePrice(BigInt(state.current_price))}
              <span className="curve-metric-unit"> USDC</span>
            </span>
          }
        />
        <MetricCard
          label="Supply minted"
          value={
            <span className="curve-metric-value">
              {formatCurveSupply(BigInt(state.current_supply), BigInt(state.max_supply))}
            </span>
          }
          detail={`${formatCurveSupplyPercent(BigInt(state.current_supply), BigInt(state.max_supply))} of cap`}
        />
        <MetricCard
          label="Reserve balance"
          value={
            <span className="curve-metric-value">
              {formatCurvePrice(BigInt(state.reserve_balance))}
              <span className="curve-metric-unit"> USDC</span>
            </span>
          }
        />
      </MetricGrid>
      <div className="curve-trade-row curve-trade-row--first">
        <Button variant="primary" size="sm" loading={buying} onClick={handleBuy}>
          Buy 1 USDC of LAUNCH
        </Button>
        <TradeStatus
          signature={buySignature}
          error={buyError}
          idle="Mints 1.0 LAUNCH at the current curve price."
        />
      </div>
      <div className="curve-trade-row">
        <Input
          label="Sell amount"
          inputMode="decimal"
          placeholder="0.0"
          value={sellAmount}
          onChange={(e) => setSellAmount(e.target.value)}
          disabled={selling}
          size="sm"
        />
        <Button
          variant="secondary"
          size="sm"
          loading={selling}
          disabled={sellAmountBaseUnits === null}
          onClick={handleSell}
        >
          Sell LAUNCH
        </Button>
        <TradeStatus
          signature={sellSignature}
          error={sellError}
          idle="Burns the amount back to the curve at the current price."
        />
      </div>
      <RecentTradesLog trades={state.recent_trades ?? []} />
    </PageSection>
  );
}

/**
 * Recent trades — compact tabular log under the curve. Mirrors the chart
 * dot affordance (jade=buy, warmth=sell) so the eye can pivot between
 * the chart marker and the row that produced it. Hidden when the
 * indexer flagged the projection unavailable OR there are no trades.
 */
function RecentTradesLog({
  trades,
}: {
  trades: Array<{
    kind: "buy" | "sell";
    counterparty_b58: string;
    token_amount: string;
    quote_amount: string;
    slot: number;
    signature_b58: string;
    log_index: number;
  }>;
}) {
  if (trades.length === 0) return null;
  // Cap at the most recent 8 — the chart already plots dots for the full
  // window. The log is for the operator who wants names + sigs, not a
  // full ledger.
  const rows = trades.slice(0, 8);
  return (
    <div className="curve-trades-log">
      <h3 className="curve-trades-log__title">Recent trades</h3>
      <ul className="curve-trades-log__list">
        {rows.map((trade) => {
          let tokenAmount: bigint;
          let quoteAmount: bigint;
          try {
            tokenAmount = BigInt(trade.token_amount);
            quoteAmount = BigInt(trade.quote_amount);
          } catch {
            return null;
          }
          return (
            <li key={`${trade.signature_b58}-${trade.log_index}`} className="curve-trades-log__row">
              <span
                className={
                  trade.kind === "buy"
                    ? "curve-trades-log__dot curve-trades-log__dot--buy"
                    : "curve-trades-log__dot curve-trades-log__dot--sell"
                }
                aria-hidden="true"
              />
              <span className="curve-trades-log__kind">
                {trade.kind === "buy" ? "Buy" : "Sell"}
              </span>
              <span className="curve-trades-log__counterparty">
                {formatCurveAddress(trade.counterparty_b58)}
              </span>
              <span className="curve-trades-log__amount">
                {formatBigintCompact(tokenAmount)} LAUNCH
              </span>
              <span className="curve-trades-log__quote">{formatCurvePrice(quoteAmount)} USDC</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Inline SVG line chart for a linear bonding curve. ~50 lines instead
 * of the ~150kB recharts dep — single-purpose primitive doesn't justify
 * the bundle weight. Coordinates use a fixed 600×220 viewBox; the SVG
 * scales responsively to the container width via `width: 100%`.
 */
function CurveChart({
  startPrice,
  endPrice,
  currentPrice,
  maxSupply,
  currentSupply,
  recentTrades,
}: {
  startPrice: bigint;
  endPrice: bigint;
  currentPrice: bigint;
  maxSupply: bigint;
  currentSupply: bigint;
  recentTrades: Array<{
    kind: "buy" | "sell";
    counterparty_b58: string;
    token_amount: string;
    quote_amount: string;
    slot: number;
    signature_b58: string;
    log_index: number;
  }>;
}) {
  const W = 600;
  const H = 220;
  const PAD_L = 12;
  const PAD_R = 12;
  const PAD_T = 16;
  const PAD_B = 24;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const supplySafe = maxSupply === 0n ? 1n : maxSupply;
  const priceSpan = endPrice > startPrice ? endPrice - startPrice : 1n;

  const xForSupply = (supply: bigint): number => {
    const ratio = Number(supply) / Number(supplySafe);
    return PAD_L + Math.max(0, Math.min(1, ratio)) * innerW;
  };
  const yForPrice = (price: bigint): number => {
    const delta = price >= startPrice ? price - startPrice : 0n;
    const ratio = Number(delta) / Number(priceSpan);
    return PAD_T + (1 - Math.max(0, Math.min(1, ratio))) * innerH;
  };

  const xStart = xForSupply(0n);
  const yStart = yForPrice(startPrice);
  const xEnd = xForSupply(maxSupply);
  const yEnd = yForPrice(endPrice);
  const xCur = xForSupply(currentSupply);
  const yCur = yForPrice(currentPrice);

  const areaPath = `M ${xStart} ${PAD_T + innerH} L ${xStart} ${yStart} L ${xEnd} ${yEnd} L ${xEnd} ${PAD_T + innerH} Z`;
  const linePath = `M ${xStart} ${yStart} L ${xEnd} ${yEnd}`;

  // Inline helper used by tradeDots: linear interpolation of price across
  // the supply axis. Mirrors the on-chain math
  // `start + (end - start) * supply / max_supply` so dot Y-positions sit
  // on the rendered linear curve segment.
  const priceForSupply = (supply: bigint): bigint => {
    if (supplySafe === 0n) return startPrice;
    const span = endPrice >= startPrice ? endPrice - startPrice : 0n;
    return startPrice + (span * supply) / supplySafe;
  };

  // ja-017: compute supply-at-trade by integrating trades in slot order
  // (oldest → newest, buys add, sells subtract). API returns DESC; we
  // walk it as-is and step `runningSupply` BACKWARDS to recover the
  // supply state at each historic trade.
  const tradeDots = (() => {
    if (recentTrades.length === 0)
      return [] as Array<{
        x: number;
        y: number;
        kind: "buy" | "sell";
        signature_b58: string;
        tokenAmount: bigint;
        quoteAmount: bigint;
      }>;
    // Start from the live current_supply and walk BACKWARDS through the
    // DESC-ordered trades to recover the supply state at each trade.
    // For a buy: supply_before = supply_after - token_amount.
    // For a sell: supply_before = supply_after + token_amount.
    // We snapshot supply_at_trade as the post-trade supply value, since
    // that's "where the curve was after this trade landed".
    let runningSupply = currentSupply;
    const dots: Array<{
      x: number;
      y: number;
      kind: "buy" | "sell";
      signature_b58: string;
      tokenAmount: bigint;
      quoteAmount: bigint;
    }> = [];
    for (const trade of recentTrades) {
      let tokenAmount: bigint;
      let quoteAmount: bigint;
      try {
        tokenAmount = BigInt(trade.token_amount);
        quoteAmount = BigInt(trade.quote_amount);
      } catch {
        continue;
      }
      // Post-trade supply (what we render the dot against).
      const supplyAtTrade = runningSupply;
      dots.push({
        x: xForSupply(supplyAtTrade),
        y: yForPrice(priceForSupply(supplyAtTrade)),
        kind: trade.kind,
        signature_b58: trade.signature_b58,
        tokenAmount,
        quoteAmount,
      });
      // Step backwards to recover supply_before this trade.
      if (trade.kind === "buy") {
        runningSupply = runningSupply > tokenAmount ? runningSupply - tokenAmount : 0n;
      } else {
        runningSupply = runningSupply + tokenAmount;
      }
    }
    return dots;
  })();

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
      <line
        x1={PAD_L}
        x2={W - PAD_R}
        y1={PAD_T + innerH}
        y2={PAD_T + innerH}
        stroke="var(--border-muted, var(--border))"
        strokeWidth={1}
      />
      <path d={areaPath} fill="var(--accent)" fillOpacity={0.08} />
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} />
      {/* ja-017: trade dots — green = buy, red = sell. Rendered under the
          current-supply marker so the live position remains the dominant
          visual anchor. Hover `<title>` surfaces the trade payload. */}
      {tradeDots.map((dot, i) => (
        <circle
          key={`${dot.signature_b58}-${i}`}
          cx={dot.x}
          cy={dot.y}
          r={3.5}
          fill={dot.kind === "buy" ? "var(--color-success)" : "var(--color-warning)"}
          stroke="var(--color-card)"
          strokeWidth={1}
          opacity={0.85}
        >
          <title>
            {dot.kind === "buy" ? "Buy" : "Sell"} · {formatBigintCompact(dot.tokenAmount)} LAUNCH
            for {formatCurvePrice(dot.quoteAmount)} USDC · {formatCurveAddress(dot.signature_b58)}
          </title>
        </circle>
      ))}
      <line
        x1={xCur}
        x2={xCur}
        y1={yCur}
        y2={PAD_T + innerH}
        stroke="var(--border)"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <circle
        cx={xCur}
        cy={yCur}
        r={5}
        fill="var(--accent)"
        stroke="var(--color-card)"
        strokeWidth={2}
      />
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
  const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
}

/** Compact summary of supply progress: "100,000 / 1,000,000,000,000". */
function formatCurveSupply(current: bigint, max: bigint): string {
  return `${groupThousands(current.toString())} / ${groupThousands(max.toString())}`;
}

/**
 * Render `current / max` as a two-decimal percentage. Two-decimal
 * resolution matters early in the curve where supply / max_supply rounds
 * to 0.00% for any value < ~10^10 base units on a 10^12 cap.
 */
function formatCurveSupplyPercent(current: bigint, max: bigint): string {
  if (max === 0n) return "—";
  // basisPoints out of 1_000_000 keeps 4 fractional digits of precision
  // and renders as XX.XX%.
  const tenThousandths = (current * 1_000_000n) / max;
  const whole = tenThousandths / 10_000n;
  const frac = tenThousandths % 10_000n;
  const fracStr = frac.toString().padStart(4, "0").slice(0, 2);
  return `${whole.toString()}.${fracStr}%`;
}

/** Truncate a base58 pubkey to "8Yvuqq…SdWQ" shape. */
function formatCurveAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * SI-style compact rendering for large bigints. `Number()` coercion is
 * safe for values bounded by `GENESIS_CURVE_MAX_SUPPLY` (1e12, well
 * under 2^53).
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

/**
 * Status line for a trade action (Buy or Sell). Three states share one
 * row: idle (help text), pending → settled (signature suffix), or error.
 * Lives next to the section to keep the row layout cohesive — no need
 * to lift into the general UI primitives until a second consumer shows
 * up.
 */
function TradeStatus({
  signature,
  error,
  idle,
}: {
  signature: string | null;
  error: string | null;
  idle: string;
}) {
  if (signature) {
    return (
      <span className="curve-trade-status curve-trade-status--signature">
        ✓ Settled · {formatCurveAddress(signature)}
      </span>
    );
  }
  if (error) {
    return <span className="curve-trade-status curve-trade-status--error">{error}</span>;
  }
  return <span className="curve-trade-status">{idle}</span>;
}

/** Insert `,` thousands separators into a digit string. */
function groupThousands(digits: string): string {
  if (digits.length <= 3) return digits;
  const isNegative = digits.startsWith("-");
  const body = isNegative ? digits.slice(1) : digits;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return isNegative ? `-${grouped}` : grouped;
}
