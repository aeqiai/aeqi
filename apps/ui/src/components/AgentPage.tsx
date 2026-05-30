import { Suspense, lazy } from "react";
import { useParams } from "react-router-dom";

const AgentSessionView = lazy(() => import("./AgentSessionView"));

/**
 * Default drilled-agent chat surface (`/trust/<addr>/agents/<agent>/[inbox/<sid>]` legacy shape).
 *
 * AppLayout owns the shared topbar (agent identity, session search,
 * sort/filter, and actions), plus the sessions rail and composer. This
 * component owns only the selected conversation area.
 */
export default function AgentPage({
  agentId,
  itemId: itemIdProp,
}: {
  agentId: string;
  // Kept for AppLayout's call-site compatibility — no longer used to
  // pick a tab. The drilled-agent default shape is always chat.
  tab?: string;
  itemId?: string | null;
}) {
  const params = useParams<{ tab?: string; itemId?: string }>();
  // The URL `/trust/<addr>/agents/<aid>/inbox/<sid>` has tab="inbox" and
  // itemId=<sid>. Bare `/trust/<addr>/agents/<aid>/` has neither.
  // Either way, what we care about is the optional session id.
  const itemId = itemIdProp ?? params.itemId;
  const sessionId = itemId || null;

  return (
    <div className="agent-page">
      <Suspense fallback={null}>
        <div className="agent-page-chat">
          <AgentSessionView agentId={agentId} sessionId={sessionId} />
        </div>
      </Suspense>
    </div>
  );
}
