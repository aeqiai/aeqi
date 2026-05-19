import { useNavigate } from "react-router-dom";
import {
  Inbox,
  Sparkles,
  LayoutDashboard,
  Coins,
  PieChart,
  Vote,
  Workflow,
  Bot,
  Webhook,
  Target,
  Lightbulb,
  ScrollText,
  Shield,
  Search,
  Plus,
  PanelLeftClose,
  PanelLeftOpen,
  Store,
} from "lucide-react";
import ActingAsSelector from "@/components/shell/ActingAsSelector";
import AccountDropdown from "@/components/shell/AccountDropdown";
import HelpMenu from "@/components/shell/HelpMenu";
import { IconButton, Tooltip } from "@/components/ui";
import { useUIStore } from "@/store/ui";
import { useAuthStore } from "@/store/auth";
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
const StartIcon = () => <Sparkles />;
// Overview — the trust cockpit. LayoutDashboard reads "this is the
// canonical landing for the trust." The Trust group header carries the
// institution semantic so this glyph doesn't need to.
const OverviewIcon = () => <LayoutDashboard />;
const AgentsIcon = () => <Bot />;
const EventsIcon = () => <Webhook />;
const QuestsIcon = () => <Target />;
const IdeasIcon = () => <Lightbulb />;

// AEQI Ownership primitives — Lucide picks anchored to each row's semantic.
// Assets (a) → Coins: stacked-coin = stored value.
// Equity (e) → PieChart: cap-table slice.
// Quorum (q) → Vote: ballot-into-box = decision/governance.
// Incorporation (i) → ScrollText: founding document / charter.
const AssetsIcon = () => <Coins />;
const EquityIcon = () => <PieChart />;
const QuorumIcon = () => <Vote />;
const IncorporationIcon = () => <ScrollText />;
// Roles — its own peer slot under Trust, outside both AEQI groups. The
// org-chart authority graph (RoleNewPage / RoleDetailPage et al). Workflow
// reads parent + child boxes = hierarchy.
const RolesIcon = () => <Workflow />;
// Economy — Store reads marketplace/commerce; the row navigates to /economy.
const EconomyIcon = () => <Store />;

// Admin — Lucide's Shield is the same silhouette as the prior hand-rolled.
const AdminIcon = () => <Shield />;
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
  const isAdmin = path === "/admin" || path.startsWith("/admin/");
  const isAdminUser = useAuthStore((s) => s.user?.is_admin === true);

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
      {/* ── Header — account dropdown lives top-left, replacing the
          previous Wordmark slot. The collapse toggle still hangs on the
          right edge of the row. ── */}
      <div className="sidebar-header">
        {!sidebarCollapsed ? (
          <>
            <AccountDropdown />
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
          {topLevelItem("/", "Start", <StartIcon />, isStart)}
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

        {/* ── Identity group — the operating-context "ID card". Only
            mounts when a trust is active. Clicking the block navigates
            to /identity where the user can switch contexts. The block
            itself shows a small trust avatar + role + trust name + a
            right chevron — it reads as an ID badge. ── */}
        {hasCompany && (
          <nav className="sidebar-surface-nav sidebar-zone" aria-label="Identity">
            <div className="sidebar-section-label">Identity</div>
            <div className="sidebar-user-zone">
              <ActingAsSelector />
            </div>
          </nav>
        )}

        {/* ── Company-scope items. Visible only when a company is
            selected. Order matches the Phase-1 lock:
              TRUST (cockpit / overview — Health folded in)
              Inbox
              ORGANIZATION  (Roles · Ownership · Treasury · Governance · Channels)
              WORKSPACE     (Agents · Events · Quests · Ideas)
              Settings (standalone, gap above) ── */}
        {hasCompany && (
          <>
            <nav className="sidebar-surface-nav sidebar-zone" aria-label="Trust">
              <div className="sidebar-section-label">Trust</div>
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

        {/* ── Bottom row — single horizontal row with Admin pinned left
            (only for admin users) + HelpMenu pinned right. The Help cap
            sits flush-right regardless of whether Admin is present; an
            empty flex-grow placeholder occupies the left slot when Admin
            isn't rendered so Help's right-edge position stays stable. ── */}
        <div className="sidebar-bottom-group">
          <div className="sidebar-action-row sidebar-action-row--bottom">
            {isAdminUser ? (
              <nav className="sidebar-surface-nav sidebar-action-row-nav" aria-label="Admin">
                {topLevelItem("/admin", "Admin", <AdminIcon />, isAdmin)}
              </nav>
            ) : (
              <span className="sidebar-action-row-spacer" aria-hidden="true" />
            )}
            <HelpMenu />
          </div>
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
