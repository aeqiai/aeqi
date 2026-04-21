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

interface PrimitiveNavItem {
  /** Lowercase slug — also the URL segment. First letter is the accent initial. */
  id: "agents" | "events" | "quests" | "ideas";
  /** Hover tooltip — hosts the `g + letter` jump shortcut hint. */
  title: string;
}

/*
 * Lucide register — 16×16, stroke 1.5, rounded caps + joins, no fills.
 * Used by the shell's utility icons (collapse handle, brand glyph). The four
 * W-primitives render as lowercase brand-font words instead of SVG icons.
 */
const iconProps = {
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const PRIMITIVES: PrimitiveNavItem[] = [
  { id: "agents", title: "Agents · G then A" },
  { id: "events", title: "Events · G then E" },
  { id: "quests", title: "Quests · G then Q" },
  { id: "ideas", title: "Ideas · G then I" },
];

/**
 * Lowercase brand-font label with the leading letter tinted in the accent.
 * Vertical reading of the four primitives spells A-E-Q-I down the rail; the
 * tail span is hidden in the collapsed rail so only the initial remains.
 */
function BrandInitial({ word }: { word: string }) {
  const head = word.charAt(0);
  const tail = word.slice(1);
  return (
    <span className="sidebar-nav-label">
      <span className="sidebar-nav-initial" aria-hidden>
        {head}
      </span>
      <span className="sidebar-nav-tail">{tail}</span>
    </span>
  );
}

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

  const renderPrimitive = (item: PrimitiveNavItem) => {
    if (primitivesDisabled) {
      return (
        <span
          key={item.id}
          className="sidebar-nav-item no-icon disabled"
          title="Pick a root agent to open this primitive"
          aria-disabled="true"
        >
          <BrandInitial word={item.id} />
        </span>
      );
    }
    return (
      <a
        key={item.id}
        className={`sidebar-nav-item no-icon ${isActive(item.id) ? "active" : ""}`}
        href={navHref(item.id)}
        title={item.title}
        onClick={(e) => {
          e.preventDefault();
          navigate(navHref(item.id));
        }}
      >
        <BrandInitial word={item.id} />
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
          {PRIMITIVES.map(renderPrimitive)}
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
