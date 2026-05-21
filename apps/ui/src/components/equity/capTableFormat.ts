/**
 * Cap-table number / address formatters. Extracted from EquityPage.tsx
 * in iter-11 to keep that file under the project's 600-line lint
 * ceiling once the import-modal wiring landed.
 *
 * All helpers operate on bigints + raw base58 strings; no React, no
 * components. Keep it that way — the equity drawer + import modal both
 * lean on these and pulling in JSX would couple them unnecessarily.
 */
import { formatNumber } from "@/lib/i18n";

export function shortAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/**
 * Insert `,` thousands separators into a digit string. Locale-neutral
 * by design — the project's i18n helpers can't handle bigint, and this
 * function is only used for non-localized numeric formatting.
 */
export function groupThousands(digits: string): string {
  if (digits.length <= 3) return digits;
  const isNegative = digits.startsWith("-");
  const body = isNegative ? digits.slice(1) : digits;
  const grouped = body.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return isNegative ? `-${grouped}` : grouped;
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
export function formatBaseUnits(amount: bigint, decimals: number): string {
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
 * Iter-6 CSV escape — RFC-4180-flavoured: wrap any value that contains
 * a comma, double-quote, or newline in double-quotes, and double-up
 * embedded quotes. Sufficient for cap-table fields (addresses are
 * comma-free base58, amounts are formatted numbers, percentages carry
 * a `%` and a `.`). Keeps the export legible in Excel, Sheets, and
 * `cut -d,`.
 */
export function csvEscape(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export const formatPct = (value: number): string =>
  `${formatNumber(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;

/**
 * Render `holderAmount / totalSupply` as a two-decimal percentage.
 * Falls back to "—" when supply is zero (avoid divide-by-zero on a
 * never-minted mint; the cap-table section should be empty in that
 * case anyway, but the column renders defensively).
 */
export function formatPercent(amount: bigint, total: bigint): string {
  if (total === 0n) return "—";
  // Scale to ten-thousandths then divide back — keeps two-decimal
  // precision without leaving bigint.
  const basisPoints = (amount * 10_000n) / total;
  const whole = basisPoints / 100n;
  const frac = basisPoints % 100n;
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}%`;
}
