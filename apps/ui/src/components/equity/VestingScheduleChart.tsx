/**
 * VestingScheduleChart — iter-5 tiny inline schedule visualization for
 * each row in the VestingSection table. Replaces the purely-numeric
 * Claimable column read with a visual story that surfaces:
 *
 *   - The CLIFF segment (no tokens vested) as a flat track from
 *     start_time to cliff_time, rendered as a muted bar at y=0.
 *   - The LINEAR RAMP segment from cliff_time to end_time, rendered as
 *     a jade-toned filled area sweeping from 0 at the cliff to 100% at
 *     the end.
 *   - The CLAIMED ZONE — the portion of vested tokens already drawn out
 *     by the recipient — drawn as a darker overlay along the bottom of
 *     the ramp. Visually the unclaimed-but-vested region is the gap
 *     between the claimed overlay and the ramp top.
 *   - The NOW marker — a vertical line at the current time, so the eye
 *     instantly sees "how much has vested" vs "how much is still to go".
 *
 * Edge cases:
 *   - Schedule unset (start/cliff/end all 0) → renders an empty muted
 *     bar with a "schedule unset" data-state attribute so the operator
 *     knows the row exists but has no shape yet.
 *   - now < start → NOW marker pins to the left edge.
 *   - now >= end  → NOW marker pins to the right edge, ramp fully
 *                   shaded.
 *   - cliff == start → no cliff segment, ramp starts at x=0.
 *   - fdvMilestoneUnlocked → treated as "fully vested NOW".
 *
 * Width is set to 100% of the cell; the parent CSS gives it a fixed
 * height so the SVG stays compact. Tokens only — no literal colors.
 */

export interface VestingScheduleChartProps {
  startTime: bigint;
  cliffTime: bigint;
  endTime: bigint;
  totalAmount: bigint;
  claimedAmount: bigint;
  fdvMilestoneUnlocked: boolean;
  /** Current unix time (seconds). Passed from parent for memoisation. */
  now: bigint;
}

export function VestingScheduleChart({
  startTime,
  cliffTime,
  endTime,
  totalAmount,
  claimedAmount,
  fdvMilestoneUnlocked,
  now,
}: VestingScheduleChartProps) {
  const W = 120;
  const H = 28;
  const PAD = 1;

  // Schedule unset → empty muted track.
  const unset = startTime === 0n || endTime === 0n || cliffTime === 0n;
  if (unset && !fdvMilestoneUnlocked) {
    return (
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        height={H}
        role="img"
        aria-label="Vesting schedule not set"
        style={{ display: "block", maxWidth: W }}
      >
        <rect
          x={PAD}
          y={PAD}
          width={W - PAD * 2}
          height={H - PAD * 2}
          rx={3}
          fill="var(--color-card-subtle)"
        />
      </svg>
    );
  }

  // fdvMilestoneUnlocked short-circuits to "fully vested NOW" — render
  // a full jade bar with a left-aligned claimed overlay.
  if (fdvMilestoneUnlocked) {
    const claimedFrac =
      totalAmount === 0n ? 0 : Number((claimedAmount * 10_000n) / totalAmount) / 10_000;
    return (
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        height={H}
        role="img"
        aria-label={`Fully unlocked, ${Math.round(claimedFrac * 100)}% claimed`}
        style={{ display: "block", maxWidth: W }}
      >
        <rect
          x={PAD}
          y={PAD}
          width={W - PAD * 2}
          height={H - PAD * 2}
          rx={3}
          fill="var(--color-success)"
          opacity={0.18}
        />
        {claimedFrac > 0 && (
          <rect
            x={PAD}
            y={PAD}
            width={(W - PAD * 2) * Math.max(0, Math.min(1, claimedFrac))}
            height={H - PAD * 2}
            rx={3}
            fill="var(--color-success)"
            opacity={0.55}
          />
        )}
      </svg>
    );
  }

  // Map a time t (bigint seconds) to an x-coordinate inside the chart.
  // The chart's timebase is start_time → end_time. Times outside that
  // window are clamped.
  const span = endTime > startTime ? endTime - startTime : 1n;
  const xForTime = (t: bigint): number => {
    if (t <= startTime) return PAD;
    if (t >= endTime) return W - PAD;
    const ratio = Number(((t - startTime) * 10_000n) / span) / 10_000;
    return PAD + ratio * (W - PAD * 2);
  };

  const xStart = xForTime(startTime);
  const xCliff = xForTime(cliffTime);
  const xEnd = xForTime(endTime);
  const xNow = xForTime(now);

  // Vested fraction at NOW (mirrors on-chain vested_amount_at math but
  // expressed as a fraction of total for the geometry, not in base
  // units).
  let vestedFrac = 0;
  if (now >= endTime) {
    vestedFrac = 1;
  } else if (now >= cliffTime && endTime > startTime) {
    const elapsed = now - startTime;
    vestedFrac = Number((elapsed * 10_000n) / span) / 10_000;
  }
  vestedFrac = Math.max(0, Math.min(1, vestedFrac));

  // Ramp top y at NOW — climbs linearly from H-PAD (bottom) at cliff to
  // PAD (top) at end. The triangle shape reads as "tokens accruing".
  const rampHeight = H - PAD * 2;
  const yForFrac = (frac: number) => PAD + (1 - Math.max(0, Math.min(1, frac))) * rampHeight;

  // Build the ramp polygon (filled triangle from cliff to end).
  // Polygon points: cliff-bottom → end-top → end-bottom (closed).
  const rampPoints =
    xEnd > xCliff ? `${xCliff},${H - PAD} ${xEnd},${PAD} ${xEnd},${H - PAD}` : null;

  // Vested-so-far polygon: same as ramp but truncated at xNow with a
  // height proportional to vestedFrac. Polygon:
  //   cliff-bottom → now-top(yForFrac(vestedFrac)) → now-bottom.
  const vestedPoints =
    xNow > xCliff && vestedFrac > 0
      ? `${xCliff},${H - PAD} ${xNow},${yForFrac(vestedFrac)} ${xNow},${H - PAD}`
      : null;

  // Claimed bar at the bottom — width proportional to claimed/total.
  // Spans cliff → cliff + claimedFrac * (end - cliff). Drawn as a
  // darker rect along the bottom 35% of the chart so it reads as
  // "settled / already drawn".
  const claimedFrac =
    totalAmount === 0n ? 0 : Number((claimedAmount * 10_000n) / totalAmount) / 10_000;
  const claimedWidth = (xEnd - xCliff) * Math.max(0, Math.min(1, claimedFrac));
  const claimedBarHeight = Math.max(2, rampHeight * 0.32);

  // Aria label — short narrative of the schedule state.
  const ariaParts: string[] = [];
  if (xCliff > xStart) ariaParts.push("cliff segment");
  ariaParts.push("linear ramp");
  ariaParts.push(`${Math.round(vestedFrac * 100)}% vested`);
  if (claimedFrac > 0) ariaParts.push(`${Math.round(claimedFrac * 100)}% claimed`);
  const ariaLabel = ariaParts.join(", ");

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      height={H}
      role="img"
      aria-label={ariaLabel}
      style={{ display: "block", maxWidth: W }}
    >
      {/* Background track — the cliff segment lives here visually,
          rendered as a flat muted bar across the full chart width. The
          ramp overlay covers the cliff→end portion, leaving only the
          start→cliff slice exposed. */}
      <rect
        x={PAD}
        y={H - PAD - claimedBarHeight}
        width={W - PAD * 2}
        height={claimedBarHeight}
        fill="var(--color-card-subtle)"
        rx={1.5}
      />
      {/* Ramp shape — the future-vesting triangle. Muted accent so it
          reads as "this much is still under schedule". */}
      {rampPoints && <polygon points={rampPoints} fill="var(--accent)" fillOpacity={0.18} />}
      {/* Vested-so-far overlay — saturated jade so the "settled" area
          contrasts sharply with the dimmer future-ramp triangle. */}
      {vestedPoints && (
        <polygon points={vestedPoints} fill="var(--color-success)" fillOpacity={0.6} />
      )}
      {/* Claimed-bar at the bottom — pure jade so the "already drawn"
          band is unambiguous. */}
      {claimedWidth > 0 && (
        <rect
          x={xCliff}
          y={H - PAD - claimedBarHeight}
          width={claimedWidth}
          height={claimedBarHeight}
          fill="var(--color-success)"
          rx={1.5}
        />
      )}
      {/* Cliff guide — short vertical tick at the cliff x. Helps the
          eye land on "claims start here" even when start==cliff. */}
      {xCliff > xStart + 0.5 && (
        <line
          x1={xCliff}
          x2={xCliff}
          y1={PAD}
          y2={H - PAD}
          stroke="var(--color-border)"
          strokeWidth={0.75}
          strokeDasharray="2 2"
        />
      )}
      {/* NOW marker — a 1px line through the full height plus a small
          notch at the top. Painted in the page's ink so it pops above
          the jade/accent fills. */}
      <line x1={xNow} x2={xNow} y1={PAD} y2={H - PAD} stroke="var(--color-text)" strokeWidth={1} />
      <circle cx={xNow} cy={PAD + 1.5} r={1.5} fill="var(--color-text)" />
    </svg>
  );
}
