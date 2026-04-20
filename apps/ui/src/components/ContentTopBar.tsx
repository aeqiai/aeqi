import { useParams, useSearchParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui";
import BudgetMeter from "./BudgetMeter";

/**
 * Content top bar — agent context + secondary actions.
 *
 * Primary "New X" CTAs live in the right-rail header (ContentCTA), adjacent
 * to the list they mutate. This bar carries: breadcrumb title, view toggles
 * that affect the main pane (Ideas graph toggle), and the budget meter.
 */

const TITLES: Record<string, string> = {
  "": "Inbox",
  sessions: "Inbox",
  agents: "Agents",
  events: "Events",
  quests: "Quests",
  ideas: "Ideas",
  channels: "Channels",
  drive: "Drive",
  settings: "Settings",
};

export default function ContentTopBar() {
  const { tab, agentId } = useParams<{ tab?: string; agentId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const cost = useDaemonStore((s) => s.cost);
  const agents = useDaemonStore((s) => s.agents);
  const appMode = useAuthStore((s) => s.appMode);

  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const section = tab || "sessions";
  const title = TITLES[section] || section;

  const exploreActive = section === "ideas" && searchParams.get("view") === "graph";
  const toggleExplore = () => {
    const next = new URLSearchParams(searchParams);
    if (exploreActive) next.delete("view");
    else next.set("view", "graph");
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="content-topbar">
      <div className="content-topbar-title">
        {agent && <span className="content-topbar-agent">{agent.display_name || agent.name}</span>}
        {agent && <span className="content-topbar-sep">/</span>}
        <span className="content-topbar-section">{title}</span>
      </div>

      <div className="content-topbar-right">
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
