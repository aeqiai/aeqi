import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import { DetailField, PageSection } from "@/components/ui";

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
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: "var(--space-3)",
          marginTop: "var(--space-4)",
          paddingTop: "var(--space-3)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <button
          type="button"
          onClick={handleBuy}
          disabled={buying}
          style={{
            padding: "var(--space-2) var(--space-4)",
            borderRadius: "999px",
            background: "var(--accent)",
            color: "var(--accent-fg, var(--color-card))",
            border: "none",
            fontWeight: 500,
            fontSize: "var(--text-sm)",
            cursor: buying ? "wait" : "pointer",
            opacity: buying ? 0.6 : 1,
          }}
        >
          {buying ? "Buying…" : "Buy 1 USDC of LAUNCH"}
        </button>
        {buySignature ? (
          <span
            style={{
              fontSize: "var(--text-sm)",
              color: "var(--text-muted)",
              fontFamily: "var(--font-mono)",
            }}
          >
            ✓ Settled · {formatCurveAddress(buySignature)}
          </span>
        ) : buyError ? (
          <span style={{ fontSize: "var(--text-sm)", color: "var(--color-danger, #c0392b)" }}>
            {buyError}
          </span>
        ) : (
          <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
            Mints 1.0 LAUNCH at the current curve price. Sell + custom amounts coming in Phase 1b.
          </span>
        )}
      </div>
    </PageSection>
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

/** Insert `,` thousands separators into a digit string. */
function groupThousands(digits: string): string {
  if (digits.length <= 3) return digits;
  const isNegative = digits.startsWith("-");
  const body = isNegative ? digits.slice(1) : digits;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return isNegative ? `-${grouped}` : grouped;
}
