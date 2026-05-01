import { Link, useNavigate } from "react-router-dom";
import CompanySwitcher from "@/components/shell/CompanySwitcher";
import AccountDropdown from "@/components/shell/AccountDropdown";
import HelpMenu from "@/components/shell/HelpMenu";
import Wordmark from "@/components/Wordmark";
import { Tooltip } from "@/components/ui";
import { useUIStore } from "@/store/ui";

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

const PortfolioIcon = () => (
  <svg {...iconProps}>
    <rect x="2" y="5" width="12" height="8" rx="0.5" />
    <path d="M5.5 5V3.5h5V5" />
    <path d="M2 8.5h12" />
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
  // Search on Home; "+" on Agents and Ideas. Click does not propagate
  // to the row's primary navigation.
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

  // The URL token is canonically the entity_id; sidebar tabs route to
  // `/c/<entity_id>/<tab>` regardless of which sub-agent surface the
  // user is currently looking at. Per-agent drilldowns
  // (`/c/<entity>/agents/<agent>`) inherit the same sidebar.
  const base = entityId ? `/c/${encodeURIComponent(entityId)}` : "";
  // Switcher = cursor, URL = page. The company section's *visibility*
  // is driven by the switcher (a non-empty `entityId` means a company
  // is selected), NOT by the URL path. That way Home and Inbox — which
  // are user-scope routes that aggregate cross-company — keep the
  // company tabs visible and one click away. Pressing Home does not
  // unselect your company. The URL still drives *active* state below
  // (which tab is lit), and `isActive` for the bare `/c/<id>` path
  // already correctly returns false on `/` or `/me/inbox` so nothing
  // lights up while you're at user scope. If no company is selected,
  // the section collapses and the switcher trigger reads "Select a
  // company".
  const hasCompany = !!entityId;

  const navHref = (id: string) => `${base}/${id}`;
  const isActive = (id: string) => {
    if (!base) return false;
    // Overview is the canonical company landing — its sidebar item
    // also lights at the bare `/c/<id>` URL (which renders Overview
    // through CompanyPage's effectiveTab default).
    if (id === "overview" && path === base) return true;
    return path === `${base}/${id}` || path.startsWith(`${base}/${id}/`);
  };
  // Personal items — Home (the global director cockpit) and Inbox
  // (the global human action queue). Inbox is the canonical root.
  // Portfolio is the cross-company personal view (holdings,
  // performance) at `/portfolio`. Both invariant of the active
  // company.
  const inboxActive = path === "/";
  const portfolioActive = path === "/portfolio";
  const isEconomy = path === "/economy" || path.startsWith("/economy/");

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
    return (
      <div key={id} className="sidebar-nav-row">
        <a
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
        {opts.action}
      </div>
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
        {/* Personal zone — Inbox + Portfolio. Inbox (`/`) is the global
            human action queue. Portfolio (`/portfolio`) is the
            cross-company holdings/performance view. Both invariant of
            the active company. Search lives as the Inbox row's
            right-cap. */}
        <nav className="sidebar-surface-nav sidebar-zone" aria-label="Personal">
          <div className="sidebar-nav-row">
            <a
              className={`sidebar-nav-item ${inboxActive ? "active" : ""}`}
              href="/"
              title="Inbox"
              onClick={(e) => {
                e.preventDefault();
                navigate("/");
              }}
            >
              <InboxIcon />
              <span className="sidebar-nav-label">Inbox</span>
            </a>
            {rowAction("Search", <SearchIcon />, openPalette, `${isMac ? "⌘" : "Ctrl"}K`)}
          </div>
          <div className="sidebar-nav-row">
            <a
              className={`sidebar-nav-item ${portfolioActive ? "active" : ""}`}
              href="/portfolio"
              title="Portfolio"
              onClick={(e) => {
                e.preventDefault();
                navigate("/portfolio");
              }}
            >
              <PortfolioIcon />
              <span className="sidebar-nav-label">Portfolio</span>
            </a>
          </div>
        </nav>

        {/* Workspace switcher sits at the *junction* — between the
            invariant personal items above and the scope-conditional
            workspace items below. It's the pivot, so it lives between
            the two scopes it pivots between. */}
        <div className="sidebar-user-zone">
          <CompanySwitcher />
        </div>

        {/* Company-scope items — visible whenever a company is
            selected in the switcher, regardless of what URL the user
            is on. Home / Inbox keep the section visible so it's one
            click into the workspace. Flat: no "Company" group header.
            Row-end hover-actions create the row's primitive: Agents → +
            opens the blueprint picker; Ideas → + navigates to the
            ideas page in compose mode. Events have no +; events are
            emitted by agents, not authored. ── */}
        {hasCompany && (
          <>
            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Company">
              {navItem("overview", "Company", <CompanyIcon />)}
            </nav>
            {/* Four-primitive zone — separated from the Company cockpit by a
                small gap (see `.sidebar-zone + .sidebar-zone` rule in
                layout.css). Order spells the wordmark Agents · Events ·
                Quests · Ideas. "+" caps on Quests and Ideas (daily drivers);
                Agents is set up once via the Blueprint flow at /start;
                Events are emitted by agents, not authored. */}
            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Primitives">
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
            </nav>
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
