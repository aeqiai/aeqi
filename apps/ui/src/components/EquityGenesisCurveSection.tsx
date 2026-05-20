import { useEffect, useMemo, useState } from "react";

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
