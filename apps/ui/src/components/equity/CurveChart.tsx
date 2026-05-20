/**
 * CurveChart — inline SVG line chart for the genesis bonding curve.
 *
 * ~50 lines of geometry instead of the ~150kB recharts dep — single-
 * purpose primitive doesn't justify the bundle weight. Coordinates use
 * a fixed 600×220 viewBox; the SVG scales responsively to the container
 * width via `width: 100%`.
 *
 * Renders:
 *   1. Dashed y-gridlines at 25/50/75% of the price span.
 *   2. Linear curve + filled area.
 *   3. Historic-trade dots (jade=buy, warmth=sell) with hover titles.
 *   4. Static current-supply marker.
 *   5. iter-3 hover crosshair — vertical guide line + intersection dot
 *      + supply/price tooltip following the cursor.
 *   6. Endpoint + tick labels (price on the y-axis, supply on the x).
 *
 * Extracted iter-3 from `EquityGenesisCurveSection.tsx` so the section
 * file stays under the 600-line eslint guard once the crosshair logic
 * landed.
 */
import { useRef, useState } from "react";

import { formatBigintCompact, formatCurveAddress, formatCurvePrice } from "./curveFormatters";

export interface CurveChartProps {
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
}

export function CurveChart({
  startPrice,
  endPrice,
  currentPrice,
  maxSupply,
  currentSupply,
  recentTrades,
}: CurveChartProps) {
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
      const supplyAtTrade = runningSupply;
      dots.push({
        x: xForSupply(supplyAtTrade),
        y: yForPrice(priceForSupply(supplyAtTrade)),
        kind: trade.kind,
        signature_b58: trade.signature_b58,
        tokenAmount,
        quoteAmount,
      });
      if (trade.kind === "buy") {
        runningSupply = runningSupply > tokenAmount ? runningSupply - tokenAmount : 0n;
      } else {
        runningSupply = runningSupply + tokenAmount;
      }
    }
    return dots;
  })();

  // Y-axis ticks at 25%, 50%, 75% of the price span — readable
  // "where am I on the curve" landmarks.
  const yTicks: Array<{ y: number; price: bigint }> = [];
  if (endPrice > startPrice) {
    for (let i = 1; i <= 3; i++) {
      const frac = i / 4;
      const price =
        startPrice + ((endPrice - startPrice) * BigInt(Math.round(frac * 1000))) / 1000n;
      yTicks.push({ y: PAD_T + (1 - frac) * innerH, price });
    }
  }

  // X-axis ticks at 25%, 50%, 75% supply milestones.
  const xTicks: Array<{ x: number; supply: bigint }> = [];
  for (let i = 1; i <= 3; i++) {
    const frac = i / 4;
    const supply = (maxSupply * BigInt(Math.round(frac * 1000))) / 1000n;
    xTicks.push({ x: PAD_L + frac * innerW, supply });
  }

  // iter-3: hover crosshair. `hoverX` is the SVG-viewBox x-coordinate of
  // the pointer (null when outside / on touch). Snapping to integer
  // viewBox units keeps the supply/price tooltip stable across sub-pixel
  // mouse motion.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    // Map client-space x to viewBox-space x. The viewBox is fixed at
    // `0 0 ${W} ${H}` so the scaling factor is W / rect.width.
    const xPx = ((e.clientX - rect.left) / rect.width) * W;
    if (xPx < PAD_L || xPx > W - PAD_R) {
      setHoverX(null);
      return;
    }
    setHoverX(xPx);
  };
  const handleMouseLeave = () => setHoverX(null);

  // Tooltip payload at hoverX: invert xForSupply to recover supply, then
  // priceForSupply to recover the price on the line. Both are bigint to
  // match the rest of the chart's formatters.
  const tooltip = (() => {
    if (hoverX === null) return null;
    const ratio = (hoverX - PAD_L) / innerW;
    const clamped = Math.max(0, Math.min(1, ratio));
    // supply = max_supply * clamped — go through bigint via integer
    // scaling so we don't lose precision on large supplies.
    const supplyScaled = BigInt(Math.round(clamped * 1_000_000));
    const supplyAtHover = (maxSupply * supplyScaled) / 1_000_000n;
    const priceAtHover = priceForSupply(supplyAtHover);
    const yAtHover = yForPrice(priceAtHover);
    // Tooltip box position — clamp inside the chart so it doesn't
    // overflow the SVG.
    const boxW = 140;
    const boxH = 42;
    const boxX = Math.min(W - PAD_R - boxW, Math.max(PAD_L, hoverX + 8));
    const boxY = Math.max(PAD_T, Math.min(H - PAD_B - boxH, yAtHover - boxH - 6));
    return {
      x: hoverX,
      y: yAtHover,
      boxX,
      boxY,
      boxW,
      boxH,
      supply: supplyAtHover,
      price: priceAtHover,
    };
  })();

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      style={{
        display: "block",
        maxWidth: "100%",
        backgroundColor: "var(--color-card-subtle, var(--color-card))",
        borderRadius: "var(--radius-md)",
        cursor: "crosshair",
      }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      role="img"
      aria-label="Genesis curve price-vs-supply"
    >
      {yTicks.map((tick, i) => (
        <line
          key={`y-grid-${i}`}
          x1={PAD_L}
          x2={W - PAD_R}
          y1={tick.y}
          y2={tick.y}
          stroke="var(--color-border-subtle, var(--color-border))"
          strokeWidth={1}
          strokeDasharray="2 4"
          opacity={0.6}
        />
      ))}
      <line
        x1={PAD_L}
        x2={W - PAD_R}
        y1={PAD_T + innerH}
        y2={PAD_T + innerH}
        stroke="var(--color-border-subtle, var(--color-border))"
        strokeWidth={1}
      />
      <path d={areaPath} fill="var(--accent)" fillOpacity={0.08} />
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} />
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
        stroke="var(--color-border)"
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
      {/* iter-3: hover crosshair — vertical guide line + dot at the
          intersection with the curve + supply/price tooltip following
          the cursor. Rendered above the static markers so the live
          probe wins the visual contest while the user drags across. */}
      {tooltip && (
        <g pointerEvents="none">
          <line
            x1={tooltip.x}
            x2={tooltip.x}
            y1={PAD_T}
            y2={PAD_T + innerH}
            stroke="var(--color-text-muted)"
            strokeWidth={1}
            strokeDasharray="2 3"
            opacity={0.7}
          />
          <circle
            cx={tooltip.x}
            cy={tooltip.y}
            r={4}
            fill="var(--color-card)"
            stroke="var(--accent)"
            strokeWidth={2}
          />
          <rect
            x={tooltip.boxX}
            y={tooltip.boxY}
            width={tooltip.boxW}
            height={tooltip.boxH}
            rx={4}
            fill="var(--color-card)"
            stroke="var(--color-border)"
            strokeWidth={1}
            opacity={0.96}
          />
          <text
            x={tooltip.boxX + 8}
            y={tooltip.boxY + 16}
            fontSize="10"
            fill="var(--color-text-muted)"
            fontFamily="var(--font-mono)"
          >
            Supply · {formatBigintCompact(tooltip.supply)} LAUNCH
          </text>
          <text
            x={tooltip.boxX + 8}
            y={tooltip.boxY + 32}
            fontSize="11"
            fill="var(--color-text-primary)"
            fontFamily="var(--font-mono)"
          >
            Price · {formatCurvePrice(tooltip.price)} USDC
          </text>
        </g>
      )}
      <text
        x={PAD_L + 4}
        y={yStart - 6}
        fontSize="11"
        fill="var(--color-text-muted)"
        fontFamily="var(--font-mono)"
      >
        {formatCurvePrice(startPrice)} USDC
      </text>
      <text
        x={W - PAD_R - 4}
        y={yEnd - 6}
        fontSize="11"
        fill="var(--color-text-muted)"
        fontFamily="var(--font-mono)"
        textAnchor="end"
      >
        {formatCurvePrice(endPrice)} USDC
      </text>
      {yTicks.map((tick, i) => (
        <text
          key={`y-tick-${i}`}
          x={PAD_L + 4}
          y={tick.y - 3}
          fontSize="10"
          fill="var(--color-text-muted)"
          fontFamily="var(--font-mono)"
          opacity={0.7}
        >
          {formatCurvePrice(tick.price)}
        </text>
      ))}
      <text
        x={PAD_L + 4}
        y={H - 6}
        fontSize="11"
        fill="var(--color-text-muted)"
        fontFamily="var(--font-mono)"
      >
        0 LAUNCH
      </text>
      <text
        x={W - PAD_R - 4}
        y={H - 6}
        fontSize="11"
        fill="var(--color-text-muted)"
        fontFamily="var(--font-mono)"
        textAnchor="end"
      >
        {formatBigintCompact(maxSupply)} LAUNCH
      </text>
      {xTicks.map((tick, i) => (
        <text
          key={`x-tick-${i}`}
          x={tick.x}
          y={H - 6}
          fontSize="10"
          fill="var(--color-text-muted)"
          fontFamily="var(--font-mono)"
          textAnchor="middle"
          opacity={0.6}
        >
          {formatBigintCompact(tick.supply)}
        </text>
      ))}
    </svg>
  );
}
