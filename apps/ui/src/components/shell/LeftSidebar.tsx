import { useNavigate } from "react-router-dom";
import CompanySwitcher from "@/components/shell/CompanySwitcher";
import AccountDropdown from "@/components/shell/AccountDropdown";
import NewMenu from "@/components/shell/NewMenu";
import HelpMenu from "@/components/shell/HelpMenu";
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

const EconomyIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 8 L8 2.5 A5.5 5.5 0 0 1 13.5 8 Z" fill="currentColor" stroke="none" />
  </svg>
);

const SearchIcon = () => (
  <svg {...iconProps}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10 10l3.5 3.5" />
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

  return (
    <div
      className={`left-sidebar${sidebarCollapsed ? " collapsed" : ""}`}
      style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
    >
      {/* ── Company switcher + collapse toggle ── */}
      <div className="sidebar-header">
        {!sidebarCollapsed ? (
          <>
            <div className="company-switcher-slot">
              <CompanySwitcher />
            </div>
            <button
              type="button"
              className="sidebar-collapse-btn"
              onClick={toggleSidebar}
              aria-label="Collapse sidebar"
              title={`Collapse sidebar (${isMac ? "⌘" : "Ctrl"}B)`}
            >
              <svg {...iconProps}>
                <rect x="2" y="3" width="12" height="10" rx="1.5" />
                <path d="M6.5 3v10" />
              </svg>
            </button>
          </>
        ) : (
          <button
            type="button"
            className="sidebar-nav-item sidebar-collapse-expand"
            onClick={toggleSidebar}
            aria-label="Expand sidebar"
            title={`Expand sidebar (${isMac ? "⌘" : "Ctrl"}B)`}
          >
            <svg {...iconProps}>
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <path d="M6.5 3v10" />
            </svg>
          </button>
        )}
      </div>

      <div className="left-sidebar-body">
        {/* ── Inbox ── */}
        <nav className="sidebar-surface-nav" aria-label="Attention">
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
        </nav>

        {/* ── Action row: + (new), search, ? help — white-icon circles,
            reusing the canonical ideas-toolbar-btn pattern per its own
            doc-comment until <ToolbarIconButton> lives in the design
            system. Documentation lives inside the ? help menu. ── */}
        <div className="sidebar-icon-row">
          <NewMenu />
          <button
            type="button"
            className="ideas-toolbar-btn"
            onClick={openPalette}
            aria-label="Open command palette"
            title={`Search — jump to any agent, quest, or idea (${isMac ? "⌘" : "Ctrl"}K)`}
          >
            <SearchIcon />
          </button>
          <HelpMenu />
        </div>

        {/* ── Workspace primitives ── */}
        <nav className="sidebar-surface-nav" aria-label="Workspace">
          <a
            className={`sidebar-nav-item ${isActive("company") ? "active" : ""}`}
            href={navHref("company")}
            title="Company"
            onClick={(e) => {
              e.preventDefault();
              navigate(navHref("company"));
            }}
          >
            <CompanyIcon />
            <span className="sidebar-nav-label">Company</span>
          </a>
          <a
            className={`sidebar-nav-item ${isActive("projects") ? "active" : ""}`}
            href={navHref("projects")}
            title="Projects"
            onClick={(e) => {
              e.preventDefault();
              navigate(navHref("projects"));
            }}
          >
            <ProjectsIcon />
            <span className="sidebar-nav-label">Projects</span>
          </a>
          <a
            className={`sidebar-nav-item ${isActive("agents") ? "active" : ""}`}
            href={navHref("agents")}
            title="Agents"
            onClick={(e) => {
              e.preventDefault();
              navigate(navHref("agents"));
            }}
          >
            <AgentsIcon />
            <span className="sidebar-nav-label">Agents</span>
          </a>
          <a
            className={`sidebar-nav-item ${isActive("events") ? "active" : ""}`}
            href={navHref("events")}
            title="Events"
            onClick={(e) => {
              e.preventDefault();
              navigate(navHref("events"));
            }}
          >
            <EventsIcon />
            <span className="sidebar-nav-label">Events</span>
          </a>
          <a
            className={`sidebar-nav-item ${isActive("quests") ? "active" : ""}`}
            href={navHref("quests")}
            title="Quests"
            onClick={(e) => {
              e.preventDefault();
              navigate(navHref("quests"));
            }}
          >
            <QuestsIcon />
            <span className="sidebar-nav-label">Quests</span>
          </a>
          <a
            className={`sidebar-nav-item ${isActive("ideas") ? "active" : ""}`}
            href={navHref("ideas")}
            title="Ideas"
            onClick={(e) => {
              e.preventDefault();
              navigate(navHref("ideas"));
            }}
          >
            <IdeasIcon />
            <span className="sidebar-nav-label">Ideas</span>
          </a>
        </nav>

        {/* ── Section break: whitespace + tint shift, no hairline ── */}
        <div className="sidebar-section-break" role="separator" aria-hidden="true" />

        {/* ── Bottom group: Economy then Account dropdown ── */}
        <div className="sidebar-bottom-group">
          <nav className="sidebar-surface-nav" aria-label="Platform">
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
