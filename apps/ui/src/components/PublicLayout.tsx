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

const EconomyIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 8 L8 2.5 A5.5 5.5 0 0 1 13.5 8 Z" fill="currentColor" stroke="none" />
  </svg>
);

const PanelGlyph = () => (
  <svg {...iconProps}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6.5 3v10" />
  </svg>
);

/**
 * Public shell for unauthed visitors. Mirrors LeftSidebar's silhouette:
 * wordmark in the company-switcher slot, Economy in the workspace nav,
 * Log in / Sign up in the account slot. Same structure — no layout twitch
 * on the auth boundary.
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

  const isEconomy = path === "/economy" || path.startsWith("/economy/");

  const here = location.pathname + location.search;
  const next = here === "/" ? "" : `?next=${encodeURIComponent(here)}`;

  return (
    <div className="shell">
      <aside
        className={`left-sidebar public-sidebar${sidebarCollapsed ? " collapsed" : ""}`}
        style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
      >
        {/* ── Wordmark in company-switcher slot ── */}
        <div className="sidebar-header">
          {sidebarCollapsed ? (
            <button
              type="button"
              className="sidebar-public-brand-toggle"
              onClick={toggleSidebar}
              aria-label="Expand sidebar"
              title={`Expand sidebar (${isMac ? "⌘" : "Ctrl"}B)`}
            >
              <span className="sidebar-public-brand-toggle-rest" aria-hidden="true">
                <span
                  style={{
                    fontFamily: "var(--font-brand)",
                    fontSize: 20,
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "var(--color-accent)",
                    lineHeight: 1,
                  }}
                >
                  æ
                </span>
              </span>
              <span className="sidebar-public-brand-toggle-hover" aria-hidden="true">
                <PanelGlyph />
              </span>
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

        <div className="left-sidebar-body">
          {/* ── Start a company CTA in new-menu slot ── */}
          <div className="sidebar-user-zone">
            <button
              type="button"
              className="sidebar-nav-item new-menu-trigger"
              onClick={() => navigate(`/signup${next}`)}
              title="Start your first autonomous company"
              aria-label="Start a company"
            >
              <span className="new-menu-plus" aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none" width={14} height={14}>
                  <path
                    d="M8 3v10M3 8h10"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span className="sidebar-nav-label">Start a company</span>
            </button>
          </div>

          {/* ── Economy ── */}
          <nav className="sidebar-surface-nav" aria-label="Platform">
            <Link
              to="/economy"
              className={`sidebar-nav-item ${isEconomy ? "active" : ""}`}
              title="Economy"
            >
              <EconomyIcon />
              <span className="sidebar-nav-label">Economy</span>
            </Link>
          </nav>

          {/* ── Section break ── */}
          <div className="sidebar-section-break" role="separator" aria-hidden="true" />

          {/* ── Log in / Sign up in account slot ── */}
          <div className="sidebar-bottom">
            <div className="sidebar-user-zone">
              <Link
                to={`/login${next}`}
                className="sidebar-nav-item"
                title="Log in to your account"
              >
                <span className="sidebar-nav-label">Log in</span>
              </Link>
              <Link to={`/signup${next}`} className="sidebar-nav-item" title="Create an account">
                <span className="sidebar-nav-label">Sign up</span>
              </Link>
            </div>
          </div>
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
