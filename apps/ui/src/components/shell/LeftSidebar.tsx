import { Link, useNavigate } from "react-router-dom";
import CompanySwitcher from "@/components/shell/CompanySwitcher";
import AccountDropdown from "@/components/shell/AccountDropdown";
import NewMenu from "@/components/shell/NewMenu";
import HelpMenu from "@/components/shell/HelpMenu";
import SidebarGroup from "@/components/shell/SidebarGroup";
import Wordmark from "@/components/Wordmark";
import { Tooltip } from "@/components/ui";
import { useUIStore } from "@/store/ui";

// Sub-tabs owned by Company's PageRail (rendered by CompanyPage). They
// share the entity base path with the sidebar's Company nav item, so
// the Company row stays lit on these. Agents / Events / Quests / Ideas
// are top-level primitives in the global sidebar — they own their own
// active state and must NOT also light up the Company row.
const COMPANY_SUB_TABS = ["overview", "positions"];

interface LeftSidebarProps {
  /** Canonical entity (company) id. Sidebar tabs are company-scoped, not child-agent scoped. */
  entityId: string | null;
  path: string;
}

const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const HomeIcon = () => (
  <svg {...iconProps}>
    <path d="M2.5 7.5L8 3l5.5 4.5" />
    <path d="M3.5 7v6.5h9V7" />
  </svg>
);

const InboxIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="3.5" width="12" height="9" rx="0.5" />
    <path d="M2 8h3.5l1 1.5h3l1-1.5H14" />
  </svg>
);

const PortfolioIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="5" width="12" height="8" rx="1" />
    <path d="M5.5 5V3.5h5V5" />
    <path d="M2 9h12" />
  </svg>
);

const CompanyIcon = () => (
  <svg {...iconProps}>
    <rect x="3" y="2" width="10" height="12" rx="0.5" />
    <path d="M5.75 5h1M9.25 5h1" />
    <path d="M5.75 8h1M9.25 8h1" />
    <path d="M7 14v-3h2v3" />
  </svg>
);

const AgentsIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c0-2.5 2-4.5 5-4.5s5 2 5 4.5" />
  </svg>
);

const EventsIcon = () => (
  <svg {...iconProps}>
    <path d="M9 2 4 9h4l-1 5 5-7H8z" />
  </svg>
);

const QuestsIcon = () => (
  <svg {...iconProps}>
    <path d="M4 2v12" />
    <path d="M4 3h7l-2 2.5L11 8H4z" />
  </svg>
);

const IdeasIcon = () => (
  <svg {...iconProps}>
    <path d="M5 7a3 3 0 0 1 6 0c0 1.5-1 2.5-1 3.5h-4c0-1-1-2-1-3.5z" />
    <path d="M6.5 12h3M7 14h2" />
  </svg>
);

const ProjectsIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="2" width="5.5" height="5.5" rx="0.5" />
    <rect x="8.5" y="2" width="5.5" height="5.5" rx="0.5" />
    <rect x="2" y="8.5" width="5.5" height="5.5" rx="0.5" />
    <rect x="8.5" y="8.5" width="5.5" height="5.5" rx="0.5" />
  </svg>
);

const CRMIcon = () => (
  <svg {...iconProps}>
    <circle cx="6" cy="6" r="2" />
    <circle cx="11.5" cy="7" r="1.5" />
    <path d="M2 13c0-2.2 1.8-4 4-4s4 1.8 4 4" />
    <path d="M9.5 13c0-1.4 1.3-2.5 2.5-2.5s2.5 1.1 2.5 2.5" />
  </svg>
);

const MetricsIcon = () => (
  <svg {...iconProps}>
    <path d="M2.5 14V9M6.5 14V4.5M10.5 14V11M14 14V7" />
    <path d="M2 14h12" />
  </svg>
);

const OwnershipIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 8 L8 2.5 A5.5 5.5 0 0 1 13.5 8 Z" fill="currentColor" stroke="none" />
  </svg>
);

const TreasuryIcon = () => (
  <svg {...iconProps}>
    <ellipse cx="8" cy="4" rx="5" ry="1.5" />
    <path d="M3 4v8c0 0.83 2.24 1.5 5 1.5s5-0.67 5-1.5V4" />
    <path d="M3 8c0 0.83 2.24 1.5 5 1.5s5-0.67 5-1.5" />
  </svg>
);

const GovernanceIcon = () => (
  <svg {...iconProps}>
    <path d="M8 2.5v11M3.5 13.5h9" />
    <path d="M8 4l-3.5 3.5M8 4l3.5 3.5" />
    <path d="M2.5 7.5h4M9.5 7.5h4" />
  </svg>
);

const EconomyIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="6" />
    <ellipse cx="8" cy="8" rx="2.5" ry="6" />
    <path d="M2 8h12" />
  </svg>
);

const SearchIcon = () => (
  <svg {...iconProps}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10 10l3.5 3.5" />
  </svg>
);

const PanelGlyph = () => (
  <svg {...iconProps}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <path d="M6.5 3v10" />
  </svg>
);

export default function LeftSidebar({ entityId, path }: LeftSidebarProps) {
  const navigate = useNavigate();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

  const openPalette = () => window.dispatchEvent(new CustomEvent("aeqi:open-palette"));

  // The URL token is canonically the entity_id; sidebar tabs route to
  // `/c/<entity_id>/<tab>` regardless of which sub-agent surface the
  // user is currently looking at. Per-agent drilldowns
  // (`/c/<entity>/agents/<agent>`) inherit the same sidebar.
  const base = entityId ? `/c/${encodeURIComponent(entityId)}` : "";
  // The "in a company" check is path-based — the prop `entityId` falls
  // back to the user's first company for context (so navigation links
  // resolve), but at user scope (`/`, `/me`, `/economy`, …) we still
  // want to render only the user's own surfaces. The user picks a
  // company via the switcher; that flips the URL into `/c/<id>/...` and
  // the company-scoped items appear.
  const isEntityScope = path.startsWith("/c/");

  const navHref = (id: string) => `${base}/${id}`;
  const isActive = (id: string) => {
    if (!base) return false;
    return path === `${base}/${id}` || path.startsWith(`${base}/${id}/`);
  };
  // My zone — user-scope destinations that always live at user-scope
  // URLs. Active states are path-equality checks; nothing fuzzy.
  const homeActive = path === "/" || path.startsWith("/sessions/");
  const myInboxActive = path === "/me/inbox";
  const myQuestsActive = path === "/me/quests";
  const myPortfolioActive = path === "/me/portfolio";
  // Company sidebar item points at the company's Overview surface
  // (the org card / Positions PageRail). Active on overview /
  // positions tabs only.
  const companyActive =
    !!base &&
    COMPANY_SUB_TABS.some((t) => path === `${base}/${t}` || path.startsWith(`${base}/${t}/`));
  const isEconomy = path === "/economy" || path.startsWith("/economy/");

  const navItem = (
    id: string,
    label: string,
    icon: React.ReactNode,
    opts: { soon?: boolean } = {},
  ) => {
    if (opts.soon) {
      return (
        <button
          key={id}
          type="button"
          className="sidebar-nav-item sidebar-nav-item--soon"
          disabled
          title={`${label} — coming soon`}
        >
          {icon}
          <span className="sidebar-nav-label">{label}</span>
        </button>
      );
    }
    return (
      <a
        key={id}
        className={`sidebar-nav-item ${isActive(id) ? "active" : ""}`}
        href={navHref(id)}
        title={label}
        onClick={(e) => {
          e.preventDefault();
          navigate(navHref(id));
        }}
      >
        {icon}
        <span className="sidebar-nav-label">{label}</span>
      </a>
    );
  };

  return (
    <div
      className={`left-sidebar${sidebarCollapsed ? " collapsed" : ""}`}
      style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
    >
      {/* ── Brand header ── */}
      <div className="sidebar-header">
        {!sidebarCollapsed ? (
          <>
            <Link to="/" className="sidebar-brand" aria-label="aeqi — home">
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
        ) : (
          <Tooltip content={`Expand sidebar (${isMac ? "⌘" : "Ctrl"}B)`}>
            <button
              type="button"
              className="sidebar-nav-item sidebar-brand-collapsed"
              onClick={toggleSidebar}
              aria-label="Expand sidebar"
            >
              <span className="sidebar-brand-collapsed-rest" aria-hidden="true">
                <span
                  style={{
                    fontFamily: "var(--font-brand)",
                    fontSize: 18,
                    fontWeight: 400,
                    letterSpacing: "-0.02em",
                    color: "var(--color-accent)",
                    lineHeight: 1,
                  }}
                >
                  æ
                </span>
              </span>
              <span className="sidebar-brand-collapsed-hover" aria-hidden="true">
                <PanelGlyph />
              </span>
            </button>
          </Tooltip>
        )}
      </div>

      <div className="left-sidebar-body">
        {/* Personal items at the top — invariant, always visible. The
            user's daily destinations across every company they own.
            No "MY" header label; the spacing + the workspace switcher
            below act as the implicit boundary between user-scope and
            workspace-scope items. */}
        <nav className="sidebar-surface-nav sidebar-zone" aria-label="My">
          <a
            className={`sidebar-nav-item ${homeActive ? "active" : ""}`}
            href="/"
            title="Home"
            onClick={(e) => {
              e.preventDefault();
              navigate("/");
            }}
          >
            <HomeIcon />
            <span className="sidebar-nav-label">Home</span>
          </a>
          <a
            className={`sidebar-nav-item ${myInboxActive ? "active" : ""}`}
            href="/me/inbox"
            title="My inbox"
            onClick={(e) => {
              e.preventDefault();
              navigate("/me/inbox");
            }}
          >
            <InboxIcon />
            <span className="sidebar-nav-label">My inbox</span>
          </a>
          <a
            className={`sidebar-nav-item ${myQuestsActive ? "active" : ""}`}
            href="/me/quests"
            title="My quests"
            onClick={(e) => {
              e.preventDefault();
              navigate("/me/quests");
            }}
          >
            <QuestsIcon />
            <span className="sidebar-nav-label">My quests</span>
          </a>
          <a
            className={`sidebar-nav-item ${myPortfolioActive ? "active" : ""}`}
            href="/me/portfolio"
            title="My portfolio"
            onClick={(e) => {
              e.preventDefault();
              navigate("/me/portfolio");
            }}
          >
            <PortfolioIcon />
            <span className="sidebar-nav-label">My portfolio</span>
          </a>
        </nav>

        {/* Workspace switcher sits at the *junction* — between the
            invariant personal items above and the scope-conditional
            workspace items below. It's the pivot, so it lives between
            the two scopes it pivots between. */}
        <div className="sidebar-user-zone">
          <CompanySwitcher />
        </div>

        {/* +New / search action row. */}
        <div className="sidebar-action-row">
          <NewMenu />
          <Tooltip
            content={`Search — jump to any agent, quest, or idea (${isMac ? "⌘" : "Ctrl"}K)`}
          >
            <button
              type="button"
              className="sidebar-row-action-btn"
              onClick={openPalette}
              aria-label="Open command palette"
            >
              <SearchIcon />
            </button>
          </Tooltip>
        </div>

        {/* Workspace items — only shown when the URL puts the user
            inside a company. Company points at the org's Overview
            surface (card + Positions PageRail); Agents/Events/Quests/
            Ideas are the four primitives at company scope. No header
            label — the spacing above (the action row) is the implicit
            boundary. */}
        {isEntityScope && (
          <>
            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Workspace">
              {base && (
                <a
                  className={`sidebar-nav-item ${companyActive ? "active" : ""}`}
                  href={`${base}/overview`}
                  title="Company"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`${base}/overview`);
                  }}
                >
                  <CompanyIcon />
                  <span className="sidebar-nav-label">Company</span>
                </a>
              )}
              {navItem("agents", "Agents", <AgentsIcon />)}
              {navItem("events", "Events", <EventsIcon />)}
              {navItem("quests", "Quests", <QuestsIcon />)}
              {navItem("ideas", "Ideas", <IdeasIcon />)}
            </nav>

            <SidebarGroup title="Operate" groupKey="operate" soon>
              {navItem("projects", "Projects", <ProjectsIcon />, { soon: true })}
              {navItem("crm", "CRM", <CRMIcon />, { soon: true })}
              {navItem("metrics", "Metrics", <MetricsIcon />, { soon: true })}
            </SidebarGroup>

            <SidebarGroup title="Control" groupKey="control" soon>
              {navItem("ownership", "Ownership", <OwnershipIcon />, { soon: true })}
              {navItem("treasury", "Treasury", <TreasuryIcon />, { soon: true })}
              {navItem("governance", "Governance", <GovernanceIcon />, { soon: true })}
            </SidebarGroup>
          </>
        )}

        {/* ── Bottom group — Economy + Account, pinned to the rail's foot
            via mt:auto so the user dropdown always sits at the very
            bottom regardless of how many workspace items are above.
            Economy reads as a top-level destination, not a one-item
            group with a label. ── */}
        <div className="sidebar-bottom-group">
          <nav className="sidebar-surface-nav" aria-label="Economy">
            <a
              className={`sidebar-nav-item ${isEconomy ? "active" : ""}`}
              href="/economy"
              title="Economy"
              onClick={(e) => {
                e.preventDefault();
                navigate("/economy");
              }}
            >
              <EconomyIcon />
              <span className="sidebar-nav-label">Economy</span>
            </a>
          </nav>
          <div className="sidebar-action-row sidebar-action-row--account">
            <AccountDropdown />
            <HelpMenu />
          </div>
        </div>
      </div>

      {!sidebarCollapsed && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={(e) => {
            e.preventDefault();
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";

            const startX = e.clientX;
            const startWidth = sidebarWidth;

            const onMove = (ev: MouseEvent) => {
              setSidebarWidth(startWidth + (ev.clientX - startX));
            };
            const onUp = () => {
              document.body.style.cursor = "";
              document.body.style.userSelect = "";
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
        />
      )}
    </div>
  );
}
