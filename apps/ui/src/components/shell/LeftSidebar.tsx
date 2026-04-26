import { useNavigate } from "react-router-dom";
import AgentTree from "@/components/Sidebar";
import BlockAvatar from "@/components/BlockAvatar";
import { useAuthStore } from "@/store/auth";
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

const BlueprintsIcon = () => (
  <svg {...iconProps}>
    <path d="M5 2.5h7v7" />
    <path d="M3.5 4.5h7v7" />
    <rect x="2" y="6.5" width="9" height="7" rx="0.5" />
  </svg>
);

const EconomyIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 8 L8 2.5 A5.5 5.5 0 0 1 13.5 8 Z" fill="currentColor" stroke="none" />
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

const SettingsIcon = () => (
  <svg {...iconProps}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    <circle cx="6" cy="4" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="10" cy="8" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

const SignOutIcon = () => (
  <svg {...iconProps}>
    <path d="M9 3H3v10h6" />
    <path d="M7 8h7M11 5l3 3-3 3" />
  </svg>
);

const DocsIcon = () => (
  <svg {...iconProps}>
    <path d="M3.5 2.5h7l2 2v9h-9z" />
    <path d="M5.5 6h5M5.5 8.5h5M5.5 11h3" />
  </svg>
);

const PRIMITIVES: { id: string; label: string; icon: React.ReactNode; title: string }[] = [
  { id: "agents", label: "Agents", icon: <AgentsIcon />, title: "Agents · G then A" },
  { id: "events", label: "Events", icon: <EventsIcon />, title: "Events · G then E" },
  { id: "quests", label: "Quests", icon: <QuestsIcon />, title: "Quests · G then Q" },
  { id: "ideas", label: "Ideas", icon: <IdeasIcon />, title: "Ideas · G then I" },
];

export default function LeftSidebar({ agentId, path }: LeftSidebarProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const authMode = useAuthStore((s) => s.authMode);
  const logout = useAuthStore((s) => s.logout);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

  // AppLayout owns the overlay state — bridge via window events.
  const openPalette = () => window.dispatchEvent(new CustomEvent("aeqi:open-palette"));
  const openShortcuts = () => window.dispatchEvent(new CustomEvent("aeqi:open-shortcuts"));

  const userName =
    user?.name || user?.email?.split("@")[0] || (authMode === "none" ? "Local" : "You");
  const userEmail = user?.name && user?.email ? user.email : null;
  // Swap the four primitives for a Launch CTA at user scope so the rail's
  // silhouette stays identical across scopes (no layout twitch when a root
  // is picked).
  const userScope = !agentId;
  const base = agentId ? `/${encodeURIComponent(agentId)}` : "";
  const profileHref = "/";
  const profileActive = path === "/" || path === "/settings" || path === "/profile";
  const inboxHref = base || "/";
  const inboxActive = base ? path === base || path.startsWith(`${base}/sessions`) : path === "/";

  const navHref = (id: string) => `${base}/${id}`;
  const isActive = (id: string) => {
    if (!base) return false;
    return path === `${base}/${id}` || path.startsWith(`${base}/${id}/`);
  };

  const renderPrimitive = (item: {
    id: string;
    label: string;
    icon: React.ReactNode;
    title: string;
  }) => (
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

  const renderLaunchCTA = () => (
    <button
      type="button"
      className="sidebar-launch-cta"
      onClick={() => navigate("/start")}
      title="Launch a new Company"
      aria-label="Start a Company"
    >
      <span className="sidebar-launch-cta-plus" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <path
            d="M12 4v16M4 12h16"
            stroke="currentColor"
            strokeWidth="2.25"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="sidebar-launch-cta-label">Start a company</span>
    </button>
  );

  return (
    <div
      className={`left-sidebar${sidebarCollapsed ? " collapsed" : ""}`}
      style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
    >
      <div className="sidebar-header">
        <a
          className={`sidebar-nav-item sidebar-header-profile ${profileActive ? "active" : ""}`}
          href={profileHref}
          onClick={(e) => {
            e.preventDefault();
            if (sidebarCollapsed) toggleSidebar();
            else navigate(profileHref);
          }}
          title={sidebarCollapsed ? `Expand sidebar (${isMac ? "⌘" : "Ctrl"}B)` : "Home"}
          aria-label={sidebarCollapsed ? "Expand sidebar" : `${userName} — home`}
        >
          <span className="sidebar-nav-avatar">
            <span className="sidebar-nav-avatar-glyph" aria-hidden="true">
              <BlockAvatar name={userName} size={sidebarCollapsed ? 20 : 16} />
            </span>
            {sidebarCollapsed && (
              <span className="sidebar-nav-avatar-expand" aria-hidden="true">
                <svg {...iconProps}>
                  <rect x="2" y="3" width="12" height="10" rx="1.5" />
                  <path d="M6.5 3v10" />
                </svg>
              </span>
            )}
          </span>
          {!sidebarCollapsed &&
            (userEmail ? (
              <span className="sidebar-nav-identity">
                <span className="sidebar-nav-identity-name">{userName}</span>
                <span className="sidebar-nav-identity-email" title={userEmail}>
                  {userEmail}
                </span>
              </span>
            ) : (
              <span className="sidebar-nav-label">{userName}</span>
            ))}
        </a>
        {!sidebarCollapsed && (
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
        )}
      </div>

      {/* Global rail items above search — always show the same content
          regardless of which agent is in scope. Blueprints and Economy
          are operator-level surfaces, not per-agent ones. */}
      <div className="sidebar-user-zone">
        <a
          className={`sidebar-nav-item ${path === "/blueprints" || path.startsWith("/blueprints/") ? "active" : ""}`}
          href="/blueprints"
          title="Blueprints"
          onClick={(e) => {
            e.preventDefault();
            navigate("/blueprints");
          }}
        >
          <BlueprintsIcon />
          <span className="sidebar-nav-label">Blueprints</span>
        </a>
        <a
          className={`sidebar-nav-item ${path === "/economy" || path.startsWith("/economy/") ? "active" : ""}`}
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
      </div>

      <div className="left-sidebar-body">
        {/* Search + Inbox + Settings grouped in one zone — three primary
            user-scope rail rows. Search at the top because it's the
            jump-anywhere action; Inbox is scope-aware home; Settings
            mirrors scope. The keyboard-shortcuts ? button rides on
            Search's right edge — both are keyboard-discoverability
            affordances. */}
        <div className="sidebar-user-zone">
          <div className="sidebar-row-pair">
            <button
              type="button"
              className="sidebar-nav-item sidebar-nav-item--search"
              onClick={openPalette}
              aria-label="Open command palette"
              title="Search — jump to any agent, quest, or idea"
            >
              <svg {...iconProps}>
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10 10l3.5 3.5" />
              </svg>
              <span className="sidebar-nav-label">Search</span>
              <span className="sidebar-nav-kbd" aria-hidden="true">
                <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>
                <kbd>K</kbd>
              </span>
            </button>
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
            title={agentId ? "Agent inbox" : "Your inbox"}
            onClick={(e) => {
              e.preventDefault();
              navigate(inboxHref);
            }}
          >
            <InboxIcon />
            <span className="sidebar-nav-label">Inbox</span>
          </a>
          {(() => {
            const settingsHref = base ? `${base}/settings` : "/settings";
            const settingsActive = base
              ? path === `${base}/settings` || path.startsWith(`${base}/settings/`)
              : path === "/settings" || path === "/profile";
            return (
              <a
                className={`sidebar-nav-item ${settingsActive ? "active" : ""}`}
                href={settingsHref}
                title={agentId ? "Agent settings" : "Your account settings"}
                onClick={(e) => {
                  e.preventDefault();
                  navigate(settingsHref);
                }}
              >
                <SettingsIcon />
                <span className="sidebar-nav-label">Settings</span>
              </a>
            );
          })()}
        </div>
        <nav
          className={`sidebar-surface-nav${userScope ? " is-userscope" : ""}`}
          aria-label={userScope ? "Start a company" : "Agent surfaces"}
        >
          {userScope ? renderLaunchCTA() : PRIMITIVES.map(renderPrimitive)}
        </nav>

        <div className="sidebar-tree-slot">
          <AgentTree />
        </div>

        <div className="sidebar-bottom">
          {/* Documentation takes the prominent slot; sign-out becomes a
              small icon-only button on the right (same idiom as Search +
              `?`). When unauthenticated we drop sign-out entirely and the
              docs row spans the full width. */}
          {authMode !== "none" ? (
            <div className="sidebar-row-pair">
              <a
                className="sidebar-nav-item"
                href="https://aeqi.ai/docs"
                target="_blank"
                rel="noopener noreferrer"
                title="Open documentation in a new tab"
              >
                <DocsIcon />
                <span className="sidebar-nav-label">Documentation</span>
              </a>
              <button
                type="button"
                className="sidebar-signout-btn"
                onClick={() => {
                  logout();
                  navigate("/login");
                }}
                title="Sign out of your account"
                aria-label="Sign out"
              >
                <SignOutIcon />
              </button>
            </div>
          ) : (
            <a
              className="sidebar-nav-item"
              href="https://aeqi.ai/docs"
              target="_blank"
              rel="noopener noreferrer"
              title="Open documentation in a new tab"
            >
              <DocsIcon />
              <span className="sidebar-nav-label">Documentation</span>
            </a>
          )}
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
            // Body-level cursor + select suppression so the drag survives
            // the cursor leaving the 6px resizer hit-band.
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";

            const onMove = (ev: MouseEvent) => {
              setSidebarWidth(ev.clientX);
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
