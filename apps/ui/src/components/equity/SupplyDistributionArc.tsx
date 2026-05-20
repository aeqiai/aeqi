/**
 * SupplyDistributionArc — iter-5 visual companion to the Supply MetricCard.
 *
 * Three concentric arc rings, each one filling a fraction of a 270°
 * sweep around the same center:
 *   1. Outer (accent)  — supply / max_supply (or 100% when uncapped).
 *   2. Middle (ink)    — top-1 holder concentration (largest balance /
 *                        supply). The on-chain "is this one whale or a
 *                        broad distribution" answer at a glance.
 *   3. Inner (success) — total vesting / supply. How much of what's been
 *                        minted is still parked under linear-cliff
 *                        schedules vs unlocked and freely-tradable.
 *
 * Three nested arcs (not stacked donut segments) was the right shape:
 * stacked segments imply the three numbers ADD to 100%, which is
 * misleading — top-1 concentration and vesting share are independent
 * windows ON the same supply. Three independent gauges sharing a center
 * preserves the "three readings of one number" mental model.
 *
 * Width 88px to fit comfortably inside a MetricCard at columns=3. No
 * new tokens — all strokes lean on `--accent`, `--color-text`, and
 * `--color-success`. The track ring uses `--color-card-subtle`.
 */
import { Tooltip } from "@/components/ui";

export interface SupplyDistributionArcProps {
  /** Total supply minted (base units). */
  supply: bigint;
  /** Max supply cap (0n means uncapped). */
  maxSupply: bigint;
  /** Largest single holder balance (base units). */
  topHolderAmount: bigint;
  /** Sum of TOTAL across every active vesting position (base units). */
  vestingTotal: bigint;
}

/** Compute a 0..1 fraction from two bigints, clamped. */
function safeFraction(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) return 0;
  if (numerator <= 0n) return 0;
  if (numerator >= denominator) return 1;
  // Scale via basis points so we keep two-decimal precision without
  // leaving bigint.
  const bps = Number((numerator * 10_000n) / denominator);
  return Math.max(0, Math.min(1, bps / 10_000));
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(value >= 0.999 ? 0 : 1)}%`;
}

export function SupplyDistributionArc({
  supply,
  maxSupply,
  topHolderAmount,
  vestingTotal,
}: SupplyDistributionArcProps) {
  // Three rings — outer to inner. Same center, three different radii.
  const SIZE = 88;
  const CENTER = SIZE / 2;
  // Arc spans 270° from -135° to +135° (leaves a 90° gap at the bottom
  // so the rings look like gauges, not closed donuts).
  const SWEEP_DEG = 270;
  const START_ANGLE = 135; // SVG +y is down, so 135° = bottom-left.
  const STROKE = 6;
  const RING_GAP = 2; // px between concentric rings

  // Radii — outer biggest. Subtract stroke/2 so the stroke draws fully
  // inside the SIZE×SIZE viewBox.
  const outerR = CENTER - STROKE / 2;
  const middleR = outerR - STROKE - RING_GAP;
  const innerR = middleR - STROKE - RING_GAP;

  // Fractions for the three rings.
  // - Outer: when max_supply == 0 (uncapped) treat outer as "informative
  //   only" and render at 100% — there's no cap to fill against, so we
  //   short-circuit to "fully present" with a muted track underneath.
  const isUncapped = maxSupply <= 0n;
  const supplyFraction = isUncapped ? 1 : safeFraction(supply, maxSupply);
  const topFraction = safeFraction(topHolderAmount, supply);
  const vestingFraction = safeFraction(vestingTotal, supply);

  // Convert (cx, cy, r, start°, sweep°) into an SVG arc path. We use
  // standard polar → cartesian (angle measured from +x axis, CCW
  // positive), but flip y since SVG +y is down.
  const arcPath = (cx: number, cy: number, r: number, startDeg: number, sweepDeg: number) => {
    const start = polar(cx, cy, r, startDeg);
    const end = polar(cx, cy, r, startDeg + sweepDeg);
    const largeArc = sweepDeg > 180 ? 1 : 0;
    // sweep flag = 1 = positive-angle (CCW in our math, which renders CW
    // on screen because of the flipped y).
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  };

  // Full track (same arc, full sweep) + filled portion (fraction of the
  // sweep). For zero fractions we still emit the track so the eye sees
  // three rings, not one ring with two missing slots.
  const renderRing = (r: number, fraction: number, fillColor: string, trackOpacity = 1) => {
    const trackPath = arcPath(CENTER, CENTER, r, START_ANGLE, SWEEP_DEG);
    const fillSweep = Math.max(0, Math.min(SWEEP_DEG, fraction * SWEEP_DEG));
    // Tiny fillSweep would render as a vanishing arc; nudge to 0 so we
    // don't get a sub-pixel sliver that looks like a rendering bug.
    const fillPath = fillSweep > 0.5 ? arcPath(CENTER, CENTER, r, START_ANGLE, fillSweep) : null;
    return (
      <g>
        <path
          d={trackPath}
          fill="none"
          stroke="var(--color-card-subtle)"
          strokeWidth={STROKE}
          strokeLinecap="round"
          opacity={trackOpacity}
        />
        {fillPath && (
          <path
            d={fillPath}
            fill="none"
            stroke={fillColor}
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
        )}
      </g>
    );
  };

  const supplyLabel = isUncapped ? "uncapped" : fmtPct(supplyFraction);
  const tooltipText = [
    isUncapped
      ? "Outer · supply minted (uncapped)"
      : `Outer · ${fmtPct(supplyFraction)} of cap minted`,
    `Middle · top-1 holder ${fmtPct(topFraction)}`,
    `Inner · vesting ${fmtPct(vestingFraction)} of supply`,
  ].join(" — ");

  return (
    <Tooltip content={tooltipText}>
      <svg
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={tooltipText}
        style={{ display: "block" }}
      >
        {renderRing(outerR, supplyFraction, "var(--accent)")}
        {renderRing(middleR, topFraction, "var(--color-text)")}
        {renderRing(innerR, vestingFraction, "var(--color-success)")}
        {/* Center label — the cap-usage % for the most "load-bearing"
            number on the page. When uncapped, surface the top-1 reading
            instead so the center stays informative. */}
        <text
          x={CENTER}
          y={CENTER + 4}
          textAnchor="middle"
          fontSize="11"
          fontFamily="var(--font-mono)"
          fill="var(--color-text)"
          fontWeight="600"
        >
          {isUncapped ? fmtPct(topFraction) : supplyLabel}
        </text>
        <text
          x={CENTER}
          y={CENTER + 16}
          textAnchor="middle"
          fontSize="8"
          fontFamily="var(--font-sans)"
          fill="var(--color-text-muted)"
          letterSpacing="0.06em"
        >
          {isUncapped ? "TOP-1" : "OF CAP"}
        </text>
      </svg>
    </Tooltip>
  );
}

/** Convert (cx, cy, r, angleDeg) → cartesian. Angle measured CCW from +x. */
function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(rad),
    // SVG y axis points down; flip so a 90° angle = top of the circle.
    y: cy - r * Math.sin(rad),
  };
}
