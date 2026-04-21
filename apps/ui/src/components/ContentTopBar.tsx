import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui";
import BlockAvatar from "./BlockAvatar";
import BudgetMeter from "./BudgetMeter";

/**
 * Content top bar — the layout navigation row.
 *
 * Always mounted, architectural, matching the sidebar tint so the header
 * band reads as one continuous strip across the viewport. Carries:
 * breadcrumb context (home / profile / {agent} / {section}), the global
 * command-palette trigger, keyboard-help, agent-scoped actions (Explore
 * / Settings), and the budget meter.
 *
 * Primary "New X" CTAs still live inline in each tab's body — the tab's
 * own picker owns its "+" button. The topbar is *navigation + context*,
 * never the primary CTA surface.
 */

// Breadcrumb renders lowercase with an accent-tinted initial — the only
// sections that earn a breadcrumb are the four W-primitives. `sessions`
// is the agent's default surface (no crumb), and settings/tools/channels
// are carried by the lit Settings button + the settings-shell sub-tab
// row below; repeating them here is just noise.
const PRIMITIVE_WORDS: Record<string, string> = {
  agents: "agents",
  events: "events",
  quests: "quests",
  ideas: "ideas",
};

export default function ContentTopBar() {
  const { tab, agentId } = useParams<{ tab?: string; agentId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const cost = useDaemonStore((s) => s.cost);
  const agents = useDaemonStore((s) => s.agents);
  const appMode = useAuthStore((s) => s.appMode);

  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const section = tab || "sessions";
  const primitiveWord = PRIMITIVE_WORDS[section];
  const isProfile = location.pathname === "/profile" || location.pathname.startsWith("/profile/");
  const isHome = !agentId && !isProfile;

  const openPalette = () => window.dispatchEvent(new CustomEvent("aeqi:open-palette"));
  const openShortcuts = () => window.dispatchEvent(new CustomEvent("aeqi:open-shortcuts"));
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

  const settingsActive = section === "settings" || section === "tools" || section === "channels";
  const showCrumb = Boolean(primitiveWord);

  const agentName = agent ? agent.display_name || agent.name : "";

  return (
    <div className="content-topbar">
      <div className="content-topbar-title">
        {isHome && <span className="content-topbar-scope">Home</span>}
        {isProfile && <span className="content-topbar-scope">Profile</span>}
        {agent &&
          (section === "sessions" ? (
            <span className="content-topbar-agent">
              <span className="content-topbar-agent-avatar" aria-hidden>
                <BlockAvatar name={agentName} size={26} />
              </span>
              <span className="content-topbar-agent-name">{agentName}</span>
            </span>
          ) : (
            <Link
              to={`/${encodeURIComponent(agent.id)}`}
              className="content-topbar-agent content-topbar-agent-link"
              title={`Back to ${agentName}'s inbox`}
            >
              <span className="content-topbar-agent-avatar" aria-hidden>
                <BlockAvatar name={agentName} size={26} />
              </span>
              <span className="content-topbar-agent-name">{agentName}</span>
            </Link>
          ))}
        {agent && showCrumb && <span className="content-topbar-sep">/</span>}
        {showCrumb && (
          <span className="content-topbar-crumb">
            <span className="sidebar-nav-initial">{primitiveWord[0]}</span>
            {primitiveWord.slice(1)}
          </span>
        )}
      </div>

      <div className="content-topbar-right">
        <button
          type="button"
          className="content-topbar-search"
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
          <span className="content-topbar-search-label">Search</span>
          <span className="content-topbar-search-kbd" aria-hidden="true">
            <kbd>{isMac ? "⌘" : "Ctrl"}</kbd>
            <kbd>K</kbd>
          </span>
        </button>
        <button
          type="button"
          className="content-topbar-help"
          onClick={openShortcuts}
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
        >
          ?
        </button>
        {agent && (
          <Button
            variant="secondary"
            size="sm"
            className={`topbar-settings-btn${settingsActive ? " active" : ""}`}
            onClick={() => navigate(`/${encodeURIComponent(agent.id)}/settings`)}
            title="Agent settings — model, tools, channels"
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="2" />
              <path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.7 3.3l-1.4 1.4M4.7 11.3l-1.4 1.4M12.7 12.7l-1.4-1.4M4.7 4.7l-1.4-1.4" />
            </svg>
            Settings
          </Button>
        )}
        {appMode !== "platform" && (
          <BudgetMeter
            spent={(cost?.spent_today_usd as number) ?? 0}
            cap={agent?.budget_usd ?? (cost?.daily_budget_usd as number) ?? 0}
          />
        )}
      </div>
    </div>
  );
}
