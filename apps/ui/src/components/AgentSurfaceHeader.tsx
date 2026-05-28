import { Link } from "react-router-dom";
import { MessagesSquare, Plus, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import { Button, Tooltip } from "@/components/ui";
import AgentAvatar from "./AgentAvatar";
import SurfaceHeader from "./SurfaceHeader";

/**
 * Header for the drilled-agent default surface. Wraps the shared
 * SurfaceHeader primitive with agent-specific data (avatar + name) and
 * mode switcher (Inbox / Settings) and actions.
 *
 * Variants:
 *   - "default" (drilled-agent landing) → [← Agents] · <Agent name> ·
 *     [Inbox | Settings] · [+ New]
 *   - "settings" (settings sub-surface) → [← Agents] · <Agent name> ·
 *     [Inbox | Settings]
 *
 * The chat surface lives one level beneath the header — sessions rail
 * to the left of the chat column (mounted by AppLayout), composer at
 * the bottom of the chat column.
 */
export default function AgentSurfaceHeader({
  agentId,
  variant = "default",
  middle,
}: {
  agentId: string;
  variant?: "default" | "settings";
  middle?: ReactNode;
}) {
  const { entityPath, base } = useNav();
  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const agentName = agent?.name || agentId;
  const trustId = agent?.trust_id || "";

  const encodedAgentId = encodeURIComponent(agentId);
  const backHref = trustId ? entityPath(trustId, "agents") : base ? `${base}/agents` : "/";
  const sessionHref = `${base}/agents/${encodedAgentId}`;
  const settingsHref = `${base}/agents/${encodeURIComponent(agentId)}/settings`;
  const activeMode = variant === "settings" ? "settings" : "sessions";

  // "New" — broadcast the same custom event the type-anywhere shortcut
  // uses. AgentSessionView listens for this and resets the active
  // conversation. Same affordance as the canonical +New button on the
  // Ideas / Quests toolbars: ink primary CTA.
  const handleNewSession = () => {
    window.dispatchEvent(new CustomEvent("aeqi:new-session"));
  };

  const title = (
    <span className="agent-surface-header-agent">
      <span className="agent-surface-header-avatar" aria-hidden>
        <AgentAvatar name={agentName} />
      </span>
      <span className="agent-surface-header-name">{agentName}</span>
    </span>
  );

  const actions = (
    <>
      <nav className="agent-surface-header-switcher" aria-label="Agent views">
        <Tooltip content="Agent sessions inbox">
          <Link
            to={sessionHref}
            aria-current={activeMode === "sessions" ? "page" : undefined}
            className="agent-surface-header-switch"
          >
            <MessagesSquare size={14} strokeWidth={1.5} aria-hidden="true" />
            Inbox
          </Link>
        </Tooltip>
        <Tooltip content="Agent settings">
          <Link
            to={settingsHref}
            aria-current={activeMode === "settings" ? "page" : undefined}
            className="agent-surface-header-switch"
          >
            <Settings size={14} strokeWidth={1.5} aria-hidden="true" />
            Settings
          </Link>
        </Tooltip>
      </nav>
      {variant === "default" && (
        <>
          <Tooltip content="Start a fresh conversation with this agent">
            <Button
              variant="primary"
              size="md"
              onClick={handleNewSession}
              leadingIcon={<Plus size={14} strokeWidth={1.5} aria-hidden="true" />}
            >
              New
            </Button>
          </Tooltip>
        </>
      )}
    </>
  );

  return (
    <SurfaceHeader
      backHref={backHref}
      backLabel="Agents"
      title={title}
      middle={middle}
      actions={actions}
    />
  );
}
