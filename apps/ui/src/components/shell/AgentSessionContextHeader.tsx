import { useMemo } from "react";
import { useParams } from "react-router-dom";
import ParticipantStrip from "@/components/sessions/ParticipantStrip";
import { gatewayLabel, sessionLabel, type SessionInfo } from "@/components/session/types";
import { useRelativeNow } from "@/hooks/useRelativeNow";
import { timeAgo } from "@/lib/format";
import { useChatStore } from "@/store/chat";
import { useDaemonStore } from "@/store/daemon";
import MobileSessionsSwitcher from "./MobileSessionsSwitcher";

const NO_SESSIONS: SessionInfo[] = [];

function fallbackOrigin(name: string | undefined): string | null {
  const lower = name?.toLowerCase() || "";
  if (lower.includes("telegram group")) return "telegram · group";
  if (lower.includes("telegram")) return "telegram";
  if (lower.includes("whatsapp")) return "WhatsApp";
  return null;
}

function activityLabel(session: SessionInfo | null, isStreaming: boolean): string | null {
  if (isStreaming) return "Streaming…";
  const ts = session?.last_active || session?.created_at;
  return ts ? `Active ${timeAgo(ts)}` : null;
}

export default function AgentSessionContextHeader() {
  useRelativeNow();

  const { trustId, trustAddress, agentId, itemId } = useParams<{
    trustId?: string;
    trustAddress?: string;
    agentId?: string;
    itemId?: string;
  }>();

  const agents = useDaemonStore((s) => s.agents);
  const entities = useDaemonStore((s) => s.entities);
  const sessions = useChatStore((s) =>
    agentId ? s.sessionsByAgent[agentId] || NO_SESSIONS : NO_SESSIONS,
  );
  const streamingSessions = useChatStore((s) => s.streamingSessions);

  const agent = useMemo(() => agents.find((a) => a.id === agentId) ?? null, [agents, agentId]);
  const currentSession = useMemo(
    () => sessions.find((session) => session.id === itemId) ?? null,
    [sessions, itemId],
  );
  const resolvedTrustId =
    trustId ||
    (trustAddress ? entities.find((entity) => entity.trust_address === trustAddress)?.id : "");

  const title = currentSession ? sessionLabel(currentSession) : agent?.name || agentId || "Agent";
  const subtitle = currentSession
    ? (gatewayLabel(currentSession) ?? fallbackOrigin(currentSession.name))
    : "Agent sessions";
  const active = activityLabel(currentSession, !!(itemId && streamingSessions[itemId]));
  const isStreaming = !!(itemId && streamingSessions[itemId]);

  return (
    <div className="agent-session-context-header session-detail-header" aria-label={title}>
      <div className="session-detail-header-from">
        <span className="session-detail-header-title" title={title}>
          {title}
        </span>
        <div className="session-detail-header-meta">
          {subtitle && (
            <span className="session-detail-header-subtitle" title={subtitle}>
              {subtitle}
            </span>
          )}
          {subtitle && active && (
            <span className="session-detail-header-meta-sep" aria-hidden>
              ·
            </span>
          )}
          {active && (
            <span
              className={`session-detail-header-activity${isStreaming ? " is-streaming" : ""}`}
              role="status"
              aria-live="polite"
            >
              {active}
            </span>
          )}
        </div>
      </div>
      {(itemId || agentId) && (
        <div className="session-detail-header-extras agent-session-context-header-extras">
          <MobileSessionsSwitcher currentTitle={title} />
          <ParticipantStrip
            sessionId={itemId ?? null}
            trustId={resolvedTrustId || undefined}
            activeParticipantIds={isStreaming && agentId ? [agentId] : []}
          />
        </div>
      )}
    </div>
  );
}
