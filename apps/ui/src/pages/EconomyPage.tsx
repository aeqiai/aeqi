import { useEffect } from "react";
import "@/styles/economy.css";

/**
 * /economy — the aeqi economic surface.
 *
 * Coming-soon skeleton. The fifth-layer view: per-agent wallets, cap
 * tables for company-root agents, ownership graph across the tree,
 * cost telemetry rolled up by agent / quest / event. None of this is
 * live yet; the page seats the eventual sections as muted preview
 * cards so visitors can see the shape without clicking through to
 * empty surfaces.
 */
export default function EconomyPage() {
  useEffect(() => {
    document.title = "economy · æqi";
  }, []);

  return (
    <div className="economy-page">
      <header className="economy-hero">
        <span className="economy-hero-eyebrow">Coming soon</span>
        <h1 className="economy-hero-title">economy.</h1>
        <p className="economy-hero-lede">
          The economic substrate of your agents. Wallets, cap tables, ownership graphs, and cost
          telemetry — every value flow across the runtime, in one place.
        </p>
      </header>

      <div className="economy-skel-grid">
        <article className="economy-skel-card">
          <header className="economy-skel-card-head">
            <h3 className="economy-skel-card-title">Wallets</h3>
            <p className="economy-skel-card-sub">Per-agent balances, recent value flows.</p>
          </header>
          <div className="economy-skel-rows">
            {[68, 54, 42].map((w) => (
              <div className="economy-skel-row" key={w}>
                <span className="economy-skel-dot" />
                <span className="economy-skel-bar" style={{ width: `${w}%` }} />
                <span className="economy-skel-amount" />
              </div>
            ))}
          </div>
        </article>

        <article className="economy-skel-card">
          <header className="economy-skel-card-head">
            <h3 className="economy-skel-card-title">Cap tables</h3>
            <p className="economy-skel-card-sub">Ownership across company-root agents.</p>
          </header>
          <div className="economy-skel-pie">
            <svg viewBox="0 0 64 64" aria-hidden="true">
              <circle cx="32" cy="32" r="28" />
              <path d="M32 32 L32 4 A28 28 0 0 1 60 32 Z" className="slice slice-a" />
              <path d="M32 32 L60 32 A28 28 0 0 1 28 59.7 Z" className="slice slice-b" />
            </svg>
            <ul className="economy-skel-legend">
              <li>
                <span className="dot dot-a" /> Founders
              </li>
              <li>
                <span className="dot dot-b" /> Operators
              </li>
              <li>
                <span className="dot dot-c" /> Treasury
              </li>
            </ul>
          </div>
        </article>

        <article className="economy-skel-card">
          <header className="economy-skel-card-head">
            <h3 className="economy-skel-card-title">Ownership graph</h3>
            <p className="economy-skel-card-sub">Who owns what across the agent tree.</p>
          </header>
          <div className="economy-skel-graph" aria-hidden="true">
            <svg viewBox="0 0 240 120">
              <line x1="120" y1="20" x2="60" y2="60" />
              <line x1="120" y1="20" x2="180" y2="60" />
              <line x1="60" y1="60" x2="30" y2="100" />
              <line x1="60" y1="60" x2="90" y2="100" />
              <line x1="180" y1="60" x2="150" y2="100" />
              <line x1="180" y1="60" x2="210" y2="100" />
              <circle cx="120" cy="20" r="10" />
              <circle cx="60" cy="60" r="8" />
              <circle cx="180" cy="60" r="8" />
              <circle cx="30" cy="100" r="6" />
              <circle cx="90" cy="100" r="6" />
              <circle cx="150" cy="100" r="6" />
              <circle cx="210" cy="100" r="6" />
            </svg>
          </div>
        </article>

        <article className="economy-skel-card">
          <header className="economy-skel-card-head">
            <h3 className="economy-skel-card-title">Cost telemetry</h3>
            <p className="economy-skel-card-sub">Spend rolled up by agent, quest, event.</p>
          </header>
          <div className="economy-skel-bars" aria-hidden="true">
            {[44, 72, 38, 90, 56, 64, 30].map((h, i) => (
              <span key={i} className="economy-skel-col" style={{ height: `${h}%` }} />
            ))}
          </div>
        </article>
      </div>

      <footer className="economy-foot">
        <p>
          Tracked at <code>app.aeqi.ai/economy</code>. Sections roll out as they ship.
        </p>
      </footer>
    </div>
  );
}
