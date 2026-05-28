import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Inbox,
  House,
  LayoutDashboard,
  Workflow,
  MessagesSquare,
  Bot,
  Activity,
  Target,
  Lightbulb,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Globe,
  Blocks,
  Plug,
  Hash,
  Wrench,
  Users,
  Settings,
} from "lucide-react";
import ActingAsSelector from "@/components/shell/ActingAsSelector";
import AccountDropdown from "@/components/shell/AccountDropdown";
import Wordmark from "@/components/Wordmark";
import HelpMenu from "@/components/shell/HelpMenu";
import { IconButton, Tooltip } from "@/components/ui";
import { useUIStore } from "@/store/ui";
import { useDaemonStore } from "@/store/daemon";
import { useRuntimeStatus } from "@/hooks/useRuntimeStatus";
import { entityBasePath } from "@/lib/entityPath";

interface LeftSidebarProps {
  /** Canonical entity (organization) id. Sidebar tabs are org-scoped, not child-agent scoped. */
  trustId: string | null;
  path: string;
}

// Sidebar nav icons — Lucide, sized via CSS (.sidebar-nav-item > svg).
// Stroke width is overridden to 1.65 by layout.css for the 16px optical sweet
// spot; the icon prop here just controls glyph identity.
const InboxIcon = () => <Inbox />;
const HomeIcon = () => <House />;
// Views — the composable trust landing. LayoutDashboard reads "saved
// operating view" without overloading the Trust group itself.
const ViewsIcon = () => <LayoutDashboard />;
const AgentsIcon = () => <Bot />;
// Events — Activity: single-line waveform reads as the event stream
// without the busy three-node pretzel of the prior Webhook glyph.
const EventsIcon = () => <Activity />;
const QuestsIcon = () => <Target />;
const IdeasIcon = () => <Lightbulb />;
const SessionsIcon = () => <MessagesSquare />;
const ChannelsIcon = () => <Hash />;
const ToolsIcon = () => <Wrench />;
// Roles — its own peer slot under Trust, outside both AEQI groups. The
// org-chart authority graph (RoleNewPage / RoleDetailPage et al). Workflow
// reads parent + child boxes = hierarchy.
const RolesIcon = () => <Workflow />;
const MembersIcon = () => <Users />;
const AppsIcon = () => <Plug />;
const SettingsIcon = () => <Settings />;
// Economy — Globe reads "the wider network / world economy" — the
// marketplace + inference + stake activity is happening *out there*
// across every trust, not in your local store.
const EconomyIcon = () => <Globe />;
const BlueprintsIcon = () => <Blocks />;

// Admin — Lucide's Shield is the same silhouette as the prior hand-rolled.
const SearchIcon = () => <Search />;
// Sidebar collapse/expand — state-aware glyphs so the affordance reads
// in both directions.
const CollapseSidebarIcon = () => <PanelLeftClose />;
const ExpandSidebarIcon = () => <PanelLeftOpen />;

export default function LeftSidebar({ trustId, path }: LeftSidebarProps) {
  const navigate = useNavigate();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const [isMobileShell, setIsMobileShell] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);
  const commandKey = isMac ? "⌘" : "Ctrl";
  const mobileToggleLabel = mobileMenuOpen ? "Close navigation menu" : "Open navigation menu";

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const handleChange = () => {
      const matches = mediaQuery.matches;
      setIsMobileShell(matches);
      if (!matches) {
        setMobileMenuOpen(false);
      }
    };

    handleChange();
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [path]);

  const handleSidebarToggle = () => {
    if (isMobileShell) {
      setMobileMenuOpen((open) => !open);
      return;
    }

    toggleSidebar();
  };

  const openPalette = () => window.dispatchEvent(new CustomEvent("aeqi:open-palette"));

  // Per-row right-cap action. Always visible at the right edge of its
  // nav row, mirroring the bottom Account+Help row's HelpMenu cap.
  const rowAction = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    keyHint?: string,
  ) => (
    <Tooltip content={keyHint ? `${label} (${keyHint})` : label}>
      <IconButton
        className="sidebar-row-action-btn"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
        aria-label={label}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );

  // Derive canonical base path for sidebar tabs.
  const entities = useDaemonStore((s) => s.entities);
  const activeEntityObj = trustId ? (entities.find((e) => e.id === trustId) ?? null) : null;
  const base = activeEntityObj ? entityBasePath(activeEntityObj) : "";
  const hasCompany = !!trustId;

  // Runtime gate cue — when the TRUST has no runtime attached, the
  // execution-tab rows (Agents/Events/Quests/Ideas) read as locked
  // (reduced opacity). They stay clickable on purpose; the in-tab
  // upsell IS the conversion surface. While the status query is
  // in-flight or unavailable we leave them at full opacity.
  const runtimeStatus = useRuntimeStatus(trustId);
  const runtimeLocked = !runtimeStatus.isLoading && trustId !== null && !runtimeStatus.hasRuntime;

  const navHref = (id: string) => `${base}/${id}`;

  // The Views row stays lit ONLY at the bare trust URL —
  // Phase 1 promotes Treasury / Ownership / Governance / Roles to
  // top-level rows, so they own their own "active" state and shouldn't
  // double-light the trust landing.
  const isActiveTab = (id: string) => {
    if (!base) return false;
    return path === `${base}/${id}` || path.startsWith(`${base}/${id}/`);
  };
  const isCompanyOverview = !!base && path === base;

  // Top-level public rows.
  const isEconomy = path === "/economy" || path.startsWith("/economy/");
  const isBlueprints = path === "/blueprints" || path.startsWith("/blueprints/");
  const isStart = path === "/" || path === "/start" || path.startsWith("/start/");

  const navItem = (
    id: string,
    label: string,
    icon: React.ReactNode,
    opts: {
      soon?: boolean;
      action?: React.ReactNode;
      locked?: boolean;
      href?: string;
      active?: boolean;
    } = {},
  ) => {
    if (opts.soon) {
      return (
        <div key={id} className="sidebar-nav-row">
          <button
            type="button"
            className="sidebar-nav-item sidebar-nav-item--soon"
            disabled
            title={`${label} — coming soon`}
          >
            {icon}
            <span className="sidebar-nav-label">{label}</span>
          </button>
        </div>
      );
    }
    const active = opts.active ?? isActiveTab(id);
    const lockedCls = opts.locked ? "sidebar-nav-item--locked" : "";
    const titleHint = opts.locked ? `${label} — runtime required` : label;
    const href = opts.href ?? navHref(id);
    return (
      <div key={id} className="sidebar-nav-row">
        <a
          className={`sidebar-nav-item ${active ? "active" : ""} ${lockedCls}`.trim()}
          href={href}
          title={titleHint}
          aria-current={active ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            navigate(href);
          }}
        >
          {icon}
          <span className="sidebar-nav-label">{label}</span>
        </a>
        {opts.action}
      </div>
    );
  };

  // Top-level (non-entity-scoped) row helper. Used for Launch /
  // Blueprints / Account — paths that don't compose off `base`.
  // Mirrors `navItem` but takes an explicit href.
  const topLevelItem = (
    href: string,
    label: string,
    icon: React.ReactNode,
    active: boolean,
    opts: { action?: React.ReactNode } = {},
  ) => (
    <div key={href} className="sidebar-nav-row">
      <a
        className={`sidebar-nav-item ${active ? "active" : ""}`}
        href={href}
        title={label}
        aria-current={active ? "page" : undefined}
        onClick={(e) => {
          e.preventDefault();
          navigate(href);
        }}
      >
        {icon}
        <span className="sidebar-nav-label">{label}</span>
      </a>
      {opts.action}
    </div>
  );

  return (
    <div
      className={`left-sidebar${sidebarCollapsed ? " collapsed" : ""}${mobileMenuOpen ? " mobile-open" : ""}`}
      style={sidebarCollapsed ? undefined : { width: `${sidebarWidth}px` }}
    >
      {/* ── Header — aeqi wordmark top-left, collapse toggle on the
          right. Account moved back to the bottom of the rail
          (2026-05-19) — the wordmark anchors the rail visually and
          tells the user where they are at a glance. ── */}
      <div className="sidebar-header">
        {!sidebarCollapsed ? (
          <>
            <Link to="/" className="sidebar-brand" aria-label="aeqi — home">
              <Wordmark size={28} />
            </Link>
            <Tooltip
              content={isMobileShell ? mobileToggleLabel : `Collapse sidebar (${commandKey}B)`}
            >
              <IconButton
                className="sidebar-collapse-btn"
                onClick={handleSidebarToggle}
                aria-label={isMobileShell ? mobileToggleLabel : "Collapse sidebar"}
              >
                {isMobileShell && !mobileMenuOpen ? <ExpandSidebarIcon /> : <CollapseSidebarIcon />}
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <>
            <Tooltip
              content={isMobileShell ? mobileToggleLabel : `Expand sidebar (${commandKey}B)`}
            >
              <button
                type="button"
                className="sidebar-nav-item sidebar-brand-collapsed"
                onClick={handleSidebarToggle}
                aria-label={isMobileShell ? mobileToggleLabel : "Expand sidebar"}
              >
                <span className="sidebar-brand-collapsed-rest" aria-hidden="true">
                  <span
                    style={{
                      fontFamily: "var(--font-brand)",
                      fontSize: 18,
                      fontWeight: 400,
                      letterSpacing: "-0.02em",
                      color: "var(--color-accent)",
                      lineHeight: 1,
                    }}
                  >
                    æ
                  </span>
                </span>
                <span className="sidebar-brand-collapsed-hover" aria-hidden="true">
                  <ExpandSidebarIcon />
                </span>
                <span className="sidebar-brand-collapsed-mobile-wordmark" aria-hidden="true">
                  <Wordmark size={28} />
                </span>
              </button>
            </Tooltip>
            <Tooltip content={mobileToggleLabel}>
              <IconButton
                className="sidebar-collapse-btn sidebar-mobile-menu-btn"
                onClick={handleSidebarToggle}
                aria-label={mobileToggleLabel}
              >
                {mobileMenuOpen ? <CollapseSidebarIcon /> : <ExpandSidebarIcon />}
              </IconButton>
            </Tooltip>
          </>
        )}
      </div>

      <div className="left-sidebar-body">
        {/* ── Start rail — global personal surfaces stay directly under Home.
            Search is still owned by the Home row. Trust-owned surfaces live
            inside the trust group below. ── */}
        <nav className="sidebar-surface-nav sidebar-zone" aria-label="Start">
          {topLevelItem("/", "Home", <HomeIcon />, isStart, {
            action: rowAction("Search", <SearchIcon />, openPalette, `${isMac ? "⌘" : "Ctrl"}K`),
          })}
          {topLevelItem("/economy", "Economy", <EconomyIcon />, isEconomy)}
          {topLevelItem("/blueprints", "Blueprints", <BlueprintsIcon />, isBlueprints)}
        </nav>

        {/* ── Trust group — one continuous trust surface. Order follows the
            mental model: state, authority, humans, agents, conversations,
            channel/app/tool capabilities, then work records. ── */}
        {hasCompany && (
          <>
            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Trust">
              <div className="sidebar-section-label">Trust</div>
              <ActingAsSelector />
              <div key="views" className="sidebar-nav-row">
                <a
                  className={`sidebar-nav-item ${isCompanyOverview ? "active" : ""}`}
                  href={base}
                  title="Views"
                  aria-current={isCompanyOverview ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(base);
                  }}
                >
                  <ViewsIcon />
                  <span className="sidebar-nav-label">Views</span>
                </a>
              </div>
              {/* Roles — the org-chart / authority graph. Sits inside the
                  Trust group alongside Views; both describe what the
                  Trust IS rather than what it owns or what it does. */}
              {navItem("roles", "Roles", <RolesIcon />)}
              {/* Members — humans with trust access or pending invites. Kept
                  separate from Roles so unassigned humans are visible. */}
              {navItem("members", "Members", <MembersIcon />)}
              {navItem("agents", "Agents", <AgentsIcon />, {
                locked: runtimeLocked,
              })}
              {navItem("sessions", "Sessions", <SessionsIcon />, {
                locked: runtimeLocked,
              })}
              {navItem("inbox", "Inbox", <InboxIcon />)}
              {navItem("channels", "Channels", <ChannelsIcon />, {
                locked: runtimeLocked,
              })}
              {navItem("apps", "Apps", <AppsIcon />, {
                locked: runtimeLocked,
              })}
              {navItem("tools", "Tools", <ToolsIcon />, {
                locked: runtimeLocked,
              })}
              {navItem("events", "Events", <EventsIcon />, {
                locked: runtimeLocked,
              })}
              {navItem("quests", "Quests", <QuestsIcon />, {
                locked: runtimeLocked,
              })}
              {navItem("ideas", "Ideas", <IdeasIcon />, {
                locked: runtimeLocked,
              })}
              {navItem("settings", "Settings", <SettingsIcon />)}
            </nav>
          </>
        )}

        {/* ── Bottom — AccountDropdown (with Admin link inside its menu
            for admin users) + HelpMenu pinned right. Uses the same
            `.sidebar-surface-nav` / `.sidebar-nav-row` wrapping as the
            top Home+Search row so widths, hover reveal of the right-
            cap action, and collapsed-mode hiding all behave identically
            across the rail (2026-05-19). ── */}
        <div className="sidebar-bottom-group">
          <nav className="sidebar-surface-nav sidebar-zone" aria-label="Account">
            <div className="sidebar-nav-row sidebar-nav-row--account">
              <AccountDropdown />
              <HelpMenu />
            </div>
          </nav>
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
