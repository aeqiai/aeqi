import { Suspense, lazy } from "react";
import { useParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";

const AgentSessionView = lazy(() => import("./AgentSessionView"));
const AgentSurfaceHeader = lazy(() => import("./AgentSurfaceHeader"));

/**
 * Default drilled-agent surface (`/c/<entity>/agents/<agent>/[inbox/<sid>]`).
 *
 * No rail. A header (back-to-Agents · agent name · New session ·
 * Settings) anchors the surface; the body is the canonical inbox
 * chat shape (sessions list rail + active session detail with
 * composer — same surface as before, mounted via SessionsRail in
 * AppLayout). The header is the only breadcrumb at this depth — the
 * rail moved to /settings.
 *
 * AppLayout is responsible for mounting <SessionsRail> and
 * <ComposerRow> as siblings of this body. Here we just render the
 * AgentSurfaceHeader and the AgentSessionView (the chat content
 * column). When the URL is `/c/<eid>/agents/<aid>/inbox/<sid>`
 * AppLayout passes itemId; otherwise we open the agent without a
 * specific session selected.
 */
export default function AgentPage({
  agentId,
  itemId: itemIdProp,
}: {
  agentId: string;
  // Kept for AppLayout's call-site compatibility — no longer used to
  // pick a tab. The drilled-agent default shape is always inbox/chat.
  tab?: string;
  itemId?: string | null;
}) {
  const params = useParams<{ tab?: string; itemId?: string }>();
  // The URL `/c/<eid>/agents/<aid>/inbox/<sid>` has tab="inbox" and
  // itemId=<sid>. Bare `/c/<eid>/agents/<aid>/` has neither.
  // Either way, what we care about is the optional session id.
  const itemId = itemIdProp ?? params.itemId;
  const sessionId = itemId || null;

  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const resolvedAgentId = agent?.id || agentId;

  return (
    <div className="agent-page">
      <Suspense fallback={null}>
        <AgentSurfaceHeader agentId={resolvedAgentId} />
        <div className="agent-page-chat">
          <AgentSessionView agentId={agentId} sessionId={sessionId} />
        </div>
      </Suspense>
    </div>
  );
}
