import { Link, useNavigate } from "react-router-dom";
import {
  Inbox,
  House,
  LayoutDashboard,
  Coins,
  PieChart,
  Scale,
  Workflow,
  Bot,
  Activity,
  Target,
  Lightbulb,
  Landmark,
  Search,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Globe,
} from "lucide-react";
import ActingAsSelector from "@/components/shell/ActingAsSelector";
import AccountDropdown from "@/components/shell/AccountDropdown";
import Wordmark from "@/components/Wordmark";
import HelpMenu from "@/components/shell/HelpMenu";
import { IconButton, Tooltip } from "@/components/ui";
import { useUIStore } from "@/store/ui";
import { useDaemonStore } from "@/store/daemon";
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
// Overview — the trust cockpit. LayoutDashboard reads "this is the
// canonical landing for the trust." The Trust group header carries the
// institution semantic so this glyph doesn't need to.
const OverviewIcon = () => <LayoutDashboard />;
const AgentsIcon = () => <Bot />;
// Events — Activity: single-line waveform reads as the event stream
// without the busy three-node pretzel of the prior Webhook glyph.
const EventsIcon = () => <Activity />;
const QuestsIcon = () => <Target />;
const IdeasIcon = () => <Lightbulb />;

// AEQI Ownership primitives — Lucide picks anchored to each row's semantic.
// Assets (a) → Coins: stacked-coin = stored value.
// Equity (e) → PieChart: cap-table slice.
// Quorum (q) → Scale: balance-of-votes; cleaner symmetry than the prior
//   Vote glyph (hand-with-ballot) and reads as institutional gravity.
// Incorporation (i) → Landmark: columned facade = the institution itself,
//   replacing the curled ScrollText whose ornament didn't hold at 16px.
const AssetsIcon = () => <Coins />;
const EquityIcon = () => <PieChart />;
const QuorumIcon = () => <Scale />;
const IncorporationIcon = () => <Landmark />;
// Roles — its own peer slot under Trust, outside both AEQI groups. The
// org-chart authority graph (RoleNewPage / RoleDetailPage et al). Workflow
// reads parent + child boxes = hierarchy.
const RolesIcon = () => <Workflow />;
// Economy — Globe reads "the wider network / world economy" — the
// marketplace + inference + stake activity is happening *out there*
// across every trust, not in your local store.
const EconomyIcon = () => <Globe />;

// Admin — Lucide's Shield is the same silhouette as the prior hand-rolled.
const SearchIcon = () => <Search />;
const PlusIcon = () => <Plus />;
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
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

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

  const navHref = (id: string) => `${base}/${id}`;

  // The Organization cockpit row stays lit ONLY at the bare trust URL —
  // Phase 1 promotes Treasury / Ownership / Governance / Roles to
  // top-level rows, so they own their own "active" state and shouldn't
  // double-light Organization.
  const isActiveTab = (id: string) => {
    if (!base) return false;
    return path === `${base}/${id}` || path.startsWith(`${base}/${id}/`);
  };
  const isCompanyOverview = !!base && path === base;

  // Top-level public rows.
  const isEconomy = path === "/economy" || path.startsWith("/economy/");
  const isInbox = path === "/inbox" || path.startsWith("/inbox/");
  const isStart = path === "/" || path === "/start" || path.startsWith("/start/");

  const navItem = (
    id: string,
    label: string,
    icon: React.ReactNode,
    opts: { soon?: boolean; action?: React.ReactNode } = {},
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
    const active = isActiveTab(id);
    return (
      <div key={id} className="sidebar-nav-row">
        <a
          className={`sidebar-nav-item ${active ? "active" : ""}`}
          href={navHref(id)}
          title={label}
          aria-current={active ? "page" : undefined}
          onClick={(e) => {
            e.preventDefault();
            navigate(navHref(id));
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
      className={`left-sidebar${sidebarCollapsed ? " collapsed" : ""}`}
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
              <Wordmark size={20} />
            </Link>
            <Tooltip content={`Collapse sidebar (${isMac ? "⌘" : "Ctrl"}B)`}>
              <IconButton
                className="sidebar-collapse-btn"
                onClick={toggleSidebar}
                aria-label="Collapse sidebar"
              >
                <CollapseSidebarIcon />
              </IconButton>
            </Tooltip>
          </>
        ) : (
          <Tooltip content={`Expand sidebar (${isMac ? "⌘" : "Ctrl"}B)`}>
            <button
              type="button"
              className="sidebar-nav-item sidebar-brand-collapsed"
              onClick={toggleSidebar}
              aria-label="Expand sidebar"
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
            </button>
          </Tooltip>
        )}
      </div>

      <div className="left-sidebar-body">
        {/* ── Start row — standalone, sits above the Global group. The
            user's anchor home — clicking returns to the welcome /
            arrival surface from anywhere in the shell. ── */}
        <nav className="sidebar-surface-nav sidebar-zone" aria-label="Start">
          {topLevelItem("/", "Home", <HomeIcon />, isStart)}
        </nav>

        {/* ── Cross-trust destinations. No group label — Inbox + Economy
            speak for themselves at the top of the rail, and dropping
            the eyebrow gives the IDENTITY label downstream more weight
            (it becomes the first group label the eye lands on, marking
            the sacredness of the identity zone). ── */}
        <nav className="sidebar-surface-nav sidebar-zone" aria-label="Cross-trust">
          {topLevelItem("/inbox", "Inbox", <InboxIcon />, isInbox, {
            action: rowAction("Search", <SearchIcon />, openPalette, `${isMac ? "⌘" : "Ctrl"}K`),
          })}
          {topLevelItem("/economy", "Economy", <EconomyIcon />, isEconomy)}
        </nav>

        {/* ── Trust group — folds the identity selector (the operating-
            context ID badge) and the trust-scoped tabs (Overview, Roles)
            into one coherent block. Viewing the current trust and the
            role you hold in it are the SAME concern — splitting them
            into "Identity" + "Trust" groups was redundant. The selector
            sits at the top of the group (click to switch context), then
            the trust-scoped tabs below. ── */}
        {hasCompany && (
          <>
            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Trust">
              <div className="sidebar-section-label">Trust</div>
              <ActingAsSelector />
              <div key="overview" className="sidebar-nav-row">
                <a
                  className={`sidebar-nav-item ${isCompanyOverview ? "active" : ""}`}
                  href={base}
                  title="Overview"
                  aria-current={isCompanyOverview ? "page" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(base);
                  }}
                >
                  <OverviewIcon />
                  <span className="sidebar-nav-label">Overview</span>
                </a>
              </div>
              {/* Roles — the org-chart / authority graph. Sits inside the
                  Trust group alongside Overview; both describe what the
                  Trust IS rather than what it owns or what it does. */}
              {navItem("roles", "Roles", <RolesIcon />)}
            </nav>

            {/* AEQI ownership grammar — assets · equity · quorum · incorporation.
                The four rows spell the wordmark in order. Section label
                reinforces "this is who owns / runs the TRUST". */}
            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Ownership">
              <div className="sidebar-section-label">Ownership</div>
              {navItem("assets", "Assets", <AssetsIcon />)}
              {navItem("equity", "Equity", <EquityIcon />)}
              {navItem("quorum", "Quorum", <QuorumIcon />)}
              {navItem("incorporation", "Incorporation", <IncorporationIcon />)}
            </nav>

            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Execution">
              <div className="sidebar-section-label">Execution</div>
              {navItem("agents", "Agents", <AgentsIcon />, {
                action: rowAction("New agent", <PlusIcon />, () => {
                  // TrustAgentsTab listens for `aeqi:create` to open the
                  // BlueprintPickerModal. Navigate first so the listener is
                  // mounted, then dispatch on the next tick.
                  navigate(`${base}/agents`);
                  setTimeout(() => window.dispatchEvent(new CustomEvent("aeqi:create")), 0);
                }),
              })}
              {navItem("events", "Events", <EventsIcon />, {
                action: rowAction("New event", <PlusIcon />, () => {
                  navigate(`${base}/events?compose=1`);
                }),
              })}
              {navItem("quests", "Quests", <QuestsIcon />, {
                action: rowAction("New quest", <PlusIcon />, () => {
                  navigate(`${base}/quests/new`);
                }),
              })}
              {navItem("ideas", "Ideas", <IdeasIcon />, {
                action: rowAction("New idea", <PlusIcon />, () => {
                  navigate(`${base}/ideas?compose=1`);
                }),
              })}
            </nav>
          </>
        )}

        {/* ── Bottom — AccountDropdown (with Admin link inside its menu
            for admin users) + HelpMenu pinned right. Uses the same
            `.sidebar-surface-nav` / `.sidebar-nav-row` wrapping as the
            top Inbox+Search row so widths, hover reveal of the right-
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
