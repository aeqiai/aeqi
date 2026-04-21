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
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Hover tooltip — also serves the collapsed rail, where the label
   *  clips to a single initial character.  Power users discover the
   *  `g + letter` jump shortcut here. */
  title?: string;
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

// The four W-primitives (agents / events / quests / ideas) spell themselves
// out — lowercase labels with the leading letter tinted in the brand accent
// so the rail reads A-E-Q-I vertically and every nav item stays
// self-descriptive. No icon slot; the word is the icon.
const BrandInitial = ({ word }: { word: string }) => (
  <>
    <span className="sidebar-nav-initial">{word[0]}</span>
    <span className="sidebar-nav-tail">{word.slice(1)}</span>
  </>
);
const ICON_DRIVE = (
  <svg {...iconProps}>
    <rect x="2" y="4" width="12" height="8" rx="1" />
    <path d="M2 8h12" />
    <circle cx="4.5" cy="10" r="0.4" fill="currentColor" stroke="none" />
    <circle cx="6.5" cy="10" r="0.4" fill="currentColor" stroke="none" />
  </svg>
);
const PRIMITIVES: NavItem[] = [
  { id: "agents", label: <BrandInitial word="agents" />, title: "Agents · G then A" },
  { id: "events", label: <BrandInitial word="events" />, title: "Events · G then E" },
  { id: "quests", label: <BrandInitial word="quests" />, title: "Quests · G then Q" },
  { id: "ideas", label: <BrandInitial word="ideas" />, title: "Ideas · G then I" },
];

// Settings is no longer a rail primitive — it lives on the agent itself, via
// a gear icon in the top bar. Drive stays here for now; it'll fold into
// Ideas (attach-file) in a follow-up.
const CONFIGURE: NavItem[] = [{ id: "drive", label: "Drive", icon: ICON_DRIVE, title: "Drive" }];

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
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

  const userName = user?.name || (authMode === "none" ? "Local" : "Profile");
  const currentId = agentId || rootId;
  const base = currentId ? `/${encodeURIComponent(currentId)}` : "";
  const rootBase = rootId ? `/${encodeURIComponent(rootId)}` : "";
  const profileHref = `${base}/profile`;
  const profileActive = path === profileHref || path.startsWith(`${profileHref}/`);

  const navHref = (id: string) => `${base}/${id}`;
  const isActive = (id: string) => {
    if (!base) return false;
    return path === `${base}/${id}` || path.startsWith(`${base}/${id}/`);
  };

  const renderNav = (item: NavItem) => (
    <a
      key={item.id}
      className={`sidebar-nav-item ${isActive(item.id) ? "active" : ""}${
        item.icon ? "" : " no-icon"
      }`}
      href={navHref(item.id)}
      title={item.title}
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
          title={`${sidebarCollapsed ? "Expand" : "Collapse"} sidebar (${isMac ? "⌘" : "Ctrl"}B)`}
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
