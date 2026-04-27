import { Link, useNavigate } from "react-router-dom";
import CompanySwitcher from "@/components/shell/CompanySwitcher";
import AccountDropdown from "@/components/shell/AccountDropdown";
import NewMenu from "@/components/shell/NewMenu";
import HelpMenu from "@/components/shell/HelpMenu";
import SidebarGroup from "@/components/shell/SidebarGroup";
import Wordmark from "@/components/Wordmark";
import { useUIStore } from "@/store/ui";

interface LeftSidebarProps {
  agentId: string | null;
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
    <path d="M2 8.5 4 3h8l2 5.5v4.5H2z" />
    <path d="M2 8.5h3.5l1 1.5h3l1-1.5H14" />
  </svg>
);

const QuestsIcon = () => (
  <svg {...iconProps}>
    <path d="M4 2v12" />
    <path d="M4 3h7l-2 2.5L11 8H4z" />
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

const IdeasIcon = () => (
  <svg {...iconProps}>
    <path d="M5 7a3 3 0 0 1 6 0c0 1.5-1 2.5-1 3.5h-4c0-1-1-2-1-3.5z" />
    <path d="M6.5 12h3M7 14h2" />
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

const CompanyIcon = () => (
  <svg {...iconProps}>
    <rect x="3" y="7" width="10" height="7" rx="0.5" />
    <path d="M1 7h14" />
    <path d="M6 7V4l2-2 2 2v3" />
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

export default function LeftSidebar({ agentId, path }: LeftSidebarProps) {
  const navigate = useNavigate();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

  const openPalette = () => window.dispatchEvent(new CustomEvent("aeqi:open-palette"));

  const base = agentId ? `/${encodeURIComponent(agentId)}` : "";

  const navHref = (id: string) => `${base}/${id}`;
  const isActive = (id: string) => {
    if (!base) return false;
    return path === `${base}/${id}` || path.startsWith(`${base}/${id}/`);
  };
  const inboxActive = base ? path === base || path.startsWith(`${base}/sessions`) : path === "/";
  const isEconomy = path === "/economy" || path.startsWith("/economy/");

  const navItem = (id: string, label: string, icon: React.ReactNode) => (
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
        ) : (
          <button
            type="button"
            className="sidebar-nav-item sidebar-brand-collapsed"
            onClick={toggleSidebar}
            aria-label="Expand sidebar"
            title={`Expand sidebar (${isMac ? "⌘" : "Ctrl"}B)`}
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
        )}
      </div>

      <div className="left-sidebar-body">
        {/* ── Company switcher ── */}
        <div className="sidebar-user-zone">
          <CompanySwitcher />
        </div>

        {/* ── Action row: + (strong), search, ? help — small utility circles. ── */}
        <div className="sidebar-icon-row">
          <NewMenu />
          <button
            type="button"
            className="sidebar-utility-btn"
            onClick={openPalette}
            aria-label="Open command palette"
            title={`Search — jump to any agent, quest, or idea (${isMac ? "⌘" : "Ctrl"}K)`}
          >
            <SearchIcon />
          </button>
          <HelpMenu />
        </div>

        {/* ── Operate ── */}
        <SidebarGroup title="Operate" groupKey="operate">
          <a
            className={`sidebar-nav-item ${inboxActive ? "active" : ""}`}
            href={base || "/"}
            title={agentId ? "Company inbox" : "Your inbox"}
            onClick={(e) => {
              e.preventDefault();
              navigate(base || "/");
            }}
          >
            <InboxIcon />
            <span className="sidebar-nav-label">Inbox</span>
          </a>
          {navItem("projects", "Projects", <ProjectsIcon />)}
          {navItem("company", "Company", <CompanyIcon />)}
          {navItem("crm", "CRM", <CRMIcon />)}
          {navItem("metrics", "Metrics", <MetricsIcon />)}
        </SidebarGroup>

        {/* ── Build ── */}
        <SidebarGroup title="Build" groupKey="build">
          {navItem("agents", "Agents", <AgentsIcon />)}
          {navItem("events", "Events", <EventsIcon />)}
          {navItem("quests", "Quests", <QuestsIcon />)}
          {navItem("ideas", "Ideas", <IdeasIcon />)}
        </SidebarGroup>

        {/* ── Control ── */}
        <SidebarGroup title="Control" groupKey="control">
          {navItem("ownership", "Ownership", <OwnershipIcon />)}
          {navItem("treasury", "Treasury", <TreasuryIcon />)}
          {navItem("governance", "Governance", <GovernanceIcon />)}
        </SidebarGroup>

        {/* ── Bottom group — Network + Account, pinned to the rail's foot
            via mt:auto so the user dropdown always sits at the very
            bottom regardless of how many workspace items are above. ── */}
        <div className="sidebar-bottom-group">
          <SidebarGroup title="Network" groupKey="network">
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
          </SidebarGroup>
          <div className="sidebar-user-zone">
            <AccountDropdown />
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
