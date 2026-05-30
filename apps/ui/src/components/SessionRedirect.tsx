import { useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import { api } from "@/lib/api";
import { sessionDeepUrlFromId } from "@/lib/sessionUrl";

interface Resolved {
  agentId: string;
  trustId: string;
}

/**
 * Bounces the legacy flat `/sessions/:sessionId` URL onto the canonical
 * deep shape `/trust/<addr>/sessions/<sessionId>`.
 *
 * Resolution order:
 * 1. Inbox store (sync, populated for awaiting sessions).
 * 2. Daemon-store agent record (sync, populated after AppLayout fetches).
 * 3. `getSessions()` (async, last resort — works on cold loads even
 *    when the redirect renders outside AppLayout).
 *
 * Bounces home when the session can't be resolved.
 */
export default function SessionRedirect() {
  const { sessionId = "" } = useParams<{ sessionId: string }>();
  const inboxItem = useInboxStore((s) => s.items.find((i) => i.session_id === sessionId) ?? null);
  const agents = useDaemonStore((s) => s.agents);
  const entities = useDaemonStore((s) => s.entities);

  const inboxResolved: Resolved | null = useMemo(
    () =>
      inboxItem?.agent_id && inboxItem?.trust_id
        ? { agentId: inboxItem.agent_id, trustId: inboxItem.trust_id }
        : null,
    [inboxItem?.agent_id, inboxItem?.trust_id],
  );

  const [resolved, setResolved] = useState<Resolved | null>(inboxResolved);
  const [resolveFailed, setResolveFailed] = useState(false);

  useEffect(() => {
    if (resolved) return;
    if (inboxResolved) {
      setResolved(inboxResolved);
      return;
    }
    if (!sessionId) {
      setResolveFailed(true);
      return;
    }

    // Daemon store may have the agent already (warm reload). Look up
    // the entity from there. Only useful when an agent is loaded that
    // owns this session, which we don't know without the agent_id —
    // so this path only kicks in when something earlier set the
    // resolved agentId (today: inboxResolved). Skip and fall through.

    let cancelled = false;
    api
      .getSessions()
      .then((data) => {
        if (cancelled) return;
        const sessions = (data?.sessions || []) as Array<Record<string, unknown>>;
        const match = sessions.find((s) => (s.id as string) === sessionId);
        const agentId = match?.agent_id as string | undefined;
        const entityIdFromRow = match?.trust_id as string | undefined;
        if (!agentId) {
          setResolveFailed(true);
          return;
        }
        const entityFromStore = agents.find((a) => a.id === agentId)?.trust_id;
        const trustId = entityIdFromRow ?? entityFromStore ?? null;
        if (!trustId) {
          setResolveFailed(true);
          return;
        }
        setResolved({ agentId, trustId });
      })
      .catch(() => {
        if (!cancelled) setResolveFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, inboxResolved, resolved, agents]);

  if (resolveFailed) return <Navigate to="/" replace />;
  if (!resolved) return null;

  const deep = sessionDeepUrlFromId(entities, resolved.trustId, resolved.agentId, sessionId);
  return <Navigate to={deep} replace />;
}
