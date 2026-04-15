import { useState, useRef, useEffect, useCallback } from "react";
import { useCompanyNav } from "@/hooks/useCompanyNav";
import { api } from "@/lib/api";
import { getScopedCompany } from "@/lib/appMode";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import {
  type Message,
  type MessageSegment,
  type SessionInfo,
  type ToolEvent,
  formatDuration,
  countStepSegments,
  numberFromMeta,
  applyAssistantMeta,
} from "./session/types";
import MessageItem from "./session/MessageItem";
import StreamingMessage from "./session/StreamingMessage";
import SessionSidebar from "./session/SessionSidebar";
import ChatComposer from "./session/ChatComposer";
import EmptyState from "./session/EmptyState";

// ── Main Component ──

interface AgentSessionProps {
  agentId: string;
  sessionId: string | null;
}

export default function AgentSessionView({ agentId, sessionId: urlSessionId }: AgentSessionProps) {
  const { go } = useCompanyNav();
  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);
  const user = useAuthStore((s) => s.user);
  const agents = useDaemonStore((s) => s.agents);

  // Resolve agent info from the store
  const agentInfo = agents.find((a) => a.id === agentId || a.name === agentId);
  const agentName = agentInfo?.name || agentId;
  const displayName = agentInfo?.display_name || agentName;
  const userName = user?.name || (authMode === "none" ? "Local" : "Account");
  const userAvatarUrl = user?.avatar_url || null;

  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  // The active session comes from the URL
  const activeSessionId = urlSessionId;
  const sessionIdRef = useRef<string | null>(activeSessionId);
  useEffect(() => {
    sessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Navigate helpers
  const setSession = useCallback(
    (sid: string | null) => {
      if (sid) {
        go(`/agents/${agentId}/sessions/${sid}`, { replace: true });
      } else {
        go(`/agents/${agentId}`, { replace: true });
      }
    },
    [agentId, go],
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionPrompts, setSessionPrompts] = useState<string[]>([]);
  const [sessionTask, setSessionTask] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [showAttachPicker, setShowAttachPicker] = useState<"prompt" | "quest" | null>(null);
  const [availablePrompts, setAvailablePrompts] = useState<
    { name: string; description: string; tags: string[] }[]
  >([]);
  const [availableTasks, setAvailableTasks] = useState<
    { id: string; name: string; status: string }[]
  >([]);
  const [attachedFiles, setAttachedFiles] = useState<
    { name: string; content: string; size: number }[]
  >([]);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [liveSegments, setLiveSegments] = useState<MessageSegment[]>([]);
  const [thinkingStart, setThinkingStart] = useState<number | null>(null);
  const messagesEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const messageQueueRef = useRef<string[]>([]);

  // Fetch available prompts and quests when picker opens
  useEffect(() => {
    if (showAttachPicker === "prompt" && availablePrompts.length === 0) {
      api
        .getSkills()
        .then((data: Record<string, unknown>) => {
          const items = (data?.ideas || data?.skills || data?.prompts || []) as Array<
            Record<string, unknown>
          >;
          setAvailablePrompts(
            items.map((s) => ({
              name: (s.name as string) || "",
              description: (s.description as string) || "",
              tags: (s.tags as string[]) || [],
            })),
          );
        })
        .catch(() => {});
    }
    if (showAttachPicker === "quest" && availableTasks.length === 0) {
      api
        .getQuests({ status: "open" })
        .then((data: Record<string, unknown>) => {
          const items = (data?.quests || []) as Array<Record<string, unknown>>;
          setAvailableTasks(
            items.map((t) => ({
              id: (t.id as string) || "",
              name: (t.name as string) || (t.subject as string) || "",
              status: (t.status as string) || "open",
            })),
          );
        })
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-fetch only when picker opens
  }, [showAttachPicker]);

  // File attachment helpers
  const readFiles = useCallback((files: FileList | File[]) => {
    Array.from(files).forEach((file) => {
      if (file.size > 512_000) return; // 512KB limit
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        setAttachedFiles((prev) => {
          if (prev.some((f) => f.name === file.name)) return prev;
          return [...prev, { name: file.name, content, size: file.size }];
        });
      };
      reader.readAsText(file);
    });
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) readFiles(e.dataTransfer.files);
    },
    [readFiles],
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      if (!dragOver) setDragOver(true);
    },
    [dragOver],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragOver(true);
  }, []);

  const dragCounter = useRef(0);
  const handleDragLeave = useCallback((_e: React.DragEvent) => {
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  }, []);

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

  // Start a new conversation: drop session param, show empty composer.
  const handleNewConversation = useCallback(() => {
    prevSessionRef.current = null;
    sessionIdRef.current = null;
    setMessages([]);
    setLiveSegments([]);
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
          // Add fork to session list and switch to it.
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

  // Switch to an existing session -- force reload
  const handleSelectSession = useCallback(
    (sid: string) => {
      prevSessionRef.current = null; // Force reload on next effect
      sessionIdRef.current = sid;
      setMessages([]);
      setSession(sid);
    },
    [setSession],
  );

  // Keyboard shortcuts: Cmd+P -> idea picker, Cmd+Q -> quest picker, Cmd+N -> new session
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "n") {
        e.preventDefault();
        handleNewConversation();
      } else if (e.key === "p") {
        e.preventDefault();
        setShowAttachPicker((prev) => (prev === "prompt" ? null : "prompt"));
      } else if (e.key === "q") {
        e.preventDefault();
        setShowAttachPicker((prev) => (prev === "quest" ? null : "quest"));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleNewConversation]);

  // Process raw messages from API into our format
  const processRawMessages = useCallback(
    (rawMessages: Array<Record<string, unknown>>): Message[] => {
      const processed: Message[] = [];
      let pendingTools: MessageSegment[] = [];
      let currentAgent: Message | null = null;
      let stepCount = 0;
      let sawStoredStepMarkers = false;

      const flushAgent = () => {
        if (currentAgent) {
          if (!currentAgent.stepCount) {
            currentAgent.stepCount = countStepSegments(currentAgent.segments);
          }
          processed.push(currentAgent);
          currentAgent = null;
        }
      };

      const ensureCurrentAgent = (timestamp: number) => {
        if (!currentAgent) {
          currentAgent = {
            role: "assistant",
            content: "",
            segments: [],
            timestamp,
          };
        }
        return currentAgent;
      };

      const startStep = (_step: number | undefined, timestamp: number) => {
        const message = ensureCurrentAgent(timestamp);
        stepCount += 1;
        message.stepCount = Math.max(message.stepCount || 0, stepCount);
        message.segments!.push({ kind: "step", step: stepCount });
        return message;
      };

      const applyMetaToCurrentAssistant = (meta: Record<string, unknown>) => {
        if (currentAgent) {
          applyAssistantMeta(currentAgent, meta);
          return;
        }
        for (let i = processed.length - 1; i >= 0; i--) {
          if (processed[i].role === "assistant") {
            applyAssistantMeta(processed[i], meta);
            return;
          }
        }
      };

      for (const m of rawMessages) {
        const eventType = m.event_type || "message";
        const ts = m.created_at ? new Date(String(m.created_at)).getTime() : Date.now();

        if (eventType === "tool_complete") {
          const meta = (m.metadata || {}) as Record<string, unknown>;
          pendingTools.push({
            kind: "tool",
            event: {
              type: "complete",
              name: String(meta.tool_name || m.content || "tool"),
              id: meta.tool_use_id ? String(meta.tool_use_id) : undefined,
              success: meta.success !== false,
              input_preview: meta.input_preview as string | undefined,
              output_preview: meta.output_preview as string | undefined,
              duration_ms: meta.duration_ms as number | undefined,
              timestamp: ts,
            },
          });
        } else if (eventType === "step_start") {
          const meta = (m.metadata || {}) as Record<string, unknown>;
          sawStoredStepMarkers = true;
          if (pendingTools.length > 0 && currentAgent) {
            currentAgent.segments!.push(...pendingTools);
            pendingTools = [];
          }
          startStep(numberFromMeta(meta.step), ts);
        } else if (eventType === "assistant_complete") {
          if (currentAgent && typeof m.id === "number") {
            currentAgent.messageId = m.id;
          }
          if (!currentAgent && pendingTools.length > 0) {
            currentAgent = {
              role: "assistant",
              content: "",
              segments: [],
              timestamp: ts,
            };
            if (!sawStoredStepMarkers) {
              startStep(undefined, ts);
            }
            currentAgent.segments!.push(...pendingTools);
            pendingTools = [];
          }
          applyMetaToCurrentAssistant((m.metadata || {}) as Record<string, unknown>);
        } else if (m.role === "assistant") {
          const agent = !sawStoredStepMarkers ? startStep(undefined, ts) : ensureCurrentAgent(ts);
          if (agent.timestamp == null) {
            agent.timestamp = ts;
          } else {
            agent.timestamp = Math.min(agent.timestamp, ts);
          }
          if (pendingTools.length > 0) {
            agent.segments!.push(...pendingTools);
            pendingTools = [];
          }
          const text = String(m.content || "");
          if (text) {
            agent.segments!.push({ kind: "text", text });
            agent.content += (agent.content ? "\n\n" : "") + text;
          }
          applyAssistantMeta(agent, (m.metadata || {}) as Record<string, unknown>);
        } else if (m.role === "user" || m.role === "User") {
          if (pendingTools.length > 0 && currentAgent) {
            currentAgent.segments!.push(...pendingTools);
            pendingTools = [];
          }
          flushAgent();
          stepCount = 0;
          sawStoredStepMarkers = false;
          processed.push({
            role: "user",
            content: String(m.content || ""),
            timestamp: ts,
            messageId: typeof m.id === "number" ? m.id : undefined,
          });
        }
      }
      // Flush remaining
      if (pendingTools.length > 0 && currentAgent) {
        currentAgent.segments!.push(...pendingTools);
      } else if (pendingTools.length > 0) {
        const firstTool = pendingTools.find(
          (seg): seg is { kind: "tool"; event: ToolEvent } => seg.kind === "tool",
        );
        currentAgent = {
          role: "assistant",
          content: "",
          segments: [],
          timestamp: firstTool?.event.timestamp || Date.now(),
        };
        if (!sawStoredStepMarkers) {
          startStep(undefined, currentAgent.timestamp || Date.now());
        }
        currentAgent.segments!.push(...pendingTools);
      }
      flushAgent();
      return processed;
    },
    [],
  );

  // Load messages when session changes (only if we have a session)
  const prevSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([]);
      setLiveSegments([]);
      prevSessionRef.current = null;
      return;
    }

    if (activeSessionId === prevSessionRef.current) return;
    prevSessionRef.current = activeSessionId;

    setLiveSegments([]);

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

  // Poll for new messages on sessions not driven by local WebSocket (e.g. Telegram).
  useEffect(() => {
    if (!activeSessionId || streaming) return;
    const iv = setInterval(() => {
      api
        .getSessionMessages(activeSessionId, 1000)
        .then((d: Record<string, unknown>) => {
          const loaded = processRawMessages((d.messages as Array<Record<string, unknown>>) || []);
          if (loaded.length > 0) {
            setMessages((prev) => (loaded.length !== prev.length ? loaded : prev));
          }
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(iv);
  }, [activeSessionId, streaming, processRawMessages]);

  // Auto-scroll
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveSegments]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, [agentId]);

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
      const company = getScopedCompany();
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/api/chat/stream?token=${token}&company=${encodeURIComponent(company)}`,
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
            case "Status":
            case "Compacted": {
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
    [token, agentId, agentName, setSession, sessionPrompts, sessionTask, attachedFiles],
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

  // User-facing send handler
  const handleSend = useCallback(() => {
    if (!input.trim() || !token) return;

    const messageText = input;
    setInput("");
    requestAnimationFrame(() => inputRef.current?.focus());

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: messageText,
        timestamp: Date.now(),
        queued: streaming || undefined,
      },
    ]);

    if (streaming) {
      messageQueueRef.current.push(messageText);
      return;
    }

    void dispatchMessage(messageText);
  }, [input, streaming, token, dispatchMessage]);

  const handleStop = useCallback(() => {
    const sid = sessionIdRef.current;
    if (sid) api.cancelSession(sid).catch(() => {});
    wsRef.current?.close();
    setStreaming(false);
  }, []);

  const handleSuggestionClick = useCallback(
    (q: string) => {
      setMessages((prev) => [...prev, { role: "user", content: q, timestamp: Date.now() }]);
      void dispatchMessage(q);
    },
    [dispatchMessage],
  );

  if (!agentId) return null;

  return (
    <div
      className={`asv ${dragOver ? "asv--dragover" : ""}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
    >
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        onNewConversation={handleNewConversation}
        onSelectSession={handleSelectSession}
      />

      <div className="asv-main">
        <div className="asv-messages">
          {messages.length === 0 && !streaming && (
            <EmptyState
              agentName={agentName}
              displayName={displayName}
              activeSessionId={activeSessionId}
              onSuggestionClick={handleSuggestionClick}
            />
          )}

          {messages.map((msg, i) => (
            <MessageItem
              key={i}
              msg={msg}
              agentName={agentName}
              userName={userName}
              userAvatarUrl={userAvatarUrl}
              onFork={handleFork}
            />
          ))}

          <StreamingMessage
            agentName={agentName}
            liveSegments={liveSegments}
            thinkingStart={thinkingStart}
            streaming={streaming}
          />

          <div ref={messagesEnd} />
        </div>

        <ChatComposer
          input={input}
          setInput={setInput}
          streaming={streaming}
          displayName={displayName}
          sessionPrompts={sessionPrompts}
          setSessionPrompts={setSessionPrompts}
          sessionTask={sessionTask}
          setSessionTask={setSessionTask}
          attachedFiles={attachedFiles}
          setAttachedFiles={setAttachedFiles}
          setShowAttachPicker={setShowAttachPicker}
          readFiles={readFiles}
          dragOver={dragOver}
          setDragOver={setDragOver}
          dragCounter={dragCounter}
          onSend={handleSend}
          onStop={handleStop}
          inputRef={inputRef}
          fileInputRef={fileInputRef}
        />
      </div>
    </div>
  );
}
