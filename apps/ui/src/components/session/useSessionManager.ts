import { useState, useRef, useEffect, useCallback } from "react";
import { useNav } from "@/hooks/useNav";
import { useChatStore } from "@/store/chat";
import { api } from "@/lib/api";
import { isRateLimited } from "@/lib/rateLimit";
import { type Message, type SessionInfo } from "./types";

interface UseSessionManagerOptions {
  agentId: string;
  urlSessionId: string | null;
  processRawMessages: (raw: Array<Record<string, unknown>>) => Message[];
}

/**
 * Hook managing session list, navigation, message loading, and polling.
 * Call `setStreaming` from the parent to control polling behavior.
 */
export function useSessionManager({
  agentId,
  urlSessionId,
  processRawMessages,
}: UseSessionManagerOptions) {
  const { goAgent } = useNav();
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const streamingRef = useRef(false);

  const activeSessionId = urlSessionId;
  const sessionIdRef = useRef<string | null>(activeSessionId);
  useEffect(() => {
    sessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Navigate helpers. The Inbox landing is the bare `/:agentId` URL —
  // there is no `/sessions` suffix when no session is picked. Only append
  // the tab segment when we have a real sessionId to carry.
  const setSession = useCallback(
    (sid: string | null) => {
      if (sid) goAgent(agentId, "sessions", sid, { replace: true });
      else goAgent(agentId, undefined, undefined, { replace: true });
    },
    [agentId, goAgent],
  );

  // Load sessions for this agent
  useEffect(() => {
    if (!agentId) return;
    api
      .getSessions(agentId)
      .then((d: Record<string, unknown>) => {
        const list: SessionInfo[] = (d.sessions as SessionInfo[]) || [];
        setSessions(list);
      })
      .catch(() => setSessions([]));
  }, [agentId]);

  // Mirror the session list into chat store so the SessionsRail (threads
  // rail) can render it without a duplicate fetch.
  const setSessionsForAgent = useChatStore((s) => s.setSessionsForAgent);
  useEffect(() => {
    if (!agentId) return;
    setSessionsForAgent(agentId, sessions);
  }, [agentId, sessions, setSessionsForAgent]);

  // Track previous session for reload detection
  const prevSessionRef = useRef<string | null>(null);

  // Start a new conversation
  const handleNewConversation = useCallback(() => {
    prevSessionRef.current = null;
    sessionIdRef.current = null;
    setMessages([]);
    setSession(null);
  }, [setSession]);

  // Fork session from a message
  const handleFork = useCallback(
    async (messageId: number) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      try {
        const result = await api.forkSession(sid, messageId);
        if (result.ok && result.session_id) {
          setSessions((prev) => [
            {
              id: result.session_id,
              agent_id: agentId,
              name: "Fork",
              status: "active",
              created_at: new Date().toISOString(),
            },
            ...prev,
          ]);
          prevSessionRef.current = null;
          sessionIdRef.current = result.session_id;
          setMessages([]);
          setSession(result.session_id);
        }
      } catch {
        // silently fail
      }
    },
    [agentId, setSession],
  );

  // Switch to an existing session
  const handleSelectSession = useCallback(
    (sid: string) => {
      prevSessionRef.current = null;
      sessionIdRef.current = sid;
      setMessages([]);
      setSession(sid);
    },
    [setSession],
  );

  // Load messages when session changes
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      prevSessionRef.current = null;
      return;
    }

    if (activeSessionId === prevSessionRef.current) return;
    prevSessionRef.current = activeSessionId;

    api
      .getSessionMessages(activeSessionId, 1000)
      .then((d: Record<string, unknown>) => {
        const loaded = processRawMessages((d.messages as Array<Record<string, unknown>>) || []);
        if (loaded.length > 0) {
          setMessages(loaded);
        }
      })
      .catch(() => {});
  }, [activeSessionId, processRawMessages]);

  // Poll for new messages on sessions not driven by local WebSocket.
  // Uses streamingRef so the interval checks latest streaming state without
  // needing to restart the interval on every streaming toggle. Pauses while
  // the global rate-limit is engaged — otherwise a single 429 triggers an
  // endless 3-per-interval cascade that keeps the lockout extended.
  useEffect(() => {
    if (!activeSessionId) return;
    const iv = setInterval(() => {
      if (streamingRef.current) return;
      if (isRateLimited()) return;
      api
        .getSessionMessages(activeSessionId, 1000)
        .then((d: Record<string, unknown>) => {
          const loaded = processRawMessages((d.messages as Array<Record<string, unknown>>) || []);
          if (loaded.length > 0) {
            setMessages((prev) => (loaded.length !== prev.length ? loaded : prev));
          }
        })
        .catch(() => {});
    }, 10000);
    return () => clearInterval(iv);
  }, [activeSessionId, processRawMessages]);

  return {
    sessions,
    setSessions,
    messages,
    setMessages,
    activeSessionId,
    sessionIdRef,
    prevSessionRef,
    streamingRef,
    setSession,
    handleNewConversation,
    handleFork,
    handleSelectSession,
  };
}
