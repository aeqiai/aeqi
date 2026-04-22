import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { getScopedRoot } from "@/lib/appMode";
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
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  sessionPrompts: string[];
  sessionTask: { id: string; name: string } | null;
  attachedFiles: AttachedFile[];
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
  setMessages,
  sessionPrompts,
  sessionTask,
  attachedFiles,
}: UseWebSocketChatOptions) {
  const [streaming, setStreaming] = useState(false);
  const [liveSegments, setLiveSegments] = useState<MessageSegment[]>([]);
  const [thinkingStart, setThinkingStart] = useState<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const messageQueueRef = useRef<string[]>([]);

  const clearLiveState = useCallback(() => {
    setStreaming(false);
    setLiveSegments([]);
    setThinkingStart(null);
  }, []);

  const commitMessage = useCallback(
    (state: StreamState, append: boolean) => {
      const msg = messageFromState(state);
      if (!msg) return;
      setMessages((prev) => (append ? [...prev, msg] : insertBeforeQueued(prev, msg)));
    },
    [setMessages],
  );

  const attachEventHandlers = useCallback(
    (ws: WebSocket, startTime: number) => {
      let state = initialStreamState(startTime);

      ws.onmessage = (e) => {
        const raw = parseEvent(e.data);
        if (!raw) return;
        const next = reduceStreamEvent(state, raw);
        if (next === state) return;
        const prevStart = state.thinkingStart;
        state = next;
        setLiveSegments(state.segments);
        if (state.thinkingStart !== prevStart) setThinkingStart(state.thinkingStart);
        if (state.status.kind === "complete") {
          commitMessage(state, false);
          ws.close();
        } else if (state.status.kind === "error") {
          commitMessage(state, true);
          ws.close();
        }
      };

      ws.onerror = () => clearLiveState();

      ws.onclose = () => {
        if (state.status.kind === "streaming") commitMessage(state, false);
        clearLiveState();
      };
    },
    [commitMessage, clearLiveState],
  );

  const replaceSocket = useCallback((ws: WebSocket) => {
    closeSilently(wsRef.current);
    wsRef.current = ws;
  }, []);

  const dispatchMessage = useCallback(
    async (messageText: string) => {
      const startTime = Date.now();
      unmarkQueued(setMessages, messageText);
      setStreaming(true);
      setLiveSegments([]);
      setThinkingStart(startTime);

      const { sessionId, isNew } = await ensureSession({
        sessionIdRef,
        prevSessionRef,
        setSession,
        setSessions,
        agentId,
        agentName,
        messageText,
      });

      if (!token) return;
      const ws = openChatSocket(token);
      replaceSocket(ws);
      ws.onopen = () =>
        ws.send(
          JSON.stringify(
            sendPayload({
              messageText,
              agentId,
              sessionId,
              isNew,
              sessionPrompts,
              sessionTask,
              attachedFiles,
            }),
          ),
        );
      attachEventHandlers(ws, startTime);
    },
    [
      token,
      agentId,
      agentName,
      sessionIdRef,
      prevSessionRef,
      setSession,
      setSessions,
      setMessages,
      sessionPrompts,
      sessionTask,
      attachedFiles,
      attachEventHandlers,
      replaceSocket,
    ],
  );

  const attachToLiveStream = useCallback(
    (sessionId: string) => {
      if (!token || !sessionId) return;
      const startTime = Date.now();
      setStreaming(true);
      setLiveSegments([]);
      setThinkingStart(startTime);

      const ws = openChatSocket(token);
      replaceSocket(ws);
      ws.onopen = () => ws.send(JSON.stringify({ subscribe: true, session_id: sessionId }));
      attachEventHandlers(ws, startTime);
    },
    [token, attachEventHandlers, replaceSocket],
  );

  const dispatchRef = useRef(dispatchMessage);
  dispatchRef.current = dispatchMessage;

  useEffect(() => {
    return () => {
      closeSilently(wsRef.current);
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (streaming) return;
    if (messageQueueRef.current.length === 0) return;
    const next = messageQueueRef.current.shift()!;
    const timer = setTimeout(() => dispatchRef.current(next), 100);
    return () => clearTimeout(timer);
  }, [streaming]);

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

  const resetLiveSegments = useCallback(() => setLiveSegments([]), []);

  const handleStop = useCallback((sessionIdRefCurrent: string | null) => {
    if (sessionIdRefCurrent) api.cancelSession(sessionIdRefCurrent).catch(() => {});
    wsRef.current?.close();
    setStreaming(false);
  }, []);

  return {
    streaming,
    liveSegments,
    thinkingStart,
    messageQueueRef,
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
  isNew: boolean;
  sessionPrompts: string[];
  sessionTask: { id: string; name: string } | null;
  attachedFiles: AttachedFile[];
}

function sendPayload({
  messageText,
  agentId,
  sessionId,
  isNew,
  sessionPrompts,
  sessionTask,
  attachedFiles,
}: SendPayloadArgs): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    message: messageText,
    agent_id: agentId || undefined,
    session_id: sessionId || undefined,
  };
  if (!isNew) return payload;
  if (sessionPrompts.length > 0) payload.session_prompts = sessionPrompts;
  if (sessionTask) payload.quest_id = sessionTask.id;
  if (attachedFiles.length > 0) {
    payload.files = attachedFiles.map((f) => ({ name: f.name, content: f.content }));
  }
  return payload;
}
