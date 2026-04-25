import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useInboxStore } from "@/store/inbox";
import AgentSessionView from "@/components/AgentSessionView";
import { api } from "@/lib/api";

interface Props {
  sessionId: string;
}

/**
 * User-scope inbox session view. Lives at `/sessions/:sessionId`.
 *
 * Resolves the underlying agent_id from the inbox store (fast path) or
 * by fetching the daemon's session list (recovery path for stale
 * URLs). Once resolved, renders the same AgentSessionView the per-agent
 * route uses — same WS chat, same composer plumbing, same message
 * rendering. The session "happens to be" awaiting; nothing about
 * answering it is structurally different from a regular reply, because
 * the daemon clears `awaiting_at` whenever a user message lands on
 * an awaiting session.
 *
 * Loading shape: show nothing until resolved (the rail and greeting
 * already give the user something to read), then mount AgentSessionView.
 * On unresolvable session_id (no inbox match, no live session), bounce
 * back to `/` rather than dead-ending on an empty page.
 */
export default function UserInboxSessionView({ sessionId }: Props) {
  const navigate = useNavigate();
  // Read items directly so a freshly-arriving WS update reconciles the
  // inbox match without remounting.
  const inboxAgentId = useInboxStore((s) => {
    const match = s.items.find((i) => i.session_id === sessionId);
    return match?.agent_id ?? null;
  });
  const [resolvedAgentId, setResolvedAgentId] = useState<string | null>(inboxAgentId);
  const [resolveFailed, setResolveFailed] = useState(false);

  // Fast path: inbox store knows the answer.
  useEffect(() => {
    if (inboxAgentId) setResolvedAgentId(inboxAgentId);
  }, [inboxAgentId]);

  // Recovery path: not in inbox (already answered, or direct URL).
  // Fetch the user's session list and find the matching id. The daemon
  // tenancy filter limits this to sessions the user can see.
  useEffect(() => {
    if (resolvedAgentId) return;
    if (inboxAgentId) return;
    let cancelled = false;
    api
      .getSessions()
      .then((data) => {
        if (cancelled) return;
        const sessions = (data?.sessions || []) as Array<Record<string, unknown>>;
        const match = sessions.find((s) => (s.id as string) === sessionId);
        const aid = match?.agent_id as string | undefined;
        if (aid) setResolvedAgentId(aid);
        else setResolveFailed(true);
      })
      .catch(() => {
        if (!cancelled) setResolveFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, inboxAgentId, resolvedAgentId]);

  // Stale URL → no longer answerable from this surface. The session may
  // still exist (already answered), but the user's "answering inbox"
  // mental model only fits awaiting items. Bounce home.
  useEffect(() => {
    if (resolveFailed) navigate("/", { replace: true });
  }, [resolveFailed, navigate]);

  if (!resolvedAgentId) return null;

  return <AgentSessionView agentId={resolvedAgentId} sessionId={sessionId} />;
}
