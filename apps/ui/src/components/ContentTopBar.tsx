import { useParams, useSearchParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { Button } from "@/components/ui";

const PAGE_CONFIG: Record<string, { title: string; create?: { label: string } }> = {
  agents: { title: "Agents", create: { label: "New agent" } },
  events: { title: "Events", create: { label: "New event" } },
  quests: { title: "Quests", create: { label: "New quest" } },
  ideas: { title: "Ideas", create: { label: "New idea" } },
  sessions: { title: "Sessions" },
  settings: { title: "Settings" },
  profile: { title: "Profile" },
  tools: { title: "Tools" },
  drive: { title: "Drive" },
  apps: { title: "Apps" },
};

/**
 * Header strip shown above non-AgentPage content (root dashboard, drive,
 * apps). Version B: tab comes directly from URL params.
 */
export default function ContentTopBar() {
  const { agentId, tab } = useParams<{ agentId?: string; tab?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const agents = useDaemonStore((s) => s.agents);

  const section = tab || "";
  let config = PAGE_CONFIG[section];
  if (!config) {
    // Home (no tab) — the agent's own name shows in the left rail/avatar,
    // so keep this label generic instead of repeating it.
    config = { title: "Home" };
  }

  // Count active agents in this tree (exclude the root itself, which is the workspace).
  const activeAgents = agents.filter((a) => {
    if (a.id === agentId || !a.parent_id) return false;
    const s = a.status;
    return s === "active" || s === "running";
  }).length;

  // Ideas-only "Explore" toggle. URL-driven so the graph view is linkable
  // and survives reloads; the itemId in the route already acts as focus.
  const exploreActive = section === "ideas" && searchParams.get("view") === "graph";
  const toggleExplore = () => {
    const next = new URLSearchParams(searchParams);
    if (exploreActive) next.delete("view");
    else next.set("view", "graph");
    setSearchParams(next, { replace: true });
  };

  return (
    <div className="content-topbar">
      <div className="content-topbar-left">
        <span className="content-topbar-title">{config.title}</span>
        {activeAgents > 0 && <span className="content-topbar-meta">{activeAgents} active</span>}
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
        {config.create && (
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
            {config.create.label}
          </Button>
        )}
      </div>
    </div>
  );
}
