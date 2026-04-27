import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { getScopedRoot } from "@/lib/appMode";
import { useChatStore } from "@/store/chat";
import { type Message, type MessageSegment, type SessionInfo, formatDuration } from "./types";
import {
  initialStreamState,
  reduceStreamEvent,
  hasContent,
  type RawEvent,
  type StreamState,
  type TurnMeta,
} from "./streamReducer";
import type { AttachedFile } from "./useFileAttachments";

interface UseWebSocketChatOptions {
  token: string | null;
  agentId: string;
  agentName: string;
  activeSessionId: string | null;
  sessionIdRef: React.MutableRefObject<string | null>;
  prevSessionRef: React.MutableRefObject<string | null>;
  setSession: (sid: string | null) => void;
  setSessions: React.Dispatch<React.SetStateAction<SessionInfo[]>>;
  /** Snapshot of the current messages list. Read-only here — kept fresh by
   * the parent — used to decide whether to live-attach (skip when the
   * trailing assistant is already a completed turn). */
  messagesRef: React.MutableRefObject<Message[]>;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  sessionIdeas: string[];
  sessionTask: { id: string; name: string } | null;
  attachedFiles: AttachedFile[];
}

interface DispatchMessageOptions {
  sessionIdeas?: string[];
  sessionTask?: { id: string; name: string } | null;
  attachedFiles?: AttachedFile[];
}

export function useWebSocketChat({
  token,
  agentId,
  agentName,
  activeSessionId,
  sessionIdRef,
  prevSessionRef,
  setSession,
  setSessions,
  messagesRef,
  setMessages,
  sessionIdeas,
  sessionTask,
  attachedFiles,
}: UseWebSocketChatOptions) {
  const [streaming, setStreaming] = useState(false);
  const [liveSegments, setLiveSegments] = useState<MessageSegment[]>([]);
  const [thinkingStart, setThinkingStart] = useState<number | null>(null);
  const [liveStepOffset, setLiveStepOffset] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const wsSessionRef = useRef<string | null>(null);
  const setSessionStreaming = useChatStore((s) => s.setSessionStreaming);

  const clearLiveState = useCallback(() => {
    setStreaming(false);
    setLiveSegments([]);
    setThinkingStart(null);
    setLiveStepOffset(0);
    if (wsSessionRef.current) setSessionStreaming(wsSessionRef.current, false);
    wsRef.current = null;
    wsSessionRef.current = null;
  }, [setSessionStreaming]);

  const commitMessage = useCallback(
    (state: StreamState, append: boolean) => {
      const msg = messageFromState(state);
      if (!msg) return;
      setMessages((prev) => (append ? [...prev, msg] : insertBeforeQueued(prev, msg)));
    },
    [setMessages],
  );

  const commitSplitMessage = useCallback(
    (state: StreamState) => {
      const msg = messageFromState(state);
      if (!msg) return;
      // Split messages always append — they are committed mid-turn, after
      // any user bubble that preceded this turn.
      setMessages((prev) => [...prev, { ...msg, status: "split" as const }]);
    },
    [setMessages],
  );

  const attachEventHandlers = useCallback(
    (ws: WebSocket, startTime: number) => {
      let state = initialStreamState(startTime);

      ws.onmessage = (e) => {
        const raw = parseEvent(e.data);
        if (!raw) return;
        const result = reduceStreamEvent(state, raw);

        if (result.kind === "split") {
          // Commit the pre-split assistant entry, push a user bubble, then
          // continue with the fresh state carrying the step offset forward.
          commitSplitMessage(result.commit);
          const userBubble: Message = {
            role: "user",
            content: result.injectedText,
            timestamp: Date.now(),
            messageId: result.messageId,
          };
          setMessages((prev) => [...prev, userBubble]);
          state = result.next;
          // Reset the live trail to the fresh (empty) continuation state.
          setLiveSegments([]);
          setThinkingStart(state.thinkingStart);
          setLiveStepOffset(state.stepOffset);
          return;
        }

        // result.kind === "next"
        const next = result.state;
        if (next === state) return;
        const prevStart = state.thinkingStart;
        state = next;
        setLiveSegments(state.segments);
        if (state.thinkingStart !== prevStart) setThinkingStart(state.thinkingStart);
        if (!streaming && (hasContent(state) || state.thinkingStart > 0)) {
          setStreaming(true);
          if (wsSessionRef.current) setSessionStreaming(wsSessionRef.current, true);
        }
        if (state.status.kind === "complete") {
          commitMessage(state, false);
          clearLiveState();
          closeSilently(ws);
        } else if (state.status.kind === "error") {
          commitMessage(state, true);
          clearLiveState();
          closeSilently(ws);
        }
      };

      ws.onerror = () => clearLiveState();

      ws.onclose = () => {
        if (state.status.kind === "streaming") commitMessage(state, false);
        clearLiveState();
      };
    },
    [
      commitMessage,
      commitSplitMessage,
      clearLiveState,
      setMessages,
      setSessionStreaming,
      streaming,
    ],
  );

  const replaceSocket = useCallback((ws: WebSocket, sessionId: string | null) => {
    closeSilently(wsRef.current);
    wsRef.current = ws;
    wsSessionRef.current = sessionId;
  }, []);

  const dispatchMessage = useCallback(
    async (messageText: string, options?: DispatchMessageOptions) => {
      const turnIdeas = options?.sessionIdeas ?? sessionIdeas;
      const turnTask = options?.sessionTask ?? sessionTask;
      const turnFiles = options?.attachedFiles ?? attachedFiles;
      const { sessionId } = await ensureSession({
        sessionIdRef,
        prevSessionRef,
        setSession,
        setSessions,
        agentId,
        agentName,
        messageText,
      });

      if (!token || !sessionId) return;

      const startTime = Date.now();
      unmarkQueued(setMessages, messageText);
      setStreaming(true);
      setLiveSegments([]);
      setThinkingStart(startTime);
      setLiveStepOffset(0);
      setSessionStreaming(sessionId, true);

      const liveAttached = wsSessionRef.current === activeSessionId;
      if (liveAttached) {
        try {
          await api.sendSessionMessage({
            message: messageText,
            agent_id: agentId || undefined,
            session_id: sessionId,
            session_ideas: turnIdeas.length > 0 ? turnIdeas : undefined,
            quest_id: turnTask?.id,
            files:
              turnFiles.length > 0
                ? turnFiles.map((f) => ({ name: f.name, content: f.content }))
                : undefined,
          });
        } catch {
          clearLiveState();
        }
        return;
      }

      const ws = openChatSocket(token);
      replaceSocket(ws, sessionId);
      ws.onopen = () =>
        ws.send(
          JSON.stringify(
            sendPayload({
              messageText,
              agentId,
              sessionId,
              sessionIdeas: turnIdeas,
              sessionTask: turnTask,
              attachedFiles: turnFiles,
            }),
          ),
        );
      attachEventHandlers(ws, startTime);
    },
    [
      token,
      agentId,
      agentName,
      activeSessionId,
      sessionIdRef,
      prevSessionRef,
      setSession,
      setSessions,
      setMessages,
      clearLiveState,
      attachEventHandlers,
      replaceSocket,
      sessionIdeas,
      sessionTask,
      attachedFiles,
      setSessionStreaming,
    ],
  );

  const attachToLiveStream = useCallback(
    (sessionId: string) => {
      if (!token || !sessionId) return;
      // Decide based on what's already in the messages list.
      //
      // - Trailing draft assistant: turn is in-flight server-side, the
      //   StreamingMessage will replay the same content from the broadcast
      //   backlog and continue live. Drop the static partial here so the
      //   live trail is the only render.
      //
      // - Trailing completed assistant: the turn already finished, the DB
      //   reconstruction has the canonical content. `isSessionActive`
      //   sometimes returns true for a few hundred ms after the agent
      //   exits (registry race) — and the broadcast backlog isn't always
      //   cleared in time, so a fresh subscription would replay the whole
      //   turn into a SECOND committed message. Skip the live-attach.
      //
      // - No trailing assistant (just a user message, or empty): a fresh
      //   turn is presumably starting; attach so its events stream in.
      const last = messagesRef.current[messagesRef.current.length - 1];
      if (last?.role === "assistant" && !last.draft) return;

      setStreaming(true);
      setLiveSegments([]);
      setSessionStreaming(sessionId, true);
      if (last?.role === "assistant" && last.draft) {
        setMessages((prev) => {
          const tail = prev[prev.length - 1];
          return tail?.role === "assistant" && tail.draft ? prev.slice(0, -1) : prev;
        });
      }

      const ws = openChatSocket(token);
      replaceSocket(ws, sessionId);
      ws.onopen = () => ws.send(JSON.stringify({ subscribe: true, session_id: sessionId }));
      attachEventHandlers(ws, 0);
    },
    [token, attachEventHandlers, replaceSocket, setSessionStreaming, setMessages, messagesRef],
  );

  useEffect(() => {
    if (wsSessionRef.current === activeSessionId) return;
    closeSilently(wsRef.current);
    wsRef.current = null;
    wsSessionRef.current = null;
    clearLiveState();
  }, [activeSessionId, clearLiveState]);

  useEffect(() => {
    if (!token || !activeSessionId || streaming) return;
    let cancelled = false;
    api
      .isSessionActive(activeSessionId)
      .then((res) => {
        if (!cancelled && res?.active) attachToLiveStream(activeSessionId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-check on session change
  }, [activeSessionId, token]);

  const resetLiveSegments = useCallback(() => {
    setLiveSegments([]);
    setLiveStepOffset(0);
  }, []);

  const handleStop = useCallback((sessionIdRefCurrent: string | null) => {
    if (sessionIdRefCurrent) api.cancelSession(sessionIdRefCurrent).catch(() => {});
    wsRef.current?.close();
    wsSessionRef.current = null;
    setStreaming(false);
  }, []);

  return {
    streaming,
    liveSegments,
    thinkingStart,
    liveStepOffset,
    dispatchMessage,
    attachToLiveStream,
    resetLiveSegments,
    handleStop,
  };
}

function parseEvent(data: string): RawEvent | null {
  try {
    return JSON.parse(data) as RawEvent;
  } catch {
    return null;
  }
}

function openChatSocket(token: string): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const root = getScopedRoot();
  return new WebSocket(
    `${protocol}//${window.location.host}/api/chat/stream?token=${token}&root=${encodeURIComponent(root)}`,
  );
}

function closeSilently(ws: WebSocket | null) {
  if (!ws) return;
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;
  ws.close();
}

function insertBeforeQueued(prev: Message[], msg: Message): Message[] {
  const i = prev.findIndex((m) => m.queued);
  if (i < 0) return [...prev, msg];
  return [...prev.slice(0, i), msg, ...prev.slice(i)];
}

function messageFromState(state: StreamState): Message | null {
  const status = state.status;
  if (status.kind === "error") {
    const end = Date.now();
    return {
      role: "error",
      content: status.message,
      timestamp: end,
      duration: formatDuration(state.thinkingStart, end),
    };
  }
  if (!hasContent(state)) return null;
  const end = Date.now();
  const meta: TurnMeta = status.kind === "complete" ? status.meta : {};
  return assistantMessage(state, end, meta);
}

function assistantMessage(state: StreamState, endTime: number, meta: TurnMeta): Message {
  return {
    role: "assistant",
    content: state.fullText,
    segments: state.segments.length > 0 ? [...state.segments] : undefined,
    timestamp: endTime,
    duration: formatDuration(state.thinkingStart, endTime),
    costUsd: meta.costUsd,
    stepCount: meta.stepCount,
    tokenUsage: meta.tokenUsage,
  };
}

function unmarkQueued(setMessages: React.Dispatch<React.SetStateAction<Message[]>>, text: string) {
  setMessages((prev) => {
    let found = false;
    return prev.map((m) => {
      if (!found && m.queued && m.content === text) {
        found = true;
        return { ...m, queued: false };
      }
      return m;
    });
  });
}

interface EnsureSessionArgs {
  sessionIdRef: React.MutableRefObject<string | null>;
  prevSessionRef: React.MutableRefObject<string | null>;
  setSession: (sid: string | null) => void;
  setSessions: React.Dispatch<React.SetStateAction<SessionInfo[]>>;
  agentId: string;
  agentName: string;
  messageText: string;
}

async function ensureSession({
  sessionIdRef,
  prevSessionRef,
  setSession,
  setSessions,
  agentId,
  agentName,
  messageText,
}: EnsureSessionArgs): Promise<{ sessionId: string | null; isNew: boolean }> {
  const existing = sessionIdRef.current;
  if (existing) return { sessionId: existing, isNew: false };
  try {
    const d = await api.createSession(agentId);
    const sid = (d.session_id as string | undefined) ?? null;
    if (!sid) return { sessionId: null, isNew: true };
    sessionIdRef.current = sid;
    prevSessionRef.current = sid;
    setSession(sid);
    setSessions((prev) => [
      {
        id: sid,
        agent_id: agentId,
        agent_name: agentName,
        status: "active",
        created_at: new Date().toISOString(),
        first_message: messageText.slice(0, 60),
      },
      ...prev,
    ]);
    return { sessionId: sid, isNew: true };
  } catch {
    return { sessionId: null, isNew: true };
  }
}

interface SendPayloadArgs {
  messageText: string;
  agentId: string;
  sessionId: string | null;
  sessionIdeas: string[];
  sessionTask: { id: string; name: string } | null;
  attachedFiles: AttachedFile[];
}

function sendPayload({
  messageText,
  agentId,
  sessionId,
  sessionIdeas,
  sessionTask,
  attachedFiles,
}: SendPayloadArgs): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    message: messageText,
    agent_id: agentId || undefined,
    session_id: sessionId || undefined,
  };
  if (sessionIdeas.length > 0) payload.session_ideas = sessionIdeas;
  if (sessionTask) payload.quest_id = sessionTask.id;
  if (attachedFiles.length > 0) {
    payload.files = attachedFiles.map((f) => ({ name: f.name, content: f.content }));
  }
  return payload;
}
