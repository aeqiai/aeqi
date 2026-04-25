import { IntegrationsPanel } from "@/components/IntegrationsPanel";

/**
 * Global integrations page (Settings → Integrations). Lists every pack
 * the operator can connect at the workspace level. Per-agent connections
 * are handled inside each agent's Settings tab.
 */
export default function SettingsIntegrationsPage() {
  return (
    <IntegrationsPanel
      scope={{ scope_kind: "global", scope_id: "" }}
      heading="Integrations"
      description="Connect aeqi to third-party services. Workspace-wide credentials apply to every agent unless overridden by an agent-scoped connection."
    />
  );
}
