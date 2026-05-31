import { sessionLabel, type SessionInfo } from "@/components/session/types";
import type { ConnectedSessionRef } from "@/store/chat";
import type { Agent } from "@/lib/types";

export interface ComposerSessionOption {
  id: string;
  agentId: string;
  label: string;
}

export function composerSessionOptions(sessions: SessionInfo[]): ComposerSessionOption[] {
  return sessions
    .filter((session) => session.id && session.agent_id)
    .slice()
    .sort((a, b) => {
      const aTs = Date.parse(a.last_active || a.created_at || "") || 0;
      const bTs = Date.parse(b.last_active || b.created_at || "") || 0;
      return bTs - aTs;
    })
    .map((session) => ({
      id: session.id,
      agentId: session.agent_id as string,
      label: sessionLabel(session),
    }));
}

export function sessionsGroupedByAgent(sessions: SessionInfo[]): Map<string, SessionInfo[]> {
  const grouped = new Map<string, SessionInfo[]>();
  sessions.forEach((session) => {
    if (!session.agent_id) return;
    const next = grouped.get(session.agent_id) ?? [];
    next.push(session);
    grouped.set(session.agent_id, next);
  });
  return grouped;
}

export function connectedSessionRef(
  session: SessionInfo | null | undefined,
): Omit<ConnectedSessionRef, "touchedAt"> | null {
  if (!session?.id || !session.agent_id) return null;
  return {
    id: session.id,
    agentId: session.agent_id,
    label: sessionLabel(session),
  };
}

export function searchParam(search: string, key: string): string | null {
  const clean = search.startsWith("?") ? search.slice(1) : search;
  const encodedKey = encodeURIComponent(key);
  for (const part of clean.split("&")) {
    const splitAt = part.indexOf("=");
    const rawKey = splitAt === -1 ? part : part.slice(0, splitAt);
    const rawValue = splitAt === -1 ? "" : part.slice(splitAt + 1);
    if (rawKey === encodedKey) return decodeURIComponent(rawValue.replace(/\+/g, " "));
  }
  return null;
}

export function resolveDockComposerBinding({
  agents,
  entityId,
  sessionsByAgent,
  connectedSession,
  activeAgentSessions,
  activeAgentId,
}: {
  agents: Agent[];
  entityId: string;
  sessionsByAgent: Record<string, SessionInfo[]>;
  connectedSession: ConnectedSessionRef | null | undefined;
  activeAgentSessions: SessionInfo[];
  activeAgentId: string;
}) {
  const companyAgentIds = new Set(
    agents
      .filter((agent) => agent.company_id === entityId || agent.id === entityId)
      .map((agent) => agent.id),
  );
  const sessionOptions = composerSessionOptions(
    Object.values(sessionsByAgent)
      .flat()
      .filter((session) => {
        if (!session.agent_id || session.session_type === "task") return false;
        return companyAgentIds.size === 0 || companyAgentIds.has(session.agent_id);
      })
      .filter((session, index, all) => all.findIndex((item) => item.id === session.id) === index),
  );
  const connectedOption = connectedSession
    ? sessionOptions.find((option) => option.id === connectedSession.id)
    : null;
  const fallback = activeAgentSessions
    .filter((session) => session.session_type !== "task")
    .slice()
    .sort((a, b) => {
      const aTs = Date.parse(a.last_active || a.created_at || "") || 0;
      const bTs = Date.parse(b.last_active || b.created_at || "") || 0;
      return bTs - aTs;
    })[0];
  const fallbackOption = fallback
    ? {
        id: fallback.id,
        agentId: fallback.agent_id ?? activeAgentId,
        label: sessionLabel(fallback),
      }
    : null;
  const session = connectedOption ?? connectedSession ?? fallbackOption;
  return {
    dockSessionOptions: sessionOptions,
    dockConnectedSession: session,
    dockAgentId: session?.agentId || activeAgentId,
  };
}
