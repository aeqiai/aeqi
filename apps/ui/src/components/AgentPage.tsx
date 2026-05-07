import { Suspense, lazy } from "react";
import { useParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";

const AgentSessionView = lazy(() => import("./AgentSessionView"));
const AgentSurfaceHeader = lazy(() => import("./AgentSurfaceHeader"));

/**
 * Agent rail tabs — the SETTINGS sub-surface rail. Drilled-into-an-agent
 * default URL (`/c/<entity>/agents/<agent>/`) shows the inbox/chat
 * shape with no rail; settings (`/c/<entity>/agents/<agent>/settings`)
 * is where the rail lives.
 *
 * Inbox is dropped from the rail (now the default agent surface).
 * Settings is the rail's container, not a tab inside it.
 *
 * Rail order: Overview · Quests · Events · Ideas · Channels ·
 * Treasury · Tools · Integrations.
 *
 * Personality was dropped 2026-05-08 — Ideas (HOW per the four
 * W-primitives) defines the agent's identity/instructions/memories;
 * a separate Personality tab duplicated what Ideas already does.
 */
export const AGENT_RAIL_TABS = [
  { id: "overview", label: "Overview" },
  { id: "quests", label: "Quests" },
  { id: "events", label: "Events" },
  { id: "ideas", label: "Ideas" },
  { id: "channels", label: "Channels" },
  { id: "treasury", label: "Treasury" },
  { id: "tools", label: "Tools" },
  { id: "integrations", label: "Integrations" },
];

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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <Suspense fallback={null}>
        <AgentSurfaceHeader agentId={resolvedAgentId} />
        <div className="agent-page-chat">
          <AgentSessionView agentId={agentId} sessionId={sessionId} />
        </div>
      </Suspense>
    </div>
  );
}
