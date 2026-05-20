/**
 * RecentTradesLog — compact tabular log under the genesis curve chart.
 * Mirrors the chart-dot affordance (jade=buy, warmth=sell) so the eye
 * can pivot between the chart marker and the row that produced it.
 *
 * Three states explicit:
 *   - `unavailable`: indexer projection offline — explain why the log
 *     is empty so operators don't read it as "no trades happened".
 *   - empty list: real empty state with a one-line CTA for the next
 *     action that lands a row here (Buy/Sell on the curve above).
 *   - non-empty: top 8 rows, slot desc.
 *
 * CSS classes (`.curve-trades-log__*`) live in
 * `EquityGenesisCurveSection.css` so the original layout stays intact.
 */
import "./../EquityGenesisCurveSection.css";

export interface CurveTrade {
  kind: "buy" | "sell";
  counterparty_b58: string;
  token_amount: string;
  quote_amount: string;
  slot: number;
  signature_b58: string;
  log_index: number;
}

export function RecentTradesLog({
  trades,
  unavailable,
}: {
  trades: CurveTrade[];
  unavailable: boolean;
}) {
  if (unavailable) {
    return (
      <div className="curve-trades-log">
        <h3 className="curve-trades-log__title">Recent trades</h3>
        <p className="curve-trades-log__hint">
          Trade history projection is offline. The curve still trades; this view returns once the
          indexer reconnects.
        </p>
      </div>
    );
  }
  if (trades.length === 0) {
    return (
      <div className="curve-trades-log">
        <h3 className="curve-trades-log__title">Recent trades</h3>
        <p className="curve-trades-log__hint">
          No trades yet. The first Buy or Sell against the curve lands here.
        </p>
      </div>
    );
  }
  // Cap at the most recent 8 — the chart plots dots for the full window.
  // The log is for the operator who wants names + sigs, not a full ledger.
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

function formatCurveAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatBigintCompact(value: bigint): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value.toString();
  if (n >= 1e12) return `${(n / 1e12).toFixed(n % 1e12 === 0 ? 0 : 1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(n % 1e9 === 0 ? 0 : 1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n % 1e3 === 0 ? 0 : 1)}k`;
  return n.toString();
}

function formatCurvePrice(price: bigint): string {
  if (price === 0n) return "0";
  const scale = 1_000_000_000_000_000_000n; // 1e18
  const whole = price / scale;
  const frac = price % scale;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(18, "0").slice(0, 4).replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
}
