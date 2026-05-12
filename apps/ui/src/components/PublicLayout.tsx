import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import Wordmark from "@/components/Wordmark";
import { Tooltip } from "@/components/ui";
import { useUIStore } from "@/store/ui";

const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const LaunchIcon = () => (
  <svg {...iconProps}>
    <path d="M3 12.5h10" />
    <path d="M8 3v7" />
    <path d="M5.5 7.5 8 10l2.5-2.5" />
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
 * wordmark in the company-switcher slot, Launch in the workspace nav,
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

  const isLaunch = path === "/launch" || path.startsWith("/launch/");

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
            <Tooltip content={`Expand sidebar (${isMac ? "⌘" : "Ctrl"}B)`}>
              <button
                type="button"
                className="sidebar-public-brand-toggle"
                onClick={toggleSidebar}
                aria-label="Expand sidebar"
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
            </Tooltip>
          ) : (
            <>
              <Link to="/blueprints" className="sidebar-public-brand" aria-label="aeqi — home">
                <Wordmark size={20} />
              </Link>
              <Tooltip content={`Collapse sidebar (${isMac ? "⌘" : "Ctrl"}B)`}>
                <button
                  type="button"
                  className="sidebar-collapse-btn"
                  onClick={toggleSidebar}
                  aria-label="Collapse sidebar"
                >
                  <PanelGlyph />
                </button>
              </Tooltip>
            </>
          )}
        </div>

        <div className="left-sidebar-body">
          {/* ── Start an organization CTA in new-menu slot ── */}
          <div className="sidebar-user-zone">
            <Tooltip content="Start your first autonomous organization">
              <button
                type="button"
                className="sidebar-nav-item new-menu-trigger"
                onClick={() => navigate(`/signup${next}`)}
                aria-label="Start an organization"
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
                <span className="sidebar-nav-label">Start an organization</span>
              </button>
            </Tooltip>
          </div>

          {/* ── Launch ── */}
          <nav className="sidebar-surface-nav" aria-label="Platform">
            <Link
              to="/launch"
              className={`sidebar-nav-item ${isLaunch ? "active" : ""}`}
              title="Launch"
            >
              <LaunchIcon />
              <span className="sidebar-nav-label">Launch</span>
            </Link>
          </nav>

          {/* ── Section break ── */}
          <div className="sidebar-section-break" role="separator" aria-hidden="true" />

          {/* ── Log in / Sign up in account slot ── */}
          <div className="sidebar-bottom">
            <div className="sidebar-user-zone">
              <Tooltip content="Log in to your account">
                <Link to={`/login${next}`} className="sidebar-nav-item">
                  <span className="sidebar-nav-label">Log in</span>
                </Link>
              </Tooltip>
              <Tooltip content="Create an account">
                <Link to={`/signup${next}`} className="sidebar-nav-item">
                  <span className="sidebar-nav-label">Sign up</span>
                </Link>
              </Tooltip>
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
