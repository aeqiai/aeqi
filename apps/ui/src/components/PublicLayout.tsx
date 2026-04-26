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
 * and the big Launch CTA — same component the authed user-scope view
 * uses to launch a new company. Click routes to /signup. Sign-in is
 * available as a secondary link inside the signup page itself; the
 * rail stays focused on the one ignition action.
 *
 * Collapse toggle behaves the same as on the authed rail; collapsed
 * state shows the æ brandmark on rest and morphs to the panel-glyph
 * on hover.
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

  // Anonymous visitors clicking Launch should land back on the page
  // they came from after auth — share-link survival.
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
            // Collapsed: brandmark on rest (just "æ" — the brand glyph,
            // not the full "æqi" wordmark; the narrow rail asks for the
            // mark, not the spelling). Hover morphs to the panel-glyph
            // so the cursor never has to chase a different target.
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

        {/* Big launch CTA — same component the authed user-scope view
            uses for "launch agent". Routes to /signup for unauthed
            visitors so the one prominent action is always present. */}
        <nav className="sidebar-surface-nav is-userscope" aria-label="Launch a company">
          <button
            type="button"
            className="sidebar-launch-cta"
            onClick={() => navigate(`/signup${next}`)}
            title="Launch your first autonomous company"
            aria-label="Launch a company"
          >
            <span className="sidebar-launch-cta-plus" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 4v16M4 12h16"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="sidebar-launch-cta-label">Launch a company</span>
          </button>
        </nav>

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
