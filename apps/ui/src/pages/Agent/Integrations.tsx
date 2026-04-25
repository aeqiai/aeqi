import { IntegrationsPanel } from "@/components/IntegrationsPanel";

interface AgentIntegrationsTabProps {
  agentId: string;
}

/**
 * Per-agent Integrations tab. Each agent has its own credential rows so a
 * Luca-style WhatsApp agent gets its own Gmail / GitHub / etc., separate
 * from the operator's personal credentials.
 */
export default function AgentIntegrationsTab({ agentId }: AgentIntegrationsTabProps) {
  return (
    <IntegrationsPanel
      scope={{ scope_kind: "agent", scope_id: agentId }}
      heading="Integrations"
      description="These credentials belong to this agent only. Other agents — including this one's parent and children — have their own connections."
    />
  );
}
