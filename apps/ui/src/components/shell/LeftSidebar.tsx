import { useNavigate } from "react-router-dom";
import AgentTree from "@/components/Sidebar";
import Wordmark from "@/components/Wordmark";
import RoundAvatar from "@/components/RoundAvatar";
import RootAgentPicker from "./RootAgentPicker";
import { useAuthStore } from "@/store/auth";
import { useUIStore } from "@/store/ui";
import { IconButton } from "@/components/ui";

interface LeftSidebarProps {
  /** The current root agent (derived from URL agent's ancestry). */
  rootId: string;
  /** The currently viewed agent from URL. */
  agentId: string | null;
  /** Current pathname — used for active-state matching. */
  path: string;
}

/**
 * Application left rail: brand, primary nav, agent tree.
 *
 * Version B: every nav link targets the CURRENT agent in the URL, not the
 * root — so on `/child-1/sessions` the "Events" link goes to
 * `/child-1/events`, not `/rootId/events`. Drive and Apps stay root-only
 * and resolve to the root's URL regardless of where you clicked from.
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
  const isOnRoot = !!currentId && currentId === rootId;

  /**
   * Active-state check. `p` is a tab name like "sessions" (or "" for the
   * agent's home). We match the current URL against the current agent's
   * path, so navigating between agents highlights the right row.
   */
  const isActive = (p: string) => {
    const full = p === "" ? base : `${base}/${p}`;
    if (p === "") return path === base || path === `${base}/`;
    return path === full || path.startsWith(`${full}/`);
  };

  const hrefFor = (p: string, rootOnly = false) => {
    const scope = rootOnly ? rootBase : base;
    return p === "" ? scope || "/" : `${scope}/${p}`;
  };
  const goTo = (p: string, rootOnly = false) => navigate(hrefFor(p, rootOnly));

  const navLink = (
    p: string,
    label: string,
    icon: React.ReactNode,
    action?: string,
    opts?: { rootOnly?: boolean },
  ) => {
    const rootOnly = !!opts?.rootOnly;
    const disabled = rootOnly && !isOnRoot;
    const activeMatch = rootOnly
      ? path === hrefFor(p, true) || path.startsWith(`${hrefFor(p, true)}/`)
      : isActive(p);
    return (
      <a
        className={`sidebar-nav-item ${activeMatch ? "active" : ""}${disabled ? " disabled" : ""}`}
        href={hrefFor(p, rootOnly)}
        onClick={(e) => {
          e.preventDefault();
          goTo(p, rootOnly);
        }}
      >
        {icon}
        <span className="sidebar-nav-label">{label}</span>
        {action && (
          <span
            className="sidebar-nav-action"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              goTo(p, rootOnly);
              setTimeout(() => window.dispatchEvent(new CustomEvent("aeqi:create")), 50);
            }}
            title={action}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M6 2.5v7M2.5 6h7" />
            </svg>
          </span>
        )}
      </a>
    );
  };

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
            strokeWidth="1.3"
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

      <RootAgentPicker rootId={rootId} collapsed={sidebarCollapsed} />

      <nav className="sidebar-nav">
        <a
          className={`sidebar-nav-item ${isActive("profile") ? "active" : ""}`}
          href={hrefFor("profile")}
          onClick={(e) => {
            e.preventDefault();
            goTo("profile");
          }}
        >
          <span className="sidebar-nav-avatar">
            <RoundAvatar name={userName} size={22} src={user?.avatar_url} />
          </span>
          <span className="sidebar-nav-label">{userName}</span>
        </a>
        {navLink(
          "",
          "Home",
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          >
            <path d="M2 7.5l5-4.5 5 4.5" />
            <path d="M3.5 6.5v5a.5.5 0 00.5.5h2.5V9.5h1V12H10a.5.5 0 00.5-.5v-5" />
          </svg>,
        )}
        {navLink(
          "settings",
          "Settings",
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
          </svg>,
        )}
        {navLink(
          "sessions",
          "Sessions",
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          >
            <path d="M2 3h10v7a1 1 0 01-1 1H3a1 1 0 01-1-1V3z" />
            <path d="M5 6h4M5 8.5h2" />
          </svg>,
        )}
        {navLink(
          "events",
          "Events",
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          >
            <polyline points="1 7 4 4 7 9 10 3 13 7" />
          </svg>,
        )}
        {navLink(
          "channels",
          "Channels",
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 4a2 2 0 012-2h6a2 2 0 012 2v4a2 2 0 01-2 2H6l-3 2v-2H4a2 2 0 01-2-2V4z" />
          </svg>,
        )}
        {navLink(
          "quests",
          "Quests",
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          >
            <path d="M4 3h8M4 7h8M4 11h6M2 3v0.4.0v0M2 11v0" strokeLinecap="round" />
          </svg>,
          "New quest",
        )}
        {navLink(
          "ideas",
          "Ideas",
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
          >
            <path
              d="M7 2v2M7 10v2M2 7h2M10 7h2M3.8 3.8l1.4 1.4M8.8 8.8l1.4 1.4M10.2 3.8l-1.4 1.4M5.2 8.8l-1.4 1.4"
              strokeLinecap="round"
            />
          </svg>,
          "New idea",
        )}
        {navLink(
          "drive",
          "Drive",
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 4.5a1 1 0 011-1h3l1.5 1.5H11a1 1 0 011 1V10a1 1 0 01-1 1H3a1 1 0 01-1-1V4.5z" />
          </svg>,
          undefined,
          { rootOnly: true },
        )}
        {navLink(
          "tools",
          "Tools",
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          >
            <path d="M8.5 2.5l3 3-7.5 7.5H1v-3l7.5-7.5z" />
          </svg>,
        )}
        {navLink(
          "apps",
          "Apps",
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinejoin="round"
          >
            <rect x="2" y="2" width="4" height="4" rx="0.5" />
            <rect x="8" y="2" width="4" height="4" rx="0.5" />
            <rect x="2" y="8" width="4" height="4" rx="0.5" />
            <rect x="8" y="8" width="4" height="4" rx="0.5" />
          </svg>,
          undefined,
          { rootOnly: true },
        )}
      </nav>

      <div className="left-sidebar-body">
        <AgentTree />
      </div>
    </div>
  );
}
