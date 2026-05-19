import { Activity, Check, Coins, Sparkles } from "lucide-react";

export interface GenesisCurveState {
  asset_mint: string;
  quote_mint: string;
  curve: string;
  curve_asset_vault: string;
  curve_quote_vault: string;
  buy_amount: number;
  max_cost: number;
}

interface TrustGenesisCurveCardProps {
  curve: GenesisCurveState;
  buying: boolean;
  buyResult: string | null;
  buyError: string | null;
  onFirstBuy: () => void;
}

/**
 * Module card for the UniFutures genesis curve. Renders as an installed-
 * module surface, not a debug panel: eyebrow + display title + live chip
 * up top, three address fields in a quiet dl grid, and a single CTA at
 * the foot. The "first buy" button is the marketplace affordance —
 * pressing it is the act of becoming a stakeholder.
 */
export default function TrustGenesisCurveCard({
  curve,
  buying,
  buyResult,
  buyError,
  onFirstBuy,
}: TrustGenesisCurveCardProps) {
  return (
    <article className="trust-overview-card trust-overview-module">
      <header className="trust-overview-module-head">
        <span className="trust-overview-module-icon" aria-hidden>
          <Coins size={18} strokeWidth={1.5} />
        </span>
        <div className="trust-overview-module-titles">
          <p className="trust-overview-module-eyebrow">Capital · UniFutures</p>
          <h3 className="trust-overview-module-title">Genesis curve</h3>
        </div>
        <span className="trust-overview-module-state" data-tone="live">
          <Activity size={12} strokeWidth={2} />
          Live
        </span>
      </header>

      <dl className="trust-overview-module-grid">
        <div className="trust-overview-module-field">
          <dt>Curve</dt>
          <dd>
            <code>{compactAddress(curve.curve)}</code>
          </dd>
        </div>
        <div className="trust-overview-module-field">
          <dt>Asset mint</dt>
          <dd>
            <code>{compactAddress(curve.asset_mint)}</code>
          </dd>
        </div>
        <div className="trust-overview-module-field">
          <dt>Quote (USDC)</dt>
          <dd>
            <code>{compactAddress(curve.quote_mint)}</code>
          </dd>
        </div>
      </dl>

      <footer className="trust-overview-module-foot">
        <div className="trust-overview-module-foot-text">
          {buyResult ? (
            <span className="trust-overview-module-success">
              <Check size={14} strokeWidth={1.8} />
              Settled · {compactAddress(buyResult)}
            </span>
          ) : buyError ? (
            <span className="trust-overview-module-error">{buyError}</span>
          ) : (
            <span className="trust-overview-module-hint">
              <Sparkles size={14} strokeWidth={1.5} />
              First buy mints the launch token to your wallet.
            </span>
          )}
        </div>
        <button
          type="button"
          className="trust-overview-module-cta"
          onClick={onFirstBuy}
          disabled={buying}
        >
          {buying ? "Buying…" : "Buy $1 USDC"}
        </button>
      </footer>
    </article>
  );
}

function compactAddress(value: string): string {
  if (value.length <= 12) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
