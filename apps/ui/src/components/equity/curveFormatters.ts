/**
 * Curve number/address formatters — shared between
 * `EquityGenesisCurveSection`, `CurveChart`, and `RecentTradesLog`.
 *
 * Extracted iter-3 to keep the curve section under the 600-line
 * eslint guard once the hover-crosshair logic landed.
 */

/**
 * Curve prices live in u128 micro-USDC scaled by 10^18 per the
 * `CURVE_PRICE_ONE_USDC` on-chain constant. Render as a fixed-precision
 * USDC quantity with up to 4 fractional digits, trimming trailing zeros.
 * Returns "0" for the zero price.
 */
export function formatCurvePrice(price: bigint): string {
  if (price === 0n) return "0";
  const scale = 1_000_000_000_000_000_000n; // 1e18
  const whole = price / scale;
  const frac = price % scale;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
}

/** Compact summary of supply progress: "100,000 / 1,000,000,000,000". */
export function formatCurveSupply(current: bigint, max: bigint): string {
  return `${groupThousands(current.toString())} / ${groupThousands(max.toString())}`;
}

/**
 * Render `current / max` as a two-decimal percentage. Two-decimal
 * resolution matters early in the curve where supply / max_supply rounds
 * to 0.00% for any value < ~10^10 base units on a 10^12 cap.
 */
export function formatCurveSupplyPercent(current: bigint, max: bigint): string {
  if (max === 0n) return "—";
  const tenThousandths = (current * 1_000_000n) / max;
  const whole = tenThousandths / 10_000n;
  const frac = tenThousandths % 10_000n;
  const fracStr = frac.toString().padStart(4, "0").slice(0, 2);
  return `${whole.toString()}.${fracStr}%`;
}

/** Truncate a base58 pubkey to "8Yvuqq…SdWQ" shape. */
export function formatCurveAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * SI-style compact rendering for large bigints. `Number()` coercion is
 * safe for values bounded by `GENESIS_CURVE_MAX_SUPPLY` (1e12, well
 * under 2^53).
 */
export function formatBigintCompact(value: bigint): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value.toString();
  if (n >= 1e12) return `${(n / 1e12).toFixed(n % 1e12 === 0 ? 0 : 1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}k`;
  return n.toString();
}

/** Insert `,` thousands separators into a digit string. */
export function groupThousands(digits: string): string {
  if (digits.length <= 3) return digits;
  const isNegative = digits.startsWith("-");
  const body = isNegative ? digits.slice(1) : digits;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return isNegative ? `-${grouped}` : grouped;
}
