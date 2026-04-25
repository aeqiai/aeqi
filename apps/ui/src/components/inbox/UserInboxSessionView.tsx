import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDaemonStore } from "@/store/daemon";
import { useInboxStore } from "@/store/inbox";
import AgentSessionView from "@/components/AgentSessionView";
import BlockAvatar from "@/components/BlockAvatar";
import { api } from "@/lib/api";

interface Props {
  sessionId: string;
}

/**
 * User-scope inbox session view. Lives at `/sessions/:sessionId`.
 *
 * Resolves the underlying agent_id from the inbox store (fast path) or
 * by fetching the daemon's session list (recovery path for stale
 * URLs). Renders a pinned context header — `answering [agent_name]`
 * with the awaiting subject — above the standard AgentSessionView so
 * the user never loses sight of what they're replying to as the
 * conversation scrolls. Same WS chat, same composer plumbing as the
 * agent-scope route.
 *
 * The session "happens to be" awaiting; nothing about answering it is
 * structurally different from a regular reply, because the daemon
 * clears `awaiting_at` whenever a user message lands on an awaiting
 * session.
 *
 * Loading shape: show nothing until resolved (the rail and greeting
 * already give the user something to read), then mount the wrapped
 * view. On unresolvable session_id (no inbox match, no live session),
 * bounce back to `/`.
 */
export default function UserInboxSessionView({ sessionId }: Props) {
  const navigate = useNavigate();
  // Read the matching inbox item directly so a freshly-arriving WS
  // update reconciles the view without a remount. Item disappears
  // post-answer; the header gracefully degrades to the cached agent
  // name once `match` is null.
  const inboxItem = useInboxStore((s) => s.items.find((i) => i.session_id === sessionId) ?? null);
  const [resolvedAgentId, setResolvedAgentId] = useState<string | null>(
    inboxItem?.agent_id ?? null,
  );
  const [resolveFailed, setResolveFailed] = useState(false);

  // Fast path: inbox store knows the answer.
  useEffect(() => {
    if (inboxItem?.agent_id) setResolvedAgentId(inboxItem.agent_id);
  }, [inboxItem?.agent_id]);

  // Recovery path: not in inbox (already answered, or direct URL).
  // Fetch the user's session list and find the matching id. The daemon
  // tenancy filter limits this to sessions the user can see.
  useEffect(() => {
    if (resolvedAgentId) return;
    if (inboxItem?.agent_id) return;
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
  }, [sessionId, inboxItem?.agent_id, resolvedAgentId]);

  // Stale URL → no longer answerable from this surface. Bounce home.
  useEffect(() => {
    if (resolveFailed) navigate("/", { replace: true });
  }, [resolveFailed, navigate]);

  // Cache the inbox-item snapshot we resolved with — the live store
  // entry vanishes the instant the user answers, but the user is
  // still reading the conversation. Hold onto the last good copy so
  // the header stays put while the agent's response streams in.
  const [snapshotItem, setSnapshotItem] = useState(inboxItem);
  useEffect(() => {
    if (inboxItem) setSnapshotItem(inboxItem);
  }, [inboxItem]);

  // Daemon agent record for a clean display name when the inbox
  // join is missing (e.g. recovery path).
  const agentRecord = useDaemonStore((s) =>
    resolvedAgentId ? (s.agents.find((a) => a.id === resolvedAgentId) ?? null) : null,
  );

  if (!resolvedAgentId) return null;

  const headerItem = inboxItem ?? snapshotItem;
  const agentName = headerItem?.agent_name || agentRecord?.name || "agent";
  const subject = headerItem?.awaiting_subject ?? null;

  return (
    <div className="user-session">
      <header className="user-session-header" aria-label="Awaiting reply context">
        <span className="user-session-avatar" aria-hidden="true">
          <BlockAvatar name={agentName} size={20} />
        </span>
        <h2 className="user-session-title">answering {agentName}</h2>
        {subject && <p className="user-session-subject">{subject}</p>}
      </header>
      <div className="user-session-body">
        <AgentSessionView agentId={resolvedAgentId} sessionId={sessionId} />
      </div>
    </div>
  );
}
