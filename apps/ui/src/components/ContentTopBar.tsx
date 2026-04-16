import { useParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";

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
  const agents = useDaemonStore((s) => s.agents);

  const section = tab || "";
  let config = PAGE_CONFIG[section];
  if (!config) {
    // Home (no tab) — show the agent's display name.
    const agent = agents.find((a) => a.id === agentId || a.name === agentId);
    config = { title: agent?.display_name || agent?.name || "Home" };
  }

  // Count active agents in this tree (exclude the root itself, which is the workspace).
  const activeAgents = agents.filter((a) => {
    if (a.id === agentId || !a.parent_id) return false;
    const s = a.status;
    return s === "active" || s === "running";
  }).length;

  return (
    <div className="content-topbar">
      <div className="content-topbar-left">
        <span className="content-topbar-title">{config.title}</span>
        {activeAgents > 0 && <span className="content-topbar-meta">{activeAgents} active</span>}
      </div>
      <div className="content-topbar-right">
        {config.create && (
          <button
            className="content-topbar-btn"
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
          </button>
        )}
      </div>
    </div>
  );
}
