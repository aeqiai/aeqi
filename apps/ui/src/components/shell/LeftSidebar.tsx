import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  AppWindow,
  Box,
  ChevronDown,
  CircleDollarSign,
  House,
  LayoutDashboard,
  Workflow,
  MessagesSquare,
  PinOff,
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
  Waypoints,
  Wrench,
  Users,
  Settings,
  ReceiptText,
  ScrollText,
  WalletCards,
} from "lucide-react";
import ActingAsSelector from "@/components/shell/ActingAsSelector";
import AccountDropdown from "@/components/shell/AccountDropdown";
import Wordmark from "@/components/Wordmark";
import HelpMenu from "@/components/shell/HelpMenu";
import { Icon, IconButton, Tooltip } from "@/components/ui";
import { useUIStore, type PinnedView } from "@/store/ui";
import { useDaemonStore } from "@/store/daemon";
import { useRuntimeStatus } from "@/hooks/useRuntimeStatus";
import { entityBasePath } from "@/lib/entityPath";
import { sessionsViewFromSearch, USER_SESSIONS_VIEW_ID } from "@/lib/sessionViews";
import {
  isUserSessionsPinnedViewForPath,
  PINNED_USER_SESSIONS_STORAGE_KEY,
  useSeedUserSessionsPinnedView,
} from "@/components/shell/useSeedUserSessionsPinnedView";
import {
  TRUST_NAV_MATCHES,
  type TrustNavGroupId,
  type TrustNavGroupState,
} from "@/components/shell/sidebarNavModel";

interface LeftSidebarProps {
  /** Canonical entity (organization) id. Sidebar tabs are org-scoped, not child-agent scoped. */
  trustId: string | null;
  path: string;
}

// Sidebar nav icons — routed through the shared Icon primitive so the rail
// follows the Storybook iconography rules (16px default, 1.5 stroke).
const HomeIcon = () => <Icon icon={House} />;
// Views — the composable trust landing. LayoutDashboard reads "saved
// operating view" without overloading the Trust group itself.
const ViewsIcon = () => <Icon icon={LayoutDashboard} />;
const AgentsIcon = () => <Icon icon={Bot} />;
// Events — Activity: single-line waveform reads as the event stream
// without the busy three-node pretzel of the prior Webhook glyph.
const EventsIcon = () => <Icon icon={Activity} />;
const QuestsIcon = () => <Icon icon={Target} />;
const IdeasIcon = () => <Icon icon={Lightbulb} />;
const SessionsIcon = () => <Icon icon={MessagesSquare} />;
const GatewaysIcon = () => <Icon icon={Waypoints} />;
const ToolsIcon = () => <Icon icon={Wrench} />;
const AppsIcon = () => <Icon icon={AppWindow} />;
const BudgetsIcon = () => <Icon icon={WalletCards} />;
const TransactionsIcon = () => <Icon icon={ReceiptText} />;
const SharesIcon = () => <Icon icon={ScrollText} />;
const RoundsIcon = () => <Icon icon={CircleDollarSign} />;
const AssetsIcon = () => <Icon icon={Box} />;
// Roles — its own peer slot under Trust. The org-chart authority graph owns
// hierarchy, selection, creation, and inline property edits in one workspace.
const RolesIcon = () => <Icon icon={Workflow} />;
const MembersIcon = () => <Icon icon={Users} />;
const IntegrationsIcon = () => <Icon icon={Plug} />;
const SettingsIcon = () => <Icon icon={Settings} />;
// Economy — Globe reads "the wider network / world economy" — the
// marketplace + inference + stake activity is happening *out there*
// across every trust, not in your local store.
const EconomyIcon = () => <Icon icon={Globe} />;
const BlueprintsIcon = () => <Icon icon={Blocks} />;

// Admin — Lucide's Shield is the same silhouette as the prior hand-rolled.
const SearchIcon = () => <Icon icon={Search} size="sm" />;
// Sidebar collapse/expand — state-aware glyphs so the affordance reads
// in both directions.
const CollapseSidebarIcon = () => <Icon icon={PanelLeftClose} size="sm" />;
const ExpandSidebarIcon = () => <Icon icon={PanelLeftOpen} size="sm" />;
const GroupChevronIcon = () => <Icon icon={ChevronDown} size="sm" />;
const UnpinIcon = () => <Icon icon={PinOff} size="sm" />;

export default function LeftSidebar({ trustId, path }: LeftSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth);
  const pinnedViews = useUIStore((s) => s.pinnedViews);
  const savePinnedView = useUIStore((s) => s.savePinnedView);
  const removePinnedView = useUIStore((s) => s.removePinnedView);
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
  const globalPinnedViews = pinnedViews.filter((view) => !view.trustId);
  const trustPinnedViews = pinnedViews.filter((view) => view.trustId === trustId);
  const userSessionsPinnedPath = base ? `${base}/sessions` : "";
  const isUserSessionsPinnedView = (view: PinnedView) =>
    isUserSessionsPinnedViewForPath(view, userSessionsPinnedPath);
  useSeedUserSessionsPinnedView({ trustId, userSessionsPinnedPath, pinnedViews, savePinnedView });

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
  const isCompanyOverview = !!base && (path === base || path === "/trust");
  const activeUserSessionsView =
    !!base &&
    isActiveTab("sessions") &&
    sessionsViewFromSearch(location.search) === USER_SESSIONS_VIEW_ID;
  const isActiveGroupTab = (id: string) =>
    id === "sessions" && activeUserSessionsView ? false : isActiveTab(id);
  const isActiveWithin = (ids: string[]) => ids.some((id) => isActiveGroupTab(id));
  const activeTrustGroup =
    (Object.entries(TRUST_NAV_MATCHES) as Array<[TrustNavGroupId, string[]]>).find(([, ids]) =>
      isActiveWithin(ids),
    )?.[0] ?? null;
  const [openTrustGroups, setOpenTrustGroups] = useState<TrustNavGroupState>(() => ({
    operations: !activeTrustGroup || activeTrustGroup === "operations",
    ownership: activeTrustGroup === "ownership",
    infrastructure: activeTrustGroup === "infrastructure",
  }));

  useEffect(() => {
    if (!activeTrustGroup) return;
    setOpenTrustGroups((current) =>
      current[activeTrustGroup] ? current : { ...current, [activeTrustGroup]: true },
    );
  }, [activeTrustGroup, path]);

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

  const pinnedViewItem = (view: PinnedView) => {
    const href = `${view.path}${view.search}`;
    const active = path === view.path && location.search === view.search;
    const isUserSessionsView = isUserSessionsPinnedView(view);
    const removeView = () => {
      if (isUserSessionsView && typeof window !== "undefined") {
        window.localStorage.setItem(PINNED_USER_SESSIONS_STORAGE_KEY, "false");
      }
      removePinnedView(view.id);
      if (isUserSessionsView && activeUserSessionsView) {
        navigate(`${base}/sessions`);
      }
    };

    return (
      <div key={view.id} className="sidebar-nav-row">
        <a
          className={`sidebar-nav-item ${active ? "active" : ""}`}
          href={href}
          title={view.label}
          aria-current={active ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            navigate(href);
          }}
        >
          {isUserSessionsView ? <SessionsIcon /> : <ViewsIcon />}
          <span className="sidebar-nav-label">{view.label}</span>
        </a>
        {rowAction(`Unpin ${view.label}`, <UnpinIcon />, removeView)}
      </div>
    );
  };

  const trustNavGroup = (id: TrustNavGroupId, label: string, items: React.ReactNode) => {
    const open = openTrustGroups[id];
    const active = activeTrustGroup === id;

    return (
      <section key={id} className={`sidebar-group ${open ? "" : "collapsed"}`} aria-label={label}>
        <button
          type="button"
          className={`sidebar-group-title${active ? " active" : ""}`}
          aria-expanded={open}
          onClick={() => setOpenTrustGroups((current) => ({ ...current, [id]: !current[id] }))}
        >
          <span className="sidebar-group-label">{label}</span>
          <span className="sidebar-group-chevron" aria-hidden>
            <GroupChevronIcon />
          </span>
        </button>
        {open && <div className="sidebar-group-items">{items}</div>}
      </section>
    );
  };

  const collapsedBrandButton = (ariaLabel: string) => (
    <button
      type="button"
      className="sidebar-nav-item sidebar-brand-collapsed"
      onClick={handleSidebarToggle}
      aria-label={ariaLabel}
      data-pill-allowed=""
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
            {isMobileShell ? (
              <IconButton
                className="sidebar-collapse-btn"
                onClick={handleSidebarToggle}
                aria-label={mobileToggleLabel}
              >
                {!mobileMenuOpen ? <ExpandSidebarIcon /> : <CollapseSidebarIcon />}
              </IconButton>
            ) : (
              <Tooltip content={`Collapse sidebar (${commandKey}B)`}>
                <IconButton
                  className="sidebar-collapse-btn"
                  onClick={handleSidebarToggle}
                  aria-label="Collapse sidebar"
                >
                  <CollapseSidebarIcon />
                </IconButton>
              </Tooltip>
            )}
          </>
        ) : (
          <>
            {isMobileShell ? (
              collapsedBrandButton(mobileToggleLabel)
            ) : (
              <Tooltip content={`Expand sidebar (${commandKey}B)`}>
                {collapsedBrandButton("Expand sidebar")}
              </Tooltip>
            )}
            <IconButton
              className="sidebar-collapse-btn sidebar-mobile-menu-btn"
              onClick={handleSidebarToggle}
              aria-label={mobileToggleLabel}
            >
              {mobileMenuOpen ? <CollapseSidebarIcon /> : <ExpandSidebarIcon />}
            </IconButton>
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
          {globalPinnedViews.map(pinnedViewItem)}
        </nav>

        {/* ── Trust group — pinned views first, then primitive registries. ── */}
        {hasCompany && (
          <>
            <nav className="sidebar-surface-nav sidebar-zone sidebar-trust-nav" aria-label="Trust">
              <div className={`sidebar-section-label${isCompanyOverview ? " active" : ""}`}>
                Trust
              </div>
              <ActingAsSelector />
              {trustPinnedViews.map(pinnedViewItem)}
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
              {trustNavGroup(
                "operations",
                "Operations",
                <>
                  {navItem("agents", "Agents", <AgentsIcon />, {
                    locked: runtimeLocked,
                  })}
                  {navItem("sessions", "Sessions", <SessionsIcon />, {
                    locked: runtimeLocked,
                    active: isActiveTab("sessions") && !activeUserSessionsView,
                  })}
                  {navItem("quests", "Quests", <QuestsIcon />, {
                    locked: runtimeLocked,
                  })}
                  {navItem("ideas", "Ideas", <IdeasIcon />, {
                    locked: runtimeLocked,
                  })}
                  {navItem("apps", "Apps", <AppsIcon />, {
                    active: isActiveWithin(["apps", "mails", "websites", "campaigns"]),
                  })}
                  {navItem("events", "Events", <EventsIcon />, {
                    locked: runtimeLocked,
                  })}
                </>,
              )}
              {trustNavGroup(
                "ownership",
                "Ownership",
                <>
                  {navItem("roles", "Roles", <RolesIcon />)}
                  {navItem("members", "Members", <MembersIcon />)}
                  {navItem("shares", "Shares", <SharesIcon />, {
                    active: isActiveWithin(["shares", "equity"]),
                  })}
                  {navItem("rounds", "Rounds", <RoundsIcon />)}
                  {navItem("budgets", "Budgets", <BudgetsIcon />)}
                  {navItem("assets", "Assets", <AssetsIcon />)}
                  {navItem("transactions", "Transactions", <TransactionsIcon />)}
                </>,
              )}
              {trustNavGroup(
                "infrastructure",
                "Infrastructure",
                <>
                  {navItem("integrations", "Integrations", <IntegrationsIcon />, {
                    locked: runtimeLocked,
                  })}
                  {navItem("gateways", "Gateways", <GatewaysIcon />, {
                    locked: runtimeLocked,
                  })}
                  {navItem("tools", "Tools", <ToolsIcon />, {
                    locked: runtimeLocked,
                  })}
                  {navItem("settings", "Settings", <SettingsIcon />)}
                </>,
              )}
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
