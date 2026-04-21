import { Link, useParams, useSearchParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui";
import BudgetMeter from "./BudgetMeter";

/**
 * Content top bar — agent context + secondary actions.
 *
 * Primary "New X" CTAs live inline in each tab's body (the tab's own picker
 * owns its "+" button). This bar carries: breadcrumb title, view toggles
 * that affect the main pane (Ideas graph toggle), and the budget meter.
 */

const TITLES: Record<string, string> = {
  channels: "Channels",
  drive: "Drive",
  settings: "Settings",
  tools: "Tools",
};
// Breadcrumb primitives render lowercase with an accent-tinted initial.
// Inbox joins the four W-primitives here even though the URL segment is
// `sessions` — in the page title it's "inbox" so the leading `i` can pick
// up the brand blue, mirroring the rail's rhythm.
const PRIMITIVE_WORDS: Record<string, string> = {
  sessions: "inbox",
  agents: "agents",
  events: "events",
  quests: "quests",
  ideas: "ideas",
};

export default function ContentTopBar() {
  const { tab, agentId } = useParams<{ tab?: string; agentId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const cost = useDaemonStore((s) => s.cost);
  const agents = useDaemonStore((s) => s.agents);
  const appMode = useAuthStore((s) => s.appMode);

  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const section = tab || "sessions";
  const primitiveWord = PRIMITIVE_WORDS[section];

  const exploreActive = section === "ideas" && searchParams.get("view") === "graph";
  const toggleExplore = () => {
    const next = new URLSearchParams(searchParams);
    if (exploreActive) next.delete("view");
    else next.set("view", "graph");
    setSearchParams(next, { replace: true });
  };

  const openPalette = () => window.dispatchEvent(new CustomEvent("aeqi:open-palette"));
  const openShortcuts = () => window.dispatchEvent(new CustomEvent("aeqi:open-shortcuts"));
  const isMac =
    typeof navigator !== "undefined" && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

  return (
    <div className="content-topbar">
      <div className="content-topbar-title">
        {agent &&
          (section === "sessions" ? (
            <span className="content-topbar-agent">{agent.display_name || agent.name}</span>
          ) : (
            <Link
              to={`/${encodeURIComponent(agent.id)}`}
              className="content-topbar-agent content-topbar-agent-link"
              title={`Back to ${agent.display_name || agent.name}'s inbox`}
            >
              {agent.display_name || agent.name}
            </Link>
          ))}
        {agent && (
          <Link
            to={`/${encodeURIComponent(agent.id)}/settings`}
            className={`content-topbar-gear${section === "settings" || section === "tools" || section === "channels" ? " active" : ""}`}
            aria-label="Agent settings"
            title="Agent settings — model, tools, channels"
          >
            <svg
              width="13"
              height="13"
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
          </Link>
        )}
        {agent && <span className="content-topbar-sep">/</span>}
        <span className={`content-topbar-section${primitiveWord ? " is-primitive" : ""}`}>
          {primitiveWord ? (
            <>
              <span className="sidebar-nav-initial">{primitiveWord[0]}</span>
              {primitiveWord.slice(1)}
            </>
          ) : (
            TITLES[section] || section
          )}
        </span>
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
        {section === "ideas" && (
          <Button
            variant="secondary"
            size="sm"
            className={`explore-btn${exploreActive ? " active" : ""}`}
            onClick={toggleExplore}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="3" cy="3" r="1.3" />
              <circle cx="9" cy="3" r="1.3" />
              <circle cx="6" cy="9" r="1.3" />
              <path d="M3 3 L9 3 M3 3 L6 9 M9 3 L6 9" strokeLinecap="round" />
            </svg>
            {exploreActive ? "Close graph" : "Explore"}
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
