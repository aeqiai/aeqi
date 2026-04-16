import { useLocation, useParams } from "react-router-dom";

/** Page-keyed primary action shown at the top of the right rail. */
const PAGE_ACTIONS: Record<string, { label: string; event: string } | null> = {
  agents: { label: "New agent", event: "aeqi:create" },
  events: { label: "New event", event: "aeqi:create" },
  quests: { label: "New quest", event: "aeqi:create" },
  ideas: { label: "New idea", event: "aeqi:create" },
  sessions: { label: "New chat", event: "aeqi:new-session" },
  settings: null,
  profile: null,
  tools: null,
};

/**
 * Right rail inside the content card. Mirrors the `asv-sidebar` pattern used
 * on the chat / events / channels screens so the layout reads consistently:
 * CTA button at the top, list area below (currently empty for non-chat pages
 * — chat pages render their own session list inside `AgentPage`).
 */
export default function ContentCTA() {
  const location = useLocation();
  const params = useParams<{ root?: string }>();

  const rootId = params.root || "";
  const section = location.pathname.replace(new RegExp(`^/${rootId}/?`), "").split("/")[0] || "";

  // On a child agent (`/:root/agents/:id/...`) infer the section from the URL tab.
  const isAgentChild = section === "agents";
  const childSection = isAgentChild ? location.pathname.split("/")[4] || "sessions" : null;
  const effectiveSection = childSection || section;

  const action = PAGE_ACTIONS[effectiveSection] ?? null;

  return (
    <div className="asv-sidebar">
      {action && (
        <div className="asv-sidebar-header">
          <button
            className="asv-session-new-btn"
            onClick={() => window.dispatchEvent(new CustomEvent(action.event))}
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
            {action.label}
          </button>
        </div>
      )}
      <div className="asv-sidebar-list" />
    </div>
  );
}
