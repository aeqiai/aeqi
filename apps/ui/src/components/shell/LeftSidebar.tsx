import { useNavigate } from "react-router-dom";
import AgentTree from "@/components/Sidebar";
import Wordmark from "@/components/Wordmark";
import RoundAvatar from "@/components/RoundAvatar";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";
import { IconButton } from "@/components/ui";

interface LeftSidebarProps {
  rootId: string;
  agentId: string | null;
  path: string;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const ICON_HOME = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    strokeLinecap="square"
    strokeLinejoin="miter"
  >
    <path d="M3 13V8l5-5 5 5v5z" />
  </svg>
);
const ICON_SESSIONS = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    strokeLinecap="square"
    strokeLinejoin="miter"
  >
    <rect x="2" y="3" width="10" height="4" />
    <rect x="4" y="9" width="10" height="4" />
  </svg>
);
const ICON_AGENTS = (
  <svg
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.1"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="7" cy="3.5" r="1.5" />
    <circle cx="3" cy="10" r="1.3" />
    <circle cx="11" cy="10" r="1.3" />
    <path d="M7 5v3M7 8L3.3 9.3M7 8l3.7 1.3" />
  </svg>
);
const ICON_EVENTS = (
  <svg
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.1"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 5.5a4 4 0 018 0V8l1 1.5H2L3 8V5.5z" />
    <path d="M6 11.5a1 1 0 002 0" />
  </svg>
);
const ICON_QUESTS = (
  <svg
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.1"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3.5 2v10M3.5 2.5h7L9 5l1.5 2.5H3.5" />
  </svg>
);
const ICON_IDEAS = (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1"
    strokeLinecap="square"
    strokeLinejoin="miter"
  >
    <path d="M8 2l6 6-6 6-6-6z" />
  </svg>
);
const ICON_CHANNELS = (
  <svg
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.1"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M3 5h9M3 9h9M6 2L5 12M9 2L8 12" />
  </svg>
);
const ICON_DRIVE = (
  <svg
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.1"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2 4.5a1 1 0 011-1h3l1 1.5h4a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-6.5z" />
  </svg>
);
const ICON_SETTINGS = (
  <svg
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.1"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="7" cy="7" r="2.2" />
    <path d="M7 1.8v1.6M7 10.6v1.6M12.2 7h-1.6M3.4 7H1.8M10.7 3.3l-1.1 1.1M4.4 9.6l-1.1 1.1M10.7 10.7L9.6 9.6M4.4 4.4L3.3 3.3" />
  </svg>
);

const PRIMITIVES: NavItem[] = [
  { id: "", label: "Home", icon: ICON_HOME },
  { id: "sessions", label: "Sessions", icon: ICON_SESSIONS },
  { id: "agents", label: "Agents", icon: ICON_AGENTS },
  { id: "events", label: "Events", icon: ICON_EVENTS },
  { id: "quests", label: "Quests", icon: ICON_QUESTS },
  { id: "ideas", label: "Ideas", icon: ICON_IDEAS },
];

const ICON_TOOLS = (
  <svg
    viewBox="0 0 14 14"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.1"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2.5 9.5L6 6l3 3 2.5-2.5M6 6l-1.5-1.5M9 9l1.5 1.5" />
    <circle cx="11.5" cy="3" r="1.2" />
    <circle cx="2.5" cy="11.5" r="1.2" />
  </svg>
);

const CONFIGURE: NavItem[] = [
  { id: "channels", label: "Channels", icon: ICON_CHANNELS },
  { id: "tools", label: "Tools", icon: ICON_TOOLS },
  { id: "drive", label: "Drive", icon: ICON_DRIVE },
  { id: "settings", label: "Settings", icon: ICON_SETTINGS },
];

/**
 * Application left rail: brand, agent tree, current-agent surface nav, profile.
 *
 * One surface for every navigation decision. The tree picks WHO (which agent);
 * the surface nav below picks WHAT about them (home, sessions, primitives,
 * configure). No top-bar tabs, no gear drawer — everything the user might
 * want is visible and scannable in a single column.
 */
export default function LeftSidebar({ rootId, agentId, path }: LeftSidebarProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  const userName = user?.name || (authMode === "none" ? "Local" : "Profile");
  const currentId = agentId || rootId;
  const base = currentId ? `/${encodeURIComponent(currentId)}` : "";
  const rootBase = rootId ? `/${encodeURIComponent(rootId)}` : "";
  const profileHref = `${base}/profile`;
  const profileActive = path === profileHref || path.startsWith(`${profileHref}/`);

  const navHref = (id: string) => (id ? `${base}/${id}` : base);
  const isActive = (id: string) => {
    if (!base) return false;
    if (id === "") return path === base || path === `${base}/`;
    return path === `${base}/${id}` || path.startsWith(`${base}/${id}/`);
  };

  const renderNav = (item: NavItem) => (
    <a
      key={item.id || "home"}
      className={`sidebar-nav-item ${isActive(item.id) ? "active" : ""}`}
      href={navHref(item.id)}
      onClick={(e) => {
        e.preventDefault();
        navigate(navHref(item.id));
      }}
    >
      {item.icon}
      <span className="sidebar-nav-label">{item.label}</span>
    </a>
  );

  return (
    <div className={`left-sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
      <div className="sidebar-header">
        <a
          className="sidebar-brand"
          href={rootBase || "/"}
          onClick={(e) => {
            e.preventDefault();
            navigate(rootBase || "/");
          }}
        >
          <Wordmark size={18} />
        </a>
        <IconButton
          variant="ghost"
          size="sm"
          className="sidebar-collapse-btn"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="1" y="2" width="14" height="12" rx="2" />
            <path d="M6 2v12" />
            {sidebarCollapsed ? (
              <path d="M9.5 6.5L11.5 8L9.5 9.5" />
            ) : (
              <path d="M11.5 6.5L9.5 8L11.5 9.5" />
            )}
          </svg>
        </IconButton>
      </div>

      <div className="left-sidebar-body">
        {currentId && (
          <nav className="sidebar-surface-nav">
            {PRIMITIVES.map(renderNav)}
            {CONFIGURE.map(renderNav)}
          </nav>
        )}

        <div className="sidebar-tree-slot">
          <AgentTree />
        </div>
      </div>

      <div className="sidebar-footer">
        <a
          className={`sidebar-nav-item ${profileActive ? "active" : ""}`}
          href={profileHref}
          onClick={(e) => {
            e.preventDefault();
            navigate(profileHref);
          }}
        >
          <span className="sidebar-nav-avatar">
            <RoundAvatar name={userName} size={22} src={user?.avatar_url} />
          </span>
          <span className="sidebar-nav-label">{userName}</span>
        </a>
      </div>
    </div>
  );
}
