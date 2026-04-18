import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useChatStore } from "@/store/chat";
import { useMessageProcessor } from "./session/useMessageProcessor";
import { useSessionManager } from "./session/useSessionManager";
import { useWebSocketChat } from "./session/useWebSocketChat";
import { useFileAttachments } from "./session/useFileAttachments";
import MessageItem from "./session/MessageItem";
import StreamingMessage from "./session/StreamingMessage";
import EmptyState from "./session/EmptyState";

// ── Main Component ──

interface AgentSessionProps {
  agentId: string;
  sessionId: string | null;
}

export default function AgentSessionView({ agentId, sessionId: urlSessionId }: AgentSessionProps) {
  const token = useAuthStore((s) => s.token);
  const agents = useDaemonStore((s) => s.agents);

  // Resolve agent info from the store
  const agentInfo = agents.find((a) => a.id === agentId || a.name === agentId);
  const agentName = agentInfo?.name || agentId;
  const displayName = agentInfo?.display_name || agentName;

  // Attachment state
  const [sessionPrompts, setSessionPrompts] = useState<string[]>([]);
  const [sessionTask, setSessionTask] = useState<{ id: string; name: string } | null>(null);
  const [showAttachPicker, setShowAttachPicker] = useState<"prompt" | "quest" | null>(null);
  const [availablePrompts, setAvailablePrompts] = useState<
    { name: string; description: string; tags: string[] }[]
  >([]);
  const [availableTasks, setAvailableTasks] = useState<
    { id: string; name: string; status: string }[]
  >([]);

  const messagesEnd = useRef<HTMLDivElement>(null);

  // ── Hooks ──

  const processRawMessages = useMessageProcessor();

  const fileAttachments = useFileAttachments();

  const sessionManager = useSessionManager({
    agentId,
    urlSessionId,
    processRawMessages,
  });

  const wsChat = useWebSocketChat({
    token,
    agentId,
    agentName,
    sessionIdRef: sessionManager.sessionIdRef,
    prevSessionRef: sessionManager.prevSessionRef,
    setSession: sessionManager.setSession,
    setSessions: sessionManager.setSessions,
    setMessages: sessionManager.setMessages,
    sessionPrompts,
    sessionTask,
    attachedFiles: fileAttachments.attachedFiles,
  });

  const {
    messages,
    setMessages,
    activeSessionId,
    sessionIdRef,
    streamingRef,
    handleNewConversation: rawHandleNewConversation,
    handleFork,
  } = sessionManager;

  const { streaming, liveSegments, thinkingStart, dispatchMessage, messageQueueRef } = wsChat;

  // Keep streamingRef in sync so polling pauses during streaming
  streamingRef.current = streaming;

  // Wrap handleNewConversation to also reset live segments
  const handleNewConversation = useCallback(() => {
    wsChat.resetLiveSegments();
    rawHandleNewConversation();
  }, [wsChat, rawHandleNewConversation]);

  // Edit a user message: fork the session at the *previous* message so the
  // user's original line is excluded from the new branch, then push the
  // original text into the composer for editing. If this is the first
  // message in the session there's nothing to fork — start a fresh session
  // instead of producing an empty fork.
  const handleEdit = useCallback(
    async (messageId: number, text: string) => {
      const idx = messages.findIndex((m) => m.messageId === messageId);
      const prev = idx > 0 ? messages[idx - 1] : null;
      if (prev?.messageId) {
        await handleFork(prev.messageId);
      } else {
        handleNewConversation();
      }
      window.dispatchEvent(new CustomEvent("aeqi:set-composer-input", { detail: { text } }));
    },
    [messages, handleFork, handleNewConversation],
  );

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
    const newSessionHandler = () => handleNewConversation();
    window.addEventListener("aeqi:new-session", newSessionHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("aeqi:new-session", newSessionHandler);
    };
  }, [handleNewConversation]);

  // Auto-scroll
  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, liveSegments]);

  // Internal send handler — used by both local calls and the event bridge
  const handleSendText = useCallback(
    (messageText: string) => {
      if (!messageText.trim() || !token) return;

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
    },
    [streaming, token, dispatchMessage, setMessages, messageQueueRef],
  );

  const handleStop = useCallback(() => {
    wsChat.handleStop(sessionIdRef.current);
  }, [wsChat, sessionIdRef]);

  const handleSuggestionClick = useCallback(
    (q: string) => {
      setMessages((prev) => [...prev, { role: "user", content: q, timestamp: Date.now() }]);
      void dispatchMessage(q);
    },
    [dispatchMessage, setMessages],
  );

  // ── Event bridge: composer in AppLayout communicates via custom events ──

  useEffect(() => {
    const onSend = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const { text, files, prompts, task } = detail;
      if (prompts?.length) setSessionPrompts(prompts);
      if (task) setSessionTask(task);
      if (files?.length) fileAttachments.setAttachedFiles(files);
      handleSendText(text);
    };
    const onStop = () => handleStop();
    window.addEventListener("aeqi:send-message", onSend);
    window.addEventListener("aeqi:stop-streaming", onStop);
    return () => {
      window.removeEventListener("aeqi:send-message", onSend);
      window.removeEventListener("aeqi:stop-streaming", onStop);
    };
  }, [handleSendText, handleStop, fileAttachments, setSessionPrompts, setSessionTask]);

  // Broadcast streaming state so the composer in AppLayout can reflect it
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("aeqi:streaming-state", { detail: { streaming } }));
  }, [streaming]);

  // Consume any pending message stashed by AppLayout's composer when there
  // was no chat mounted (type-anywhere flow). Fire once on mount/agent change.
  const pendingMessage = useChatStore((s) => s.pendingMessage);
  const setPendingMessage = useChatStore((s) => s.setPendingMessage);
  useEffect(() => {
    if (!pendingMessage || !token) return;
    const { text, files, prompts, task } = pendingMessage;
    if (prompts?.length) setSessionPrompts(prompts);
    if (task) setSessionTask(task);
    if (files?.length) fileAttachments.setAttachedFiles(files);
    handleSendText(text);
    setPendingMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once when pendingMessage arrives
  }, [pendingMessage, token]);

  if (!agentId) return null;

  return (
    <div
      className={`asv ${fileAttachments.dragOver ? "asv--dragover" : ""}`}
      onDrop={fileAttachments.handleDrop}
      onDragOver={fileAttachments.handleDragOver}
      onDragEnter={fileAttachments.handleDragEnter}
      onDragLeave={fileAttachments.handleDragLeave}
    >
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
            <MessageItem key={i} msg={msg} onFork={handleFork} onEdit={handleEdit} />
          ))}

          <StreamingMessage
            agentName={agentName}
            liveSegments={liveSegments}
            thinkingStart={thinkingStart}
            streaming={streaming}
          />

          <div ref={messagesEnd} />
        </div>
      </div>
    </div>
  );
}
