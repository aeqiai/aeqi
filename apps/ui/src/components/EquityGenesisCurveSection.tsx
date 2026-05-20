import { useMemo, useState } from "react";

import { api } from "@/lib/api";
import { Button, EmptyState, Input, MetricCard, MetricGrid, PageSection } from "@/components/ui";
import { CurveChart } from "@/components/equity/CurveChart";
import {
  formatCurveAddress,
  formatCurvePrice,
  formatCurveSupply,
  formatCurveSupplyPercent,
} from "@/components/equity/curveFormatters";
import { RecentTradesLog } from "@/components/equity/RecentTradesLog";
import { useCurveTrades } from "@/hooks/useCurveTrades";
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
 * guide. iter-3 adds a hover crosshair on the chart (see CurveChart).
 * u128 prices arrive as decimal strings — parsed to BigInt for math,
 * rendered as decimal-USDC labels (10^18 internal scaling per
 * `CURVE_PRICE_ONE_USDC`).
 *
 * Phase 1a (ja-018): Buy button below the chart wires to the existing
 * `/api/solana/first-buy` endpoint (fixed 1.0 USDC amount). Sell +
 * custom amounts ship in Phase 1b once the platform-side
 * `/api/solana/curve-sell` endpoint lands.
 */
export function EquityGenesisCurveSection({
  trustId,
  refreshTick,
  onTradeSettled,
}: {
  trustId: string;
  /**
   * Iter-6: the parent page lifts the refresh tick so HolderDrawer +
   * RecentTradesLog (under the chart) share the same cache cadence.
   * Optional — when omitted, the section owns its own internal tick
   * so a standalone embed still gets self-refreshing behaviour.
   */
  refreshTick?: number;
  /**
   * Iter-6: notify the parent that a Buy/Sell just settled so it can
   * bump the shared tick. Called AFTER the local tick bumps so the
   * curve section's own state stays in sync regardless.
   */
  onTradeSettled?: () => void;
}) {
  // Internal tick survives when no parent is wiring a shared tick — keeps
  // standalone use of this component (e.g. embedding in a future demo)
  // honest. The hook below sums both ticks so either consumer can drive
  // a refresh.
  const [internalTick, setInternalTick] = useState(0);
  const effectiveTick = internalTick + (refreshTick ?? 0);
  const { state, missing, error: loadError } = useCurveTrades(trustId, effectiveTick);
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

  // iter-4: trade simulator. `simAmount` is the user-typed LAUNCH amount
  // in human units; the projection panel renders the avg cost + price
  // delta + supply-after using the same linear-curve math the on-chain
  // program executes. No API call — pure forward projection.
  //
  // iter-7: inverse mode. Operators sizing a buy by budget ("I have
  // 1000 USDC, how much LAUNCH does that move?") were forced to guess
  // a token amount and bisect the simulator manually. Inverse mode
  // takes USDC in, solves for ΔS on the linear curve via bigint binary
  // search (no isqrt dependency, ~40 iterations max), and surfaces the
  // resulting token amount + average price.
  const [simAmount, setSimAmount] = useState("");
  const [simMode, setSimMode] = useState<"forward" | "inverse">("forward");

  const bumpRefresh = () => {
    setInternalTick((t) => t + 1);
    onTradeSettled?.();
  };

  const handleBuy = async () => {
    setBuying(true);
    setBuyError(null);
    setBuySignature(null);
    try {
      const result = await api.tryUnifuturesFirstBuy({ entity_id: trustId });
      setBuySignature(result.signature_b58);
      bumpRefresh();
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

  // iter-4: parse simulator input the same way (LAUNCH human units →
  // base units), so the simulator math runs against the same scale as
  // the on-chain numbers. Iter-7: only meaningful in forward mode —
  // inverse mode parses the same input as USDC budget below.
  const simAmountBaseUnits = useMemo(() => {
    const trimmed = simAmount.trim();
    if (!trimmed) return null;
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
  }, [simAmount]);

  // Iter-7: parse the same input as a USDC budget in inverse mode.
  // Curve prices are u128 micro-USDC scaled by 1e18 (per
  // CURVE_PRICE_ONE_USDC); to keep the inverse search in the same scale
  // as the integration, we lift the user's USDC input to 1e18 base
  // units. Returns null for empty / invalid / zero — disables the
  // inverse projection until a meaningful value lands.
  const USDC_PRICE_SCALE_DECIMALS = 18;
  const simAmountUsdc1e18 = useMemo(() => {
    const trimmed = simAmount.trim();
    if (!trimmed) return null;
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const [integerPart, fractionalPart = ""] = trimmed.split(".");
    const padded = fractionalPart
      .padEnd(USDC_PRICE_SCALE_DECIMALS, "0")
      .slice(0, USDC_PRICE_SCALE_DECIMALS);
    const combined = `${integerPart}${padded}`.replace(/^0+(?=\d)/, "");
    try {
      const value = BigInt(combined);
      return value > 0n ? value : null;
    } catch {
      return null;
    }
  }, [simAmount]);

  // iter-4: simulator projection — pure forward math against the live
  // curve state. Mirrors `aeqi_unifutures::buy_linear` cost integration:
  // for a linear curve P(s) = start + (end - start) * s / max, buying
  // ΔS tokens from supply s costs the trapezoid (P(s) + P(s + ΔS)) / 2
  // × ΔS. Returns null when input is invalid or curve state is missing.
  //
  // Iter-7: dual-mode. Forward keeps the original "buy X tokens → Y
  // USDC" projection. Inverse takes "Y USDC budget → X tokens at avg
  // price Z" by binary-searching ΔS on the same trapezoid integral
  // (the cost function is strictly monotonic in ΔS for a non-degenerate
  // linear curve).
  const simProjection: SimProjection | null = useMemo(() => {
    if (!state) return null;
    try {
      const startPrice = BigInt(state.start_price);
      const endPrice = BigInt(state.end_price);
      const maxSupply = BigInt(state.max_supply);
      const currentSupply = BigInt(state.current_supply);
      if (maxSupply === 0n) return null;
      const headroom = currentSupply >= maxSupply ? 0n : maxSupply - currentSupply;
      if (headroom === 0n) return { kind: "saturated" };
      const priceSpan = endPrice >= startPrice ? endPrice - startPrice : 0n;
      const decimalsScale = 10n ** BigInt(TOKEN_DECIMALS);
      const priceAt = (supply: bigint) => startPrice + (priceSpan * supply) / maxSupply;
      const costFor = (deltaSupply: bigint) => {
        const after = currentSupply + deltaSupply;
        const priceAfter = priceAt(after);
        const priceBefore = priceAt(currentSupply);
        const avg = (priceBefore + priceAfter) / 2n;
        return (avg * deltaSupply) / decimalsScale;
      };

      if (simMode === "forward") {
        if (simAmountBaseUnits === null) return null;
        const buyAmount = simAmountBaseUnits;
        // Cap at remaining headroom — buying past max supply is a no-op
        // on chain (the call would revert), so we surface the projection
        // against the legal upper bound.
        const effectiveBuy = buyAmount > headroom ? headroom : buyAmount;
        const supplyAfter = currentSupply + effectiveBuy;
        const priceBefore = priceAt(currentSupply);
        const priceAfter = priceAt(supplyAfter);
        const avgPrice = (priceBefore + priceAfter) / 2n;
        // Trapezoid cost in (u128 × base-units). Decimals scaling: the
        // result is in (USDC_1e18 × token_base_units). To convert into
        // 1e18-scaled USDC we divide by 10^TOKEN_DECIMALS so the value
        // re-uses `formatCurvePrice` directly.
        const cost = (avgPrice * effectiveBuy) / decimalsScale;
        return {
          kind: "forward",
          capped: effectiveBuy < buyAmount,
          cost,
          priceBefore,
          priceAfter,
          supplyAfter,
          tokensOut: effectiveBuy,
          avgPrice,
        };
      }

      // ── Inverse mode: solve for ΔS given a USDC budget.
      if (simAmountUsdc1e18 === null) return null;
      const budget = simAmountUsdc1e18;
      // Edge case: even buying the entire headroom costs less than the
      // budget. Surface a capped flag so the operator knows the
      // projection ran out of curve, not the budget.
      const maxCost = costFor(headroom);
      if (maxCost <= budget) {
        const priceBefore = priceAt(currentSupply);
        const priceAfter = priceAt(currentSupply + headroom);
        return {
          kind: "inverse",
          capped: true,
          cost: maxCost,
          tokensOut: headroom,
          priceBefore,
          priceAfter,
          avgPrice: headroom === 0n ? priceBefore : (priceBefore + priceAfter) / 2n,
          supplyAfter: currentSupply + headroom,
        };
      }
      // Binary search ΔS in [0, headroom]. cost(Δ) is monotonic
      // non-decreasing in Δ, so the invariant holds for any non-
      // degenerate linear curve. ~40 iterations land us on the largest Δ
      // whose cost is still ≤ budget — that's the honest answer: "the
      // budget buys at most this much; the leftover dust isn't enough
      // for one more base unit". Stops early when the window collapses.
      let lo = 0n;
      let hi = headroom;
      while (lo < hi) {
        // bias the midpoint up so the loop terminates when hi == lo + 1
        // and `lo + delta` still satisfies the predicate.
        const mid = (lo + hi + 1n) / 2n;
        if (costFor(mid) <= budget) lo = mid;
        else hi = mid - 1n;
      }
      const tokensOut = lo;
      const priceBefore = priceAt(currentSupply);
      const priceAfter = priceAt(currentSupply + tokensOut);
      const avgPrice = tokensOut === 0n ? priceBefore : (priceBefore + priceAfter) / 2n;
      const cost = costFor(tokensOut);
      return {
        kind: "inverse",
        capped: false,
        cost,
        tokensOut,
        priceBefore,
        priceAfter,
        avgPrice,
        supplyAfter: currentSupply + tokensOut,
      };
    } catch {
      return null;
    }
  }, [state, simAmountBaseUnits, simAmountUsdc1e18, simMode]);

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
      bumpRefresh();
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
      {/* iter-4 trade simulator. Read-only — no API call. Projects cost
          and price impact against the live curve so operators can size
          a buy before committing.
          iter-7: inverse mode toggle. Forward asks "buy N LAUNCH";
          inverse asks "spend N USDC". The toggle sits in the simulator
          row so the label, input, and output all read as one tool. */}
      <div className="curve-trade-row curve-trade-row--sim">
        <div className="curve-sim-mode" role="group" aria-label="Simulator mode">
          <Button
            type="button"
            variant={simMode === "forward" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setSimMode("forward")}
            aria-pressed={simMode === "forward"}
          >
            Buy LAUNCH
          </Button>
          <Button
            type="button"
            variant={simMode === "inverse" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setSimMode("inverse")}
            aria-pressed={simMode === "inverse"}
          >
            Spend USDC
          </Button>
        </div>
        <Input
          label={simMode === "forward" ? "Simulate buy (LAUNCH)" : "Simulate budget (USDC)"}
          inputMode="decimal"
          placeholder="0.0"
          value={simAmount}
          onChange={(e) => setSimAmount(e.target.value)}
          size="sm"
        />
        <CurveSimulatorOutput
          mode={simMode}
          forwardAmount={simAmountBaseUnits}
          inverseBudget={simAmountUsdc1e18}
          projection={simProjection}
        />
      </div>
      <RecentTradesLog
        trades={state.recent_trades ?? []}
        unavailable={state.recent_trades_unavailable === true}
      />
    </PageSection>
  );
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

/**
 * Discriminated union for the simulator output. `saturated` collapses
 * to a single error-toned line. `forward` carries the "buy X → pay Y"
 * projection (iter-4); `inverse` carries the "have Y → buy X" projection
 * (iter-7), both backed by the same trapezoid integral.
 */
type SimProjection =
  | { kind: "saturated" }
  | {
      kind: "forward";
      capped: boolean;
      cost: bigint;
      priceBefore: bigint;
      priceAfter: bigint;
      supplyAfter: bigint;
      tokensOut: bigint;
      avgPrice: bigint;
    }
  | {
      kind: "inverse";
      capped: boolean;
      cost: bigint;
      tokensOut: bigint;
      priceBefore: bigint;
      priceAfter: bigint;
      supplyAfter: bigint;
      avgPrice: bigint;
    };

/**
 * iter-4: trade-simulator output. Iter-7: dual-mode renderer.
 *  - Empty: mode-aware idle help text.
 *  - Saturated: curve has no headroom left (same in both modes).
 *  - Forward (iter-4): cost + price-before/after + supply-after.
 *  - Inverse (iter-7): tokens-out + avg price + price-before/after,
 *    flagged "capped" when the budget exceeded curve headroom.
 *
 * Math runs in the caller (`simProjection`); this component renders.
 */
function CurveSimulatorOutput({
  mode,
  forwardAmount,
  inverseBudget,
  projection,
}: {
  mode: "forward" | "inverse";
  forwardAmount: bigint | null;
  inverseBudget: bigint | null;
  projection: SimProjection | null;
}) {
  const hasInput = mode === "forward" ? forwardAmount !== null : inverseBudget !== null;
  if (!hasInput || projection === null) {
    return (
      <span className="curve-trade-status">
        {mode === "forward"
          ? "Type a LAUNCH amount to see the projected USDC cost and price impact."
          : "Type a USDC budget to see how many LAUNCH it buys at the live curve price."}
      </span>
    );
  }
  if (projection.kind === "saturated") {
    return (
      <span className="curve-trade-status curve-trade-status--error">
        Curve saturated — no headroom left for additional buys.
      </span>
    );
  }
  if (projection.kind === "forward") {
    return (
      <span className="curve-sim-output">
        <span className="curve-sim-output__main">≈ {formatCurvePrice(projection.cost)} USDC</span>
        <span className="curve-sim-output__delta">
          price {formatCurvePrice(projection.priceBefore)} →{" "}
          {formatCurvePrice(projection.priceAfter)} USDC
          {projection.capped && " (capped at headroom)"}
        </span>
      </span>
    );
  }
  // Inverse mode — render the tokens-out headline + avg fill price.
  const tokensHuman = formatLaunchTokens(projection.tokensOut);
  return (
    <span className="curve-sim-output">
      <span className="curve-sim-output__main">≈ {tokensHuman} LAUNCH</span>
      <span className="curve-sim-output__delta">
        avg price {formatCurvePrice(projection.avgPrice)} USDC · spend{" "}
        {formatCurvePrice(projection.cost)} USDC
        {projection.capped && " (capped at curve headroom)"}
      </span>
    </span>
  );
}

/**
 * Render a token amount in raw 6-decimal base units as a compact
 * human number. Trims trailing zeros so "1000000000" (1k LAUNCH)
 * renders as "1,000" instead of "1,000.000000". Mirrors how the
 * RecentTradesLog formats trade-token rows so the inverse simulator
 * output reads as the same kind of number.
 */
function formatLaunchTokens(amount: bigint): string {
  const decimals = 6;
  if (amount === 0n) return "0";
  const divisor = 10n ** BigInt(decimals);
  const integerPart = amount / divisor;
  const fractionalPart = amount % divisor;
  const integerStr = integerPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  if (fractionalPart === 0n) return integerStr;
  const fracStr = fractionalPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${integerStr}.${fracStr.slice(0, 4)}` : integerStr;
}
