import { useNavigate } from "react-router-dom";
import { BarChart3, Plus, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import { Button, Tooltip } from "@/components/ui";
import AgentAvatar from "./AgentAvatar";
import SurfaceHeader from "./SurfaceHeader";

/**
 * Header for the drilled-agent default surface. Wraps the shared
 * SurfaceHeader primitive with agent-specific data (avatar + name) and
 * actions (Settings, New).
 *
 * Variants:
 *   - "default" (drilled-agent landing) → [← Agents] · <Agent name> ·
 *     [Settings] · [+ New]  (New is the ink primary CTA, matching the
 *     canonical +New button on Ideas / Quests toolbars)
 *   - "settings" (settings sub-surface) → [← Back to <Agent>] ·
 *     <Agent name> / Settings (breadcrumb)
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
  const navigate = useNavigate();
  const { entityPath, base } = useNav();
  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const agentName = agent?.name || agentId;
  const trustId = agent?.trust_id || "";

  // Back link target. Default surface goes back to the entity's
  // Agents list; settings goes back to the agent's default (chat).
  const backHref =
    variant === "settings"
      ? `${base}/agents/${encodeURIComponent(agentId)}`
      : trustId
        ? entityPath(trustId, "agents")
        : "/";
  const backLabel = variant === "settings" ? agentName : "Agents";
  const settingsHref = `${base}/agents/${encodeURIComponent(agentId)}/settings`;
  const healthHref = `${base}/agents/${encodeURIComponent(agentId)}/health`;

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

  const crumbSuffix =
    variant === "settings" ? (
      <>
        <span className="agent-surface-header-sep" aria-hidden>
          /
        </span>
        <span className="agent-surface-header-crumb">Settings</span>
      </>
    ) : undefined;

  const actions =
    variant === "default" ? (
      <>
        <Tooltip content="Agent health — productivity, quality, goals">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(healthHref)}
            leadingIcon={<BarChart3 size={13} strokeWidth={1.5} aria-hidden="true" />}
          >
            Health
          </Button>
        </Tooltip>
        <Tooltip content="Agent settings — model, tools, channels">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(settingsHref)}
            leadingIcon={<Settings size={13} strokeWidth={1.5} aria-hidden="true" />}
          >
            Settings
          </Button>
        </Tooltip>
        <Tooltip content="Start a fresh conversation with this agent">
          <Button
            variant="primary"
            size="sm"
            onClick={handleNewSession}
            leadingIcon={<Plus size={13} strokeWidth={1.5} aria-hidden="true" />}
          >
            New
          </Button>
        </Tooltip>
      </>
    ) : undefined;

  return (
    <SurfaceHeader
      backHref={backHref}
      backLabel={backLabel}
      title={title}
      crumbSuffix={crumbSuffix}
      middle={middle}
      actions={actions}
    />
  );
}
