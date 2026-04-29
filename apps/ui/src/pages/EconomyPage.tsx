import { lazy, Suspense, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import PageRail from "@/components/PageRail";
import "@/styles/economy.css";

const BlueprintsPage = lazy(() => import("@/pages/BlueprintsPage"));
const BlueprintDetailPage = lazy(() => import("@/pages/BlueprintDetailPage"));

const TABS = [
  { id: "discovery", label: "Discovery" },
  { id: "blueprints", label: "Blueprints" },
];

const BLUEPRINT_KINDS = new Set(["companies", "agents", "events", "quests", "ideas"]);

/**
 * /economy — the aeqi economic surface.
 *
 * Two-column page-rail-shell: vertical Discovery / Blueprints rail on
 * the left, the active section's content on the right. Discovery is
 * the canonical landing route at `/economy` and renders the coming-
 * soon skeleton (wallets, cap tables, ownership graph, cost telemetry).
 * Blueprints lives at `/economy/blueprints` and mounts the catalog (or
 * the per-blueprint detail page when a slug is present in the URL).
 */
export default function EconomyPage() {
  const location = useLocation();

  const isBlueprintsPath =
    location.pathname === "/economy/blueprints" ||
    location.pathname.startsWith("/economy/blueprints/");
  const isDetailPath = useMemo(() => {
    const match = location.pathname.match(/^\/economy\/blueprints\/([^/]+)/);
    return !!match && !BLUEPRINT_KINDS.has(match[1]);
  }, [location.pathname]);
  const activeTab = isBlueprintsPath ? "blueprints" : "discovery";

  useEffect(() => {
    document.title = isBlueprintsPath ? "blueprints · æqi" : "economy · æqi";
  }, [isBlueprintsPath]);

  return (
    <div className="page-rail-shell">
      <PageRail
        tabs={TABS}
        defaultTab="discovery"
        title="Economy"
        basePath="/economy"
        currentValue={activeTab}
      />
      <div className="page-rail-content page-rail-content--full">
        {isBlueprintsPath ? (
          <Suspense fallback={null}>
            {isDetailPath ? <BlueprintDetailPage /> : <BlueprintsPage />}
          </Suspense>
        ) : (
          <DiscoveryView />
        )}
      </div>
    </div>
  );
}

function DiscoveryView() {
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
