import { useNavigate } from "react-router-dom";
import AgentTree from "@/components/Sidebar";
import BlockAvatar from "@/components/BlockAvatar";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";

// BrandMark / Wordmark are no longer rendered by the authed
// LeftSidebar — the profile row replaces them in the top-left slot
// (and in collapsed state). Both components stay alive in the
// codebase via the auth pages (login, signup, verify, reset) and
// will be wired into the future non-authed shell variant; no need
// to import them here until that variant exists.

interface LeftSidebarProps {
  agentId: string | null;
  path: string;
}

/*
 * SVG props for the user-zone glyphs (Inbox, Blueprints, Economy)
 * and chrome icons (collapse, search). Primitive nav rows have no
 * icon — they render the full word in the brand typeface.
 */
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

/* Blueprints: three stacked sheets, slightly offset. Reads as
 * "a stack of plans" — the catalog metaphor — without leaning on the
 * grid-paper cliché the rail used previously. */
const BlueprintsIcon = () => (
  <svg {...iconProps}>
    <path d="M5 2.5h7v7" />
    <path d="M3.5 4.5h7v7" />
    <rect x="2" y="6.5" width="9" height="7" rx="0.5" />
  </svg>
);

/* Economy: a pie-chart slice (circle outline + filled 90° wedge).
 * Reads as ownership share / cap-table allocation — directly matches
 * what the page contains (wallets, cap tables, ownership graph) rather
 * than leaning on a culturally-loaded currency mark. */
const EconomyIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 8 L8 2.5 A5.5 5.5 0 0 1 13.5 8 Z" fill="currentColor" stroke="none" />
  </svg>
);

/* Agents: a person silhouette — head circle + shoulders arc. The
 * autonomous-entity primitive made literal at rail size. */
const AgentsIcon = () => (
  <svg {...iconProps}>
    <circle cx="8" cy="5.5" r="2.5" />
    <path d="M3 13.5c0-2.5 2-4.5 5-4.5s5 2 5 4.5" />
  </svg>
);

/* Events: a lightning bolt. Triggers fire; signals arrive. The
 * pattern-matched runtime moment in glyph form. */
const EventsIcon = () => (
  <svg {...iconProps}>
    <path d="M9 2 4 9h4l-1 5 5-7H8z" />
  </svg>
);

/* Quests: a flag on a pole. Goals in flight, not completion-shaped
 * (which would be a checkmark and read as 'done'). */
const QuestsIcon = () => (
  <svg {...iconProps}>
    <path d="M4 2v12" />
    <path d="M4 3h7l-2 2.5L11 8H4z" />
  </svg>
);

/* Ideas: a lightbulb — the obvious-and-readable choice. The cliché
 * earns its place because instant recognition matters more than
 * cleverness on a 16px rail glyph. */
const IdeasIcon = () => (
  <svg {...iconProps}>
    <path d="M5 7a3 3 0 0 1 6 0c0 1.5-1 2.5-1 3.5h-4c0-1-1-2-1-3.5z" />
    <path d="M6.5 12h3M7 14h2" />
  </svg>
);

/* Settings: three horizontal sliders with knobs at different
 * positions. Reads as "tune / adjust / preferences" without leaning
 * on the gear cliché — and a gear inside an account-settings context
 * always misreads as "more options" or "config" (mechanical, generic)
 * rather than "your settings" (personal). */
const SettingsIcon = () => (
  <svg {...iconProps}>
    <path d="M2.5 4h11M2.5 8h11M2.5 12h11" />
    <circle cx="6" cy="4" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="10" cy="8" r="1.5" fill="currentColor" stroke="none" />
    <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

const PRIMITIVES: { id: string; label: string; icon: React.ReactNode; title: string }[] = [
  { id: "agents", label: "Agents", icon: <AgentsIcon />, title: "Agents · G then A" },
  { id: "events", label: "Events", icon: <EventsIcon />, title: "Events · G then E" },
  { id: "quests", label: "Quests", icon: <QuestsIcon />, title: "Quests · G then Q" },
  { id: "ideas", label: "Ideas", icon: <IdeasIcon />, title: "Ideas · G then I" },
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
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
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
  // no agent is picked yet, so the four primitives have nowhere to point.
  // Rather than render them as inert ghosts, we swap the whole block for
  // a single Launch-agent CTA that occupies the same vertical footprint —
  // the rail's silhouette stays identical across scopes (no twitch when
  // a root is picked) and the empty space turns into the page's primary
  // call to action instead of dead pixels.
  const userScope = !agentId;
  const base = agentId ? `/${encodeURIComponent(agentId)}` : "";
  // Profile row = "you" as a scope, always pointing at the user root.
  // Clicking it lands on `/` (your home); the gear in the topbar takes
  // you to /settings. Active for both — you're "in yourself" either
  // way, exactly the way an agent row stays active across its subtree.
  const profileHref = "/";
  const profileActive = path === "/" || path === "/settings" || path === "/profile";
  // Inbox = scope-aware home. In agent scope it points to the agent's
  // own home (/:agentId); at the user root it points to `/`. The brand
  // and the footer profile both already route to `/`, so Inbox doesn't
  // need to duplicate that — it stays within the current scope so the
  // user can return to their agent's inbox with one click.
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
      onClick={() => navigate("/new")}
      title="Launch a new autonomous agent"
      aria-label="Launch agent"
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
      <span className="sidebar-launch-cta-label">Launch agent</span>
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
            // Scope-aware Settings: in agent scope it navigates to the
            // agent's own settings; at user root it navigates to the
            // user's account settings. Same row, two destinations,
            // exactly like Inbox above.
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
          aria-label={userScope ? "Launch agent" : "Agent surfaces"}
        >
          {userScope ? renderLaunchCTA() : PRIMITIVES.map(renderPrimitive)}
        </nav>

        <div className="sidebar-tree-slot">
          <AgentTree />
        </div>
      </div>

      {/* Sidebar footer dropped — profile moved to the header (top-left,
          replacing the brand glyph), help button moved to Search's
          right edge. Bottom of the sidebar runs flush with the agent
          tree's scroll viewport now. */}
      {!sidebarCollapsed && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={(e) => {
            e.preventDefault();
            // Persistent feedback during drag — body cursor stays
            // col-resize even when the mouse leaves the resizer hit
            // area, and text selection is suppressed so dragging
            // doesn't accidentally select content.
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
