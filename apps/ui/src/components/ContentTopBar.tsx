import { useParams, useSearchParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui";
import BudgetMeter from "./BudgetMeter";

/**
 * Content top bar — agent context + actions for the current view.
 *
 * Navigation lives in the left rail (agent tree + surface nav). This bar
 * shows the current agent + tab as a title, plus the contextual right-side
 * actions: graph-view toggle on Ideas, a single primary "create" button
 * whose label matches the tab, and the budget meter.
 */

const TITLES: Record<string, string> = {
  "": "Home",
  sessions: "Sessions",
  agents: "Agents",
  events: "Events",
  quests: "Quests",
  ideas: "Ideas",
  channels: "Channels",
  drive: "Drive",
  settings: "Settings",
};

const CREATE_LABEL: Record<string, string> = {
  agents: "New agent",
  events: "New event",
  quests: "New quest",
  ideas: "New idea",
};

export default function ContentTopBar() {
  const { tab, agentId } = useParams<{ tab?: string; agentId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const cost = useDaemonStore((s) => s.cost);
  const agents = useDaemonStore((s) => s.agents);
  const appMode = useAuthStore((s) => s.appMode);

  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const section = tab || "";
  const title = TITLES[section] || section;
  const createLabel = CREATE_LABEL[section];

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
        {createLabel && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => window.dispatchEvent(new CustomEvent("aeqi:create"))}
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
            {createLabel}
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
