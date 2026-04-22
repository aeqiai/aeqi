import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { getScopedRoot } from "@/lib/appMode";
import {
  type Message,
  type MessageSegment,
  type SessionInfo,
  type ToolEvent,
  type FileChangedEvent,
  type FileDeletedEvent,
  type ToolSummarizedEvent,
  formatDuration,
  countStepSegments,
} from "./types";
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

/**
 * Hook managing WebSocket-based chat streaming, message dispatch, and queue.
 */
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

  // Wire the shared event parser onto a WebSocket. Both fresh sends and
  // passive subscribe-reattach drain the same ChatStreamEvent protocol.
  const attachEventHandlers = useCallback(
    (ws: WebSocket, startTime: number) => {
      let fullText = "";
      let done = false;
      const segments: MessageSegment[] = [];

      const appendText = (delta: string) => {
        const last = segments[segments.length - 1];
        if (last && last.kind === "text") {
          last.text += delta;
        } else {
          segments.push({ kind: "text", text: delta });
        }
        fullText += delta;
      };

      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data);
          switch (event.type) {
            case "Subscribed": {
              // Daemon preamble for subscribe-reattach: tells us how long
              // the run has been going so the "Thinking for Xs" timer
              // resumes from the real start, not from reconnect time.
              const msAgo = Number(event.started_ms_ago);
              if (Number.isFinite(msAgo) && msAgo > 0) {
                setThinkingStart(Date.now() - msAgo);
              }
              break;
            }
            case "TextDelta": {
              appendText(event.text || event.delta || "");
              setLiveSegments([...segments]);
              break;
            }
            case "ToolStart": {
              const name = event.name || event.tool_name || event.tool_use_id || "tool";
              const ev: ToolEvent = {
                type: "start",
                name,
                id: event.tool_use_id || event.id,
                timestamp: Date.now(),
              };
              segments.push({ kind: "tool", event: ev });
              setLiveSegments([...segments]);
              break;
            }
            case "ToolResult":
            case "ToolComplete": {
              const name = event.name || event.tool_name || event.tool_use_id || "tool";
              const completed: ToolEvent = {
                type: "complete",
                name,
                id: event.tool_use_id || event.id,
                success: event.success !== false,
                input_preview: event.input_preview || undefined,
                output_preview: event.output_preview || event.output || "",
                duration_ms: event.duration_ms,
                timestamp: Date.now(),
              };
              const segIdx = segments.findIndex(
                (s) =>
                  s.kind === "tool" &&
                  s.event.type === "start" &&
                  ((completed.id && s.event.id === completed.id) ||
                    (!completed.id && s.event.name === name)),
              );
              if (segIdx >= 0) segments[segIdx] = { kind: "tool", event: completed };
              else segments.push({ kind: "tool", event: completed });
              setLiveSegments([...segments]);
              break;
            }
            case "StepStart": {
              const step = countStepSegments(segments) + 1;
              segments.push({ kind: "step", step });
              setLiveSegments([...segments]);
              break;
            }
            case "IdeaActivity":
            case "MemoryActivity": {
              const label =
                event.action === "stored"
                  ? `Stored: ${event.name || "idea"}`
                  : `Recalled: ${event.name || "idea"}`;
              segments.push({ kind: "status", text: label });
              setLiveSegments([...segments]);
              break;
            }
            case "EventFired": {
              const ideaIds: string[] = Array.isArray(event.idea_ids)
                ? event.idea_ids.map(String)
                : [];
              const fire = {
                eventId: String(event.event_id ?? ""),
                eventName: String(event.event_name ?? ""),
                pattern: String(event.pattern ?? ""),
                ideaIds,
              };
              segments.push({ kind: "event_fire", fire });
              setLiveSegments([...segments]);
              break;
            }
            case "DelegateStart": {
              segments.push({
                kind: "status",
                text: `Delegating to ${event.worker_name || "agent"}...`,
              });
              setLiveSegments([...segments]);
              break;
            }
            case "DelegateComplete": {
              segments.push({
                kind: "status",
                text: `${event.worker_name || "Agent"} finished: ${event.outcome || "done"}`,
              });
              setLiveSegments([...segments]);
              break;
            }
            case "FileChanged": {
              const fce: FileChangedEvent = {
                path: String(event.path ?? ""),
                operation: event.operation === "created" ? "created" : "modified",
                bytes: Number(event.bytes ?? 0),
              };
              segments.push({ kind: "file_changed", event: fce });
              setLiveSegments([...segments]);
              break;
            }
            case "FileDeleted": {
              const fde: FileDeletedEvent = {
                path: String(event.path ?? ""),
              };
              segments.push({ kind: "file_deleted", event: fde });
              setLiveSegments([...segments]);
              break;
            }
            case "ToolSummarized": {
              const tse: ToolSummarizedEvent = {
                tool_use_id: String(event.tool_use_id ?? ""),
                tool_name: String(event.tool_name ?? ""),
                original_bytes: Number(event.original_bytes ?? 0),
                summary: String(event.summary ?? ""),
              };
              segments.push({ kind: "tool_summarized", event: tse });
              setLiveSegments([...segments]);
              break;
            }
            case "Compacted": {
              const restoredFiles: string[] = Array.isArray(event.restored_files)
                ? event.restored_files.map(String)
                : [];
              const orig = Number(event.original_messages ?? 0);
              const remaining = Number(event.remaining_messages ?? 0);
              const label =
                restoredFiles.length > 0
                  ? `context compacted (${orig}→${remaining} msgs, restored ${restoredFiles.length} file${restoredFiles.length === 1 ? "" : "s"})`
                  : `context compacted (${orig}→${remaining} msgs)`;
              segments.push({ kind: "status", text: label });
              setLiveSegments([...segments]);
              break;
            }
            case "SnipCompacted": {
              const freed = Number(event.tokens_freed ?? 0);
              segments.push({ kind: "status", text: `snip: freed ~${freed} tokens` });
              setLiveSegments([...segments]);
              break;
            }
            case "MicroCompacted": {
              const cleared = Number(event.cleared ?? 0);
              segments.push({
                kind: "status",
                text: `microcompact: cleared ${cleared} old tool result${cleared === 1 ? "" : "s"}`,
              });
              setLiveSegments([...segments]);
              break;
            }
            case "ContextCollapsed": {
              const freed = Number(event.tokens_freed ?? 0);
              segments.push({ kind: "status", text: `collapse: freed ~${freed} tokens` });
              setLiveSegments([...segments]);
              break;
            }
            case "Status": {
              break;
            }
            case "Complete":
            case "done": {
              if (!event.done && event.type === "Complete") break;
              done = true;
              const endTime = Date.now();
              const duration = formatDuration(startTime, endTime);
              const hasContent = fullText || segments.length > 0;
              if (hasContent) {
                const promptTok = event.prompt_tokens || 0;
                const completionTok = event.completion_tokens || 0;
                const stepCount = countStepSegments(segments) || undefined;
                setMessages((prev) => {
                  const msg: Message = {
                    role: "assistant",
                    content: fullText,
                    segments: segments.length > 0 ? [...segments] : undefined,
                    timestamp: endTime,
                    duration,
                    costUsd: event.cost_usd || undefined,
                    stepCount,
                    tokenUsage:
                      promptTok || completionTok
                        ? { prompt: promptTok, completion: completionTok }
                        : undefined,
                  };
                  const firstQueued = prev.findIndex((m) => m.queued);
                  if (firstQueued >= 0) {
                    return [...prev.slice(0, firstQueued), msg, ...prev.slice(firstQueued)];
                  }
                  return [...prev, msg];
                });
              }
              setStreaming(false);
              setLiveSegments([]);
              setThinkingStart(null);
              ws.close();
              break;
            }
            case "Error":
              done = true;
              setMessages((prev) => [
                ...prev,
                {
                  role: "error",
                  content: event.message || "Unknown error",
                  timestamp: Date.now(),
                  duration: formatDuration(startTime, Date.now()),
                },
              ]);
              setStreaming(false);
              setThinkingStart(null);
              ws.close();
              break;
          }
        } catch {
          /* ignore malformed */
        }
      };

      ws.onerror = () => {
        setStreaming(false);
        setLiveSegments([]);
        setThinkingStart(null);
      };
      ws.onclose = () => {
        if (!done && (fullText || segments.length > 0)) {
          const endTime = Date.now();
          setMessages((prev) => {
            const msg: Message = {
              role: "assistant",
              content: fullText,
              segments: segments.length > 0 ? [...segments] : undefined,
              timestamp: endTime,
              duration: formatDuration(startTime, endTime),
            };
            const firstQueued = prev.findIndex((m) => m.queued);
            if (firstQueued >= 0) {
              return [...prev.slice(0, firstQueued), msg, ...prev.slice(firstQueued)];
            }
            return [...prev, msg];
          });
        }
        setStreaming(false);
        setLiveSegments([]);
        setThinkingStart(null);
      };
    },
    [setMessages],
  );

  // Core dispatch -- opens WebSocket and sends a message
  const dispatchMessage = useCallback(
    async (messageText: string) => {
      const startTime = Date.now();

      setMessages((prev) => {
        let found = false;
        return prev.map((m) => {
          if (!found && m.queued && m.content === messageText) {
            found = true;
            return { ...m, queued: false };
          }
          return m;
        });
      });

      setStreaming(true);
      setLiveSegments([]);
      setThinkingStart(startTime);

      let sessionId = sessionIdRef.current;
      const isNewConversation = !sessionId;
      if (!sessionId) {
        try {
          const d = await api.createSession(agentId);
          if (d.session_id) {
            sessionId = d.session_id as string;
            sessionIdRef.current = sessionId;
            prevSessionRef.current = sessionId;
            setSession(sessionId);
            setSessions((prev) => [
              {
                id: d.session_id as string,
                agent_id: agentId,
                agent_name: agentName,
                status: "active",
                created_at: new Date().toISOString(),
                first_message: messageText.slice(0, 60),
              },
              ...prev,
            ]);
          }
        } catch {
          // If session creation fails, still try to send
        }
      }

      if (wsRef.current) {
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const root = getScopedRoot();
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/api/chat/stream?token=${token}&root=${encodeURIComponent(root)}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        const payload: Record<string, unknown> = {
          message: messageText,
          agent_id: agentId || undefined,
          session_id: sessionId || undefined,
        };
        if (isNewConversation) {
          if (sessionPrompts.length > 0) {
            payload.session_prompts = sessionPrompts;
          }
          if (sessionTask) {
            payload.quest_id = sessionTask.id;
          }
          if (attachedFiles.length > 0) {
            payload.files = attachedFiles.map((f) => ({
              name: f.name,
              content: f.content,
            }));
          }
        }
        ws.send(JSON.stringify(payload));
      };

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
    ],
  );

  // Passive subscribe: hook into an already-running session's broadcast
  // stream (e.g. after a hard refresh). The daemon fans out the same
  // ChatStreamEvents so we reuse the full parser.
  const attachToLiveStream = useCallback(
    (sessionId: string) => {
      if (!token || !sessionId) return;
      const startTime = Date.now();
      setStreaming(true);
      setLiveSegments([]);
      setThinkingStart(startTime);

      if (wsRef.current) {
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
      }

      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const root = getScopedRoot();
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/api/chat/stream?token=${token}&root=${encodeURIComponent(root)}`,
      );
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ subscribe: true, session_id: sessionId }));
      };

      attachEventHandlers(ws, startTime);
    },
    [token, attachEventHandlers],
  );

  // Ref to latest dispatchMessage for queue processing
  const dispatchRef = useRef(dispatchMessage);
  dispatchRef.current = dispatchMessage;

  // Clean up WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.onmessage = null;
        wsRef.current.onerror = null;
        wsRef.current.onclose = null;
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  // Process queued messages when streaming ends
  useEffect(() => {
    if (streaming) return;
    if (messageQueueRef.current.length === 0) return;
    const next = messageQueueRef.current.shift()!;
    const timer = setTimeout(() => dispatchRef.current(next), 100);
    return () => clearTimeout(timer);
  }, [streaming]);

  // Auto-reattach to a running session on mount / session switch. If the
  // executor is still active (e.g. user hard-refreshed mid-turn), subscribe
  // so the stream continues flowing into the UI and Stop stays wired up.
  useEffect(() => {
    if (!token || !activeSessionId) return;
    if (streaming) return;
    let cancelled = false;
    api
      .isSessionActive(activeSessionId)
      .then((res) => {
        if (cancelled) return;
        if (res?.active) attachToLiveStream(activeSessionId);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-check on session change
  }, [activeSessionId, token]);

  // Reset live segments when session changes
  const resetLiveSegments = useCallback(() => {
    setLiveSegments([]);
  }, []);

  // Cancel the current session
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
