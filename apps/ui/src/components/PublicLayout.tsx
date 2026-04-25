import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Wordmark from "@/components/Wordmark";

const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const BlueprintsIcon = () => (
  <svg {...iconProps}>
    <path d="M5 2.5h7v7" />
    <path d="M3.5 4.5h7v7" />
    <rect x="2" y="6.5" width="9" height="7" rx="0.5" />
  </svg>
);

const EconomyIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 8 L8 2.5 A5.5 5.5 0 0 1 13.5 8 Z" fill="currentColor" stroke="none" />
  </svg>
);

/**
 * Public shell for unauthed visitors. Mirrors AppLayout's silhouette
 * (sidebar + content-card) but strips the rail down to the two
 * surfaces an anonymous visitor is allowed to see — Blueprints and
 * Economy — and replaces the profile row with the wordmark + a
 * Sign up / Log in CTA cluster pinned to the bottom.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;

  const isBlueprints = path === "/blueprints" || path.startsWith("/blueprints/");
  const isEconomy = path === "/economy" || path.startsWith("/economy/");

  return (
    <div className="shell">
      <aside className="left-sidebar public-sidebar">
        <div className="sidebar-header">
          <Link to="/blueprints" className="sidebar-public-brand" aria-label="aeqi — home">
            <Wordmark size={20} />
          </Link>
        </div>

        <div className="sidebar-user-zone">
          <Link
            to="/blueprints"
            className={`sidebar-nav-item ${isBlueprints ? "active" : ""}`}
            title="Blueprints — explore the runtime catalog"
          >
            <BlueprintsIcon />
            <span className="sidebar-nav-label">Blueprints</span>
          </Link>
          <Link
            to="/economy"
            className={`sidebar-nav-item ${isEconomy ? "active" : ""}`}
            title="Economy — coming soon"
          >
            <EconomyIcon />
            <span className="sidebar-nav-label">Economy</span>
          </Link>
        </div>

        <div className="left-sidebar-body" />

        <div className="sidebar-public-cta">
          <button
            type="button"
            className="sidebar-public-cta-btn primary"
            onClick={() => navigate("/signup")}
          >
            Sign up
          </button>
          <button
            type="button"
            className="sidebar-public-cta-btn ghost"
            onClick={() => navigate("/login")}
          >
            Log in
          </button>
        </div>
      </aside>

      <div className="content-column">
        <div className="content-card">
          <div className="content-paper">
            <div className="content-body-row">
              <div className="content-main-col">
                <div className="content-scroll">{children}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
