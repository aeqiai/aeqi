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
 * SVG props for the brand glyph + chrome icons (search, help, collapse).
 * Primitive nav items use Zen Dots letter-as-icon instead — see
 * PrimitiveLetter below.
 */
const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/**
 * Primitive letter-as-icon — the first letter of the primitive's name
 * rendered in the brand typeface (Zen Dots), pinned into the same 16×16
 * slot a Lucide glyph would occupy. Threads the wordmark's dotted
 * geometry through the navigation rail.
 */
const PrimitiveLetter = ({ ch }: { ch: string }) => (
  <span className="sidebar-nav-letter" aria-hidden="true">
    {ch}
  </span>
);

const HomeIcon = () => (
  <svg {...iconProps}>
    <path d="M2.5 7 8 2.5 13.5 7v6.5H2.5z" />
    <path d="M6.5 13.5V9h3v4.5" />
  </svg>
);

const InboxIcon = () => (
  <svg {...iconProps}>
    <path d="M2 8.5 4 3h8l2 5.5v4.5H2z" />
    <path d="M2 8.5h3.5l1 1.5h3l1-1.5H14" />
  </svg>
);

const PRIMITIVES: NavItem[] = [
  { id: "agents", label: "Agents", icon: <PrimitiveLetter ch="a" />, title: "Agents · G then A" },
  { id: "events", label: "Events", icon: <PrimitiveLetter ch="e" />, title: "Events · G then E" },
  { id: "quests", label: "Quests", icon: <PrimitiveLetter ch="q" />, title: "Quests · G then Q" },
  { id: "ideas", label: "Ideas", icon: <PrimitiveLetter ch="i" />, title: "Ideas · G then I" },
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

  // Chrome-level affordances that used to live in the content topbar.
  // Dispatched as window events because AppLayout owns the actual
  // overlay state — same channel the content topbar was using.
  const openPalette = () => window.dispatchEvent(new CustomEvent("aeqi:open-palette"));
  const openShortcuts = () => window.dispatchEvent(new CustomEvent("aeqi:open-shortcuts"));

  // Profile row: name on top, email below in a muted secondary line.
  // Fall back to email-local / "Local" / "You" when we don't have enough
  // to show two lines — in those cases the row renders single-line so
  // the same content doesn't stack on top of itself.
  const userName =
    user?.name || user?.email?.split("@")[0] || (authMode === "none" ? "Local" : "You");
  const userEmail = user?.name && user?.email ? user.email : null;
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
  // Inbox is the user-scoped surface for agent-initiated pings — same
  // top-level scope as /profile so it's reachable from anywhere.
  const inboxHref = "/inbox";
  const inboxActive = path === inboxHref;

  const navHref = (id: string) => `${base}/${id}`;
  const isActive = (id: string) => {
    if (!base) return false;
    return path === `${base}/${id}` || path.startsWith(`${base}/${id}/`);
  };
  // Home = the bare /:agentId route (the Inbox landing). Clicking an agent
  // in the tree navigates here, so Home is also what reads as "selected"
  // when the user has just picked an agent. The `/sessions` path is the
  // same surface with an explicit tab segment, so treat it as Home too —
  // otherwise the rail would go dark the moment a session is opened.
  const homeActive = !!base && (path === base || path.startsWith(`${base}/sessions`));

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

      <div className="sidebar-user-zone">
        <div className="sidebar-user-zone-row">
          <a
            className={`sidebar-nav-item ${profileActive ? "active" : ""}`}
            href={profileHref}
            onClick={(e) => {
              e.preventDefault();
              navigate(profileHref);
            }}
          >
            <span className="sidebar-nav-avatar">
              <BlockAvatar name={userName} size={16} />
            </span>
            {userEmail ? (
              <span className="sidebar-nav-identity">
                <span className="sidebar-nav-identity-name">{userName}</span>
                <span className="sidebar-nav-identity-email" title={userEmail}>
                  {userEmail}
                </span>
              </span>
            ) : (
              <span className="sidebar-nav-label">{userName}</span>
            )}
          </a>
          <button
            type="button"
            className="sidebar-help-btn"
            onClick={openShortcuts}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            ?
          </button>
        </div>
        <a
          className={`sidebar-nav-item ${inboxActive ? "active" : ""}`}
          href={inboxHref}
          title="Inbox — agent pings for you"
          onClick={(e) => {
            e.preventDefault();
            navigate(inboxHref);
          }}
        >
          <InboxIcon />
          <span className="sidebar-nav-label">Inbox</span>
        </a>
      </div>

      <div className="sidebar-search-row">
        <button
          type="button"
          className="sidebar-search-pill"
          onClick={openPalette}
          aria-label="Open command palette"
          title="Search — jump to any agent, quest, or idea"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <circle cx="5" cy="5" r="3.2" stroke="currentColor" strokeWidth="1.3" />
            <path
              d="M7.5 7.5L10 10"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
          <span className="sidebar-search-label">Search</span>
          <span className="sidebar-search-kbd" aria-hidden="true">
            <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>
            <kbd>K</kbd>
          </span>
        </button>
      </div>

      <div className="left-sidebar-body">
        <nav
          className={`sidebar-surface-nav${primitivesDisabled ? " disabled" : ""}`}
          aria-disabled={primitivesDisabled || undefined}
        >
          {primitivesDisabled ? (
            <span
              className="sidebar-nav-item disabled"
              title="Pick a root agent to open its home"
              aria-disabled="true"
            >
              <HomeIcon />
              <span className="sidebar-nav-label">Home</span>
            </span>
          ) : (
            <a
              className={`sidebar-nav-item ${homeActive ? "active" : ""}`}
              href={base}
              title="Home · G then S"
              onClick={(e) => {
                e.preventDefault();
                navigate(base);
              }}
            >
              <HomeIcon />
              <span className="sidebar-nav-label">Home</span>
            </a>
          )}
          {PRIMITIVES.map(renderNav)}
        </nav>

        <div className="sidebar-tree-slot">
          <AgentTree />
        </div>
      </div>
    </div>
  );
}
