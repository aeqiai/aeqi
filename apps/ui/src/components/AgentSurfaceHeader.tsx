import { useNav } from "@/hooks/useNav";
import { useDaemonStore } from "@/store/daemon";
import AgentAvatar from "./AgentAvatar";
import SurfaceHeader from "./SurfaceHeader";

/**
 * Header for drilled-agent sub-surfaces.
 *
 * The agent landing owns its primary actions in the body card. This top
 * row stays simple: back to Agents plus the current agent identity.
 */
export default function AgentSurfaceHeader({
  agentId,
}: {
  agentId: string;
  variant?: "default" | "settings";
}) {
  const { entityPath, base } = useNav();
  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const agentName = agent?.name || agentId;
  const trustId = agent?.trust_id || "";

  const backHref = trustId ? entityPath(trustId, "agents") : base ? `${base}/agents` : "/";

  const title = (
    <span className="agent-surface-header-agent">
      <span className="agent-surface-header-avatar" aria-hidden>
        <AgentAvatar name={agentName} />
      </span>
      <span className="agent-surface-header-name">{agentName}</span>
    </span>
  );

  return <SurfaceHeader backHref={backHref} backLabel="Agents" title={title} />;
}
