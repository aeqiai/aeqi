import { useLocation, useParams } from "react-router-dom";
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
};

export default function ContentTopBar() {
  const location = useLocation();
  const params = useParams<{ root?: string }>();
  const agents = useDaemonStore((s) => s.agents);

  // Strip `/:root` prefix to get the section (e.g. "agents", "events", "" for home).
  const rootId = params.root || "";
  const section = location.pathname
    .replace(new RegExp(`^/${rootId}/?`), "")
    .split("/")[0];

  let config = PAGE_CONFIG[section];
  if (!config) {
    // Home (empty section) — show the root agent's display name.
    const root = agents.find((a) => a.id === rootId);
    config = { title: root?.display_name || root?.name || "Home" };
  }

  // Count active agents in this root's tree only (exclude root itself, which is the workspace).
  const activeAgents = agents.filter((a) => {
    if (a.id === rootId || !a.parent_id) return false;
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
