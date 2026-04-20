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

/*
 * Icon family — Lucide register. 16×16 viewBox, stroke 1.5, rounded
 * caps + joins, no fills. Recognizable standard glyphs; the sidebar
 * reads as one cohesive set. No bespoke monoline experiments.
 */
const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const ICON_HOME = (
  <svg {...iconProps}>
    <path d="M2.5 6.5L8 2l5.5 4.5V13a.5.5 0 0 1-.5.5h-3V10h-4v3.5h-3a.5.5 0 0 1-.5-.5V6.5z" />
  </svg>
);
const ICON_SESSIONS = (
  <svg {...iconProps}>
    <path d="M13.5 8a5.5 5.5 0 0 1-7.9 4.95L2.5 13.5l.55-3.1A5.5 5.5 0 1 1 13.5 8z" />
  </svg>
);
const ICON_AGENTS = (
  <svg {...iconProps}>
    <circle cx="6" cy="5.5" r="2.25" />
    <path d="M1.75 13c0-2.25 2-3.75 4.25-3.75S10.25 10.75 10.25 13" />
    <circle cx="11.25" cy="4.75" r="1.5" />
    <path d="M14.25 11.5c0-1.5-1.35-2.5-3-2.5" />
  </svg>
);
const ICON_EVENTS = (
  <svg {...iconProps}>
    <path d="M1.5 8h2.5l1.5-4.5L9 12.5l1.5-4.5h4" />
  </svg>
);
const ICON_QUESTS = (
  <svg {...iconProps}>
    <path d="M6 3.5h7.5" />
    <path d="M6 8h7.5" />
    <path d="M6 12.5h7.5" />
    <path d="M2 3.5l1 1 1.5-1.75" />
    <path d="M2 8l1 1 1.5-1.75" />
    <path d="M2 12.5l1 1 1.5-1.75" />
  </svg>
);
const ICON_IDEAS = (
  <svg {...iconProps}>
    <path d="M5.5 10.75a4 4 0 1 1 5 0V12h-5v-1.25z" />
    <path d="M6.5 14h3" />
  </svg>
);
const ICON_CHANNELS = (
  <svg {...iconProps}>
    <path d="M5.5 2.5L4 13.5" />
    <path d="M12 2.5L10.5 13.5" />
    <path d="M2 6h12" />
    <path d="M2 10h12" />
  </svg>
);
const ICON_DRIVE = (
  <svg {...iconProps}>
    <rect x="2" y="4" width="12" height="8" rx="1" />
    <path d="M2 8h12" />
    <circle cx="4.5" cy="10" r="0.4" fill="currentColor" stroke="none" />
    <circle cx="6.5" cy="10" r="0.4" fill="currentColor" stroke="none" />
  </svg>
);
const ICON_SETTINGS = (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="2" />
    <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.7 3.3l-1.4 1.4M4.7 11.3l-1.4 1.4M12.7 12.7l-1.4-1.4M4.7 4.7l-1.4-1.4" />
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
  <svg {...iconProps}>
    <path d="M13 3.5a2.75 2.75 0 0 1-3.6 3.6l-5.8 5.8a1.25 1.25 0 0 1-1.75-1.75l5.8-5.8A2.75 2.75 0 0 1 11.25 1.75l-1.9 1.9 1.25 1.25L12.5 3z" />
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
          <svg {...iconProps}>
            <rect x="2" y="3" width="12" height="10" rx="1.5" />
            <path d="M6.5 3v10" />
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
