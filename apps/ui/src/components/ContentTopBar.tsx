import { useLocation } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";

const PAGE_CONFIG: Record<string, { title: string; create?: { label: string } }> = {
  "/": { title: "Home" },
  "/companies": { title: "Companies", create: { label: "New company" } },
  "/agents": { title: "Agents", create: { label: "New agent" } },
  "/events": { title: "Events", create: { label: "New event" } },
  "/quests": { title: "Quests", create: { label: "New quest" } },
  "/ideas": { title: "Ideas", create: { label: "New idea" } },
  "/settings": { title: "Settings" },
  "/account": { title: "Account" },
};

export default function ContentTopBar() {
  const location = useLocation();
  const path = location.pathname;
  const agents = useDaemonStore((s) => s.agents);
  const config = PAGE_CONFIG[path] || { title: path.slice(1) || "Home" };

  const activeAgents = agents.filter((a) => a.status === "active" || a.status === "running").length;

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
