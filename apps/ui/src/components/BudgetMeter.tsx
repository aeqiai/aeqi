/**
 * Compact `$spent / $cap` pill with a slim progress bar.
 * Sized for the 40px content topbar — the meter replaces the
 * green "live" dot and raw token count, giving the user a single
 * glanceable budget indicator instead of two decorative signals.
 */

interface BudgetMeterProps {
  spent: number;
  cap: number;
}

function formatUsd(n: number): string {
  if (n >= 100) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

export default function BudgetMeter({ spent, cap }: BudgetMeterProps) {
  if (cap <= 0) {
    // No budget configured — show spend alone so the header isn't empty.
    return (
      <div className="budget-meter budget-meter--uncapped" title="No daily budget set">
        <span className="budget-meter-num">{formatUsd(spent)}</span>
        <span className="budget-meter-label">today</span>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, (spent / cap) * 100));
  const warn = pct >= 80;
  const over = pct >= 100;

  return (
    <div
      className={`budget-meter${warn ? " budget-meter--warn" : ""}${over ? " budget-meter--over" : ""}`}
      title={`${formatUsd(spent)} spent of ${formatUsd(cap)} daily budget`}
    >
      <div className="budget-meter-text">
        <span className="budget-meter-num">{formatUsd(spent)}</span>
        <span className="budget-meter-sep">/</span>
        <span className="budget-meter-cap">{formatUsd(cap)}</span>
      </div>
      <div className="budget-meter-track">
        <div className="budget-meter-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
