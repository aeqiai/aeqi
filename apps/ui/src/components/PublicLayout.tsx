import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Wordmark from "@/components/Wordmark";
import { useUIStore } from "@/store/ui";

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

const SignInIcon = () => (
  // Door + arrow entering — visual mirror of the authed SignOutIcon, so the
  // two actions read as opposites in the rail vocabulary.
  <svg {...iconProps}>
    <path d="M7 3h6v10H7" />
    <path d="M9 8H2M5 5L2 8l3 3" />
  </svg>
);

const SignUpIcon = () => (
  // Person with a small plus — the canonical sign-up affordance.
  <svg {...iconProps}>
    <circle cx="6.5" cy="5.5" r="2.5" />
    <path d="M2 13.5c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5" />
    <path d="M12 4v4M10 6h4" />
  </svg>
);

const PanelGlyph = () => (
  // Same icon as the authed sidebar-collapse-btn: rectangle with a vertical
  // line on the left, suggesting "panel here / side rail".
  <svg {...iconProps}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6.5 3v10" />
  </svg>
);

/**
 * Public shell for unauthed visitors. Mirrors AppLayout's silhouette
 * (sidebar + content-card) but strips the rail down to: the wordmark,
 * the two surfaces an anonymous visitor can see (Blueprints, Economy),
 * and a Log in / Sign up group that sits in-rhythm with the rest of
 * the nav rather than as a separate CTA cluster at the bottom. The
 * collapse toggle behaves the same as on the authed rail.
 */
export default function PublicLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const path = location.pathname;
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

  const isBlueprints = path === "/blueprints" || path.startsWith("/blueprints/");
  const isEconomy = path === "/economy" || path.startsWith("/economy/");
  const isLogin = path === "/login";
  const isSignup = path === "/signup";

  // Anonymous visitors clicking Log in / Sign up should land back on the
  // page they came from after auth — share-link survival.
  const here = location.pathname + location.search;
  const next = here === "/" ? "" : `?next=${encodeURIComponent(here)}`;

  return (
    <div className="shell">
      <aside
        className={`left-sidebar public-sidebar${sidebarCollapsed ? " collapsed" : ""}`}
        style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
      >
        <div className="sidebar-header">
          {sidebarCollapsed ? (
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={toggleSidebar}
              aria-label="Expand sidebar"
              title={`Expand sidebar (${isMac ? "⌘" : "Ctrl"}B)`}
            >
              <PanelGlyph />
            </button>
          ) : (
            <>
              <Link to="/blueprints" className="sidebar-public-brand" aria-label="aeqi — home">
                <Wordmark size={20} />
              </Link>
              <button
                type="button"
                className="sidebar-collapse-btn"
                onClick={toggleSidebar}
                aria-label="Collapse sidebar"
                title={`Collapse sidebar (${isMac ? "⌘" : "Ctrl"}B)`}
              >
                <PanelGlyph />
              </button>
            </>
          )}
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

        {/* Auth zone — Log in / Sign up live here as normal nav rows so
            the rail reads in one rhythm instead of breaking into a CTA
            cluster at the bottom. Sits just below Blueprints/Economy. */}
        <div className="sidebar-user-zone">
          <button
            type="button"
            className={`sidebar-nav-item ${isLogin ? "active" : ""}`}
            onClick={() => navigate(`/login${next}`)}
            title="Log into your account"
          >
            <SignInIcon />
            <span className="sidebar-nav-label">Log in</span>
          </button>
          <button
            type="button"
            className={`sidebar-nav-item ${isSignup ? "active" : ""}`}
            onClick={() => navigate(`/signup${next}`)}
            title="Create an account"
          >
            <SignUpIcon />
            <span className="sidebar-nav-label">Sign up</span>
          </button>
        </div>

        <div className="left-sidebar-body" />
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
