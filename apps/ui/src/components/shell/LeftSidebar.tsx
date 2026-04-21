import { useNavigate } from "react-router-dom";
import AgentTree from "@/components/Sidebar";
import BrandMark from "@/components/BrandMark";
import Wordmark from "@/components/Wordmark";
import BlockAvatar from "@/components/BlockAvatar";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";
import { IconButton } from "@/components/ui";

interface LeftSidebarProps {
  agentId: string | null;
  path: string;
}

interface NavItem {
  id: string;
  label: React.ReactNode;
  icon: React.ReactNode;
  /** Hover tooltip — hosts the `g + letter` jump shortcut hint. */
  title?: string;
}

/*
 * Lucide register — 16×16, stroke 1.5, rounded caps + joins, no fills.
 * Standard glyphs, one cohesive set.
 */
const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const IconAgents = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="6" r="2.5" />
    <path d="M3 13.5a5 5 0 0 1 10 0" />
  </svg>
);
const IconEvents = () => (
  <svg {...iconProps}>
    <path d="M9 2 3 9h4l-1 5 7-7H9l1-5z" />
  </svg>
);
const IconQuests = () => (
  <svg {...iconProps}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
    <path d="M5.5 8l2 2 3-4" />
  </svg>
);
const IconIdeas = () => (
  <svg {...iconProps}>
    <path d="M8 1.75v1.5M13.5 4.5l-1 1M2.5 4.5l1 1M5.25 10.5a3.5 3.5 0 1 1 5.5 0c-.3.4-.5.8-.6 1.25H5.85c-.1-.45-.3-.85-.6-1.25z" />
    <path d="M6.25 14h3.5" />
  </svg>
);
const PRIMITIVES: NavItem[] = [
  { id: "agents", label: "Agents", icon: <IconAgents />, title: "Agents · G then A" },
  { id: "events", label: "Events", icon: <IconEvents />, title: "Events · G then E" },
  { id: "quests", label: "Quests", icon: <IconQuests />, title: "Quests · G then Q" },
  { id: "ideas", label: "Ideas", icon: <IconIdeas />, title: "Ideas · G then I" },
];

/**
 * Application left rail: brand, agent tree, current-agent surface nav, profile.
 *
 * One surface for every navigation decision. The tree picks WHO (which agent);
 * the surface nav below picks WHAT about them (home, sessions, primitives,
 * configure). No top-bar tabs, no gear drawer — everything the user might
 * want is visible and scannable in a single column.
 */
export default function LeftSidebar({ agentId, path }: LeftSidebarProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

  // Profile row should read as "you" — the user's real name if we have one,
  // email local-part as fallback, "Local" in runtime (no-auth) mode.
  const userName =
    user?.name || user?.email?.split("@")[0] || (authMode === "none" ? "Local" : "You");
  // Primitive nav is scoped to the selected agent. On `/` and `/profile`
  // no agent is picked yet, so the items can't navigate anywhere — but we
  // still render them as inert placeholders so the sidebar's silhouette is
  // identical across surfaces and clicking into an agent doesn't yank the
  // layout. The nav row is always mounted; disabled state is purely visual.
  const primitivesDisabled = !agentId;
  const base = agentId ? `/${encodeURIComponent(agentId)}` : "";
  // Profile is a top-level user-scoped route — never namespaced under an
  // agent. Keeps the URL clean on home and avoids dead-ending when no root
  // is in scope.
  const profileHref = "/profile";
  const profileActive = path === profileHref || path.startsWith(`${profileHref}/`);

  const navHref = (id: string) => `${base}/${id}`;
  const isActive = (id: string) => {
    if (!base) return false;
    return path === `${base}/${id}` || path.startsWith(`${base}/${id}/`);
  };

  const renderNav = (item: NavItem) => {
    if (primitivesDisabled) {
      return (
        <span
          key={item.id}
          className="sidebar-nav-item disabled"
          title="Pick a root agent to open this primitive"
          aria-disabled="true"
        >
          {item.icon}
          <span className="sidebar-nav-label">{item.label}</span>
        </span>
      );
    }
    return (
      <a
        key={item.id}
        className={`sidebar-nav-item ${isActive(item.id) ? "active" : ""}`}
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
  };

  return (
    <div className={`left-sidebar${sidebarCollapsed ? " collapsed" : ""}`}>
      <div className="sidebar-header">
        <a
          className="sidebar-brand"
          href={sidebarCollapsed ? undefined : "/"}
          onClick={(e) => {
            e.preventDefault();
            if (sidebarCollapsed) toggleSidebar();
            else navigate("/");
          }}
          title={sidebarCollapsed ? `Expand sidebar (${isMac ? "⌘" : "Ctrl"}B)` : "Home"}
          aria-label={sidebarCollapsed ? "Expand sidebar" : "Home"}
        >
          {sidebarCollapsed ? (
            <>
              <span className="sidebar-brand-glyph">
                <BrandMark size={20} />
              </span>
              <span className="sidebar-brand-expand" aria-hidden="true">
                <svg {...iconProps}>
                  <rect x="2" y="3" width="12" height="10" rx="1.5" />
                  <path d="M6.5 3v10" />
                </svg>
              </span>
            </>
          ) : (
            <Wordmark size={22} />
          )}
        </a>
        {!sidebarCollapsed && (
          <IconButton
            variant="ghost"
            size="sm"
            className="sidebar-collapse-btn"
            onClick={toggleSidebar}
            aria-label="Collapse sidebar"
            title={`Collapse sidebar (${isMac ? "⌘" : "Ctrl"}B)`}
          >
            <svg {...iconProps}>
              <rect x="2" y="3" width="12" height="10" rx="1.5" />
              <path d="M6.5 3v10" />
            </svg>
          </IconButton>
        )}
      </div>

      <div className="left-sidebar-body">
        <nav
          className={`sidebar-surface-nav${primitivesDisabled ? " disabled" : ""}`}
          aria-disabled={primitivesDisabled || undefined}
        >
          {PRIMITIVES.map(renderNav)}
        </nav>

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
            <BlockAvatar name={userName} size={18} />
          </span>
          <span className="sidebar-nav-label">{userName}</span>
        </a>
      </div>
    </div>
  );
}
