import { Link, useNavigate } from "react-router-dom";
import CompanySwitcher from "@/components/shell/CompanySwitcher";
import AccountDropdown from "@/components/shell/AccountDropdown";
import HelpMenu from "@/components/shell/HelpMenu";
import Wordmark from "@/components/Wordmark";
import { Tooltip } from "@/components/ui";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { entityBasePath } from "@/lib/entityPath";

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

const InboxIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="3.5" width="12" height="9" rx="0.5" />
    <path d="M2 8h3.5l1 1.5h3l1-1.5H14" />
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

const EconomyIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="6" />
    <ellipse cx="8" cy="8" rx="2.5" ry="6" />
    <path d="M2 8h12" />
  </svg>
);

// Stack of layered cards — Blueprints is the catalog of recipes, the
// supply layer of the system. Three rounded rectangles, slightly offset.
const BlueprintsIcon = () => (
  <svg {...iconProps}>
    <rect x="3" y="3" width="10" height="3" rx="0.5" />
    <rect x="3" y="7" width="10" height="3" rx="0.5" />
    <rect x="3" y="11" width="10" height="3" rx="0.5" />
  </svg>
);

// Treasury — coin/safe geometry. Concentric circle reads as value/store.
const TreasuryIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="2.5" />
    <path d="M2.5 8h2M11.5 8h2" />
  </svg>
);

// Ownership — pie/share allocation.
const OwnershipIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 8 L8 2.5 A5.5 5.5 0 0 1 13.5 8 Z" />
  </svg>
);

// Governance — gavel/decision; balanced scale.
const GovernanceIcon = () => (
  <svg {...iconProps}>
    <path d="M8 2v12" />
    <path d="M3 5h10" />
    <path d="M5 5l-2 4h4z" />
    <path d="M11 5l-2 4h4z" />
  </svg>
);

// Roles — org chart; one node atop two children.
const RolesIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="3.5" r="1.5" />
    <circle cx="4" cy="11.5" r="1.5" />
    <circle cx="12" cy="11.5" r="1.5" />
    <path d="M8 5v3M8 8H4v2M8 8h4v2" />
  </svg>
);

// Settings — gear simplified.
const SettingsIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="2.25" />
    <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" />
  </svg>
);

// Admin — shield silhouette.
const AdminIcon = () => (
  <svg {...iconProps}>
    <path d="M8 1.5L13 4v4.5c0 3.2-2.2 5.4-5 6-2.8-.6-5-2.8-5-6V4l5-2.5z" />
  </svg>
);

const SearchIcon = () => (
  <svg {...iconProps}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10 10l3.5 3.5" />
  </svg>
);

const PlusIcon = () => (
  <svg {...iconProps} width={12} height={12}>
    <path d="M8 3v10M3 8h10" />
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

  // Per-row right-cap action. Always visible at the right edge of its
  // nav row, mirroring the bottom Account+Help row's HelpMenu cap.
  const rowAction = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    keyHint?: string,
  ) => (
    <Tooltip content={keyHint ? `${label} (${keyHint})` : label}>
      <button
        type="button"
        className="sidebar-row-action-btn"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
        aria-label={label}
      >
        {icon}
      </button>
    </Tooltip>
  );

  // Derive canonical base path for sidebar tabs.
  // On-chain entities: /trust/<trustAddress>. Pending: /c/<entityId>.
  const entities = useDaemonStore((s) => s.entities);
  const activeEntityObj = entityId ? (entities.find((e) => e.id === entityId) ?? null) : null;
  const base = activeEntityObj ? entityBasePath(activeEntityObj) : "";
  const hasCompany = !!entityId;

  const navHref = (id: string) => `${base}/${id}`;

  // Personal entity routes (/me/*) hide the ORGANIZATION section.
  // Treasury stays visible per the personal rail lock. Only Ownership,
  // Governance, and Roles are hidden.
  const isPersonal = path.startsWith("/me");

  // The Company cockpit row stays lit ONLY at the bare `/c/<entity>`
  // overview URL — Phase 1 promotes Treasury / Ownership / Governance /
  // Roles to top-level rows, so they own their own "active" state and
  // shouldn't double-light Company. (Compare to the previous shape where
  // those were sub-tabs of CompanyPage and Company stayed lit across
  // them.)
  const isActiveTab = (id: string) => {
    if (!base) return false;
    return path === `${base}/${id}` || path.startsWith(`${base}/${id}/`);
  };
  const isCompanyOverview = !!base && path === base;

  // Top-level public rows.
  const isDiscover = path === "/";
  const isBlueprints = path === "/blueprints" || path.startsWith("/blueprints/");
  const isAdmin = path === "/admin" || path.startsWith("/admin/");
  const isAdminUser = useAuthStore((s) => s.user?.is_admin === true);

  const navItem = (
    id: string,
    label: string,
    icon: React.ReactNode,
    opts: { soon?: boolean; action?: React.ReactNode } = {},
  ) => {
    if (opts.soon) {
      return (
        <div key={id} className="sidebar-nav-row">
          <button
            type="button"
            className="sidebar-nav-item sidebar-nav-item--soon"
            disabled
            title={`${label} — coming soon`}
          >
            {icon}
            <span className="sidebar-nav-label">{label}</span>
          </button>
        </div>
      );
    }
    const active = isActiveTab(id);
    return (
      <div key={id} className="sidebar-nav-row">
        <a
          className={`sidebar-nav-item ${active ? "active" : ""}`}
          href={navHref(id)}
          title={label}
          aria-current={active ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            navigate(navHref(id));
          }}
        >
          {icon}
          <span className="sidebar-nav-label">{label}</span>
        </a>
        {opts.action}
      </div>
    );
  };

  // Top-level (non-entity-scoped) row helper. Used for Economy /
  // Blueprints / Account / Discover-anchor — paths that don't compose
  // off `base`. Mirrors `navItem` but takes an explicit href.
  const topLevelItem = (
    href: string,
    label: string,
    icon: React.ReactNode,
    active: boolean,
    opts: { action?: React.ReactNode } = {},
  ) => (
    <div key={href} className="sidebar-nav-row">
      <a
        className={`sidebar-nav-item ${active ? "active" : ""}`}
        href={href}
        title={label}
        aria-current={active ? "page" : undefined}
        onClick={(e) => {
          e.preventDefault();
          navigate(href);
        }}
      >
        {icon}
        <span className="sidebar-nav-label">{label}</span>
      </a>
      {opts.action}
    </div>
  );

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
        {/* ── Economy — sits ABOVE the CompanySwitcher. Public front
            door at `/`. Search caps the row. ── */}
        <nav className="sidebar-surface-nav sidebar-zone" aria-label="Public">
          {topLevelItem("/", "Economy", <EconomyIcon />, isDiscover, {
            action: rowAction("Search", <SearchIcon />, openPalette, `${isMac ? "⌘" : "Ctrl"}K`),
          })}
        </nav>

        {/* ── Workspace switcher — pivots between user-scope (Economy
            row above) and the active company below. ── */}
        <div className="sidebar-user-zone">
          <CompanySwitcher />
        </div>

        {/* ── Company-scope items. Visible only when a company is
            selected. Order matches the Phase-1 lock:
              Company (cockpit / overview)
              Inbox
              ORGANIZATION  (Treasury · Ownership · Governance · Roles)
              WORKSPACE     (Agents · Events · Quests · Ideas)
              Settings (standalone, gap above) ── */}
        {hasCompany && (
          <>
            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Company">
              <div key="overview" className="sidebar-nav-row">
                <a
                  className={`sidebar-nav-item ${isCompanyOverview ? "active" : ""}`}
                  href={base}
                  title="Company"
                  aria-current={isCompanyOverview ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(base);
                  }}
                >
                  <CompanyIcon />
                  <span className="sidebar-nav-label">Company</span>
                </a>
              </div>
              {navItem("inbox", "Inbox", <InboxIcon />)}
            </nav>

            {!isPersonal && (
              <nav className="sidebar-surface-nav sidebar-zone" aria-label="Organization">
                <div className="sidebar-section-label">Organization</div>
                {navItem("roles", "Roles", <RolesIcon />)}
                {navItem("ownership", "Ownership", <OwnershipIcon />)}
                {navItem("treasury", "Treasury", <TreasuryIcon />)}
                {navItem("governance", "Governance", <GovernanceIcon />)}
              </nav>
            )}

            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Workspace">
              <div className="sidebar-section-label">Workspace</div>
              {navItem("agents", "Agents", <AgentsIcon />)}
              {navItem("events", "Events", <EventsIcon />)}
              {navItem("quests", "Quests", <QuestsIcon />, {
                action: rowAction("New quest", <PlusIcon />, () => {
                  navigate(`${base}/quests/new`);
                }),
              })}
              {navItem("ideas", "Ideas", <IdeasIcon />, {
                action: rowAction("New idea", <PlusIcon />, () => {
                  navigate(`${base}/ideas?compose=1`);
                }),
              })}
              {isPersonal && navItem("treasury", "Treasury", <TreasuryIcon />)}
            </nav>

            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Company settings">
              {navItem("settings", "Settings", <SettingsIcon />)}
            </nav>
          </>
        )}

        {/* ── Bottom group — Blueprints + (admin) + AccountDropdown.
            Account isn't a nav row anymore: the AccountDropdown trigger
            below already routes to /me on click, and a duplicate row is
            redundant. Blueprints = the catalog (top-level, public). ── */}
        <div className="sidebar-bottom-group">
          <nav className="sidebar-surface-nav" aria-label="Platform">
            {topLevelItem("/blueprints", "Blueprints", <BlueprintsIcon />, isBlueprints)}
            {isAdminUser && topLevelItem("/admin", "Admin", <AdminIcon />, isAdmin)}
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
