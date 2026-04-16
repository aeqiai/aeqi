import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useMessageProcessor } from "./session/useMessageProcessor";
import { useSessionManager } from "./session/useSessionManager";
import { useWebSocketChat } from "./session/useWebSocketChat";
import { useFileAttachments } from "./session/useFileAttachments";
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

  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
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
    sessions,
    messages,
    setMessages,
    activeSessionId,
    sessionIdRef,
    streamingRef,
    handleNewConversation: rawHandleNewConversation,
    handleFork,
    handleSelectSession,
  } = sessionManager;

  const { streaming, liveSegments, thinkingStart, dispatchMessage, messageQueueRef } = wsChat;

  // Keep streamingRef in sync so polling pauses during streaming
  streamingRef.current = streaming;

  // Wrap handleNewConversation to also reset live segments
  const handleNewConversation = useCallback(() => {
    wsChat.resetLiveSegments();
    rawHandleNewConversation();
  }, [wsChat, rawHandleNewConversation]);

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

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, [agentId]);

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
  }, [input, streaming, token, dispatchMessage, setMessages, messageQueueRef]);

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

  if (!agentId) return null;

  return (
    <div
      className={`asv ${fileAttachments.dragOver ? "asv--dragover" : ""}`}
      onDrop={fileAttachments.handleDrop}
      onDragOver={fileAttachments.handleDragOver}
      onDragEnter={fileAttachments.handleDragEnter}
      onDragLeave={fileAttachments.handleDragLeave}
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
          attachedFiles={fileAttachments.attachedFiles}
          setAttachedFiles={fileAttachments.setAttachedFiles}
          setShowAttachPicker={setShowAttachPicker}
          readFiles={fileAttachments.readFiles}
          dragOver={fileAttachments.dragOver}
          setDragOver={fileAttachments.setDragOver}
          dragCounter={fileAttachments.dragCounter}
          onSend={handleSend}
          onStop={handleStop}
          inputRef={inputRef}
          fileInputRef={fileAttachments.fileInputRef}
        />
      </div>
    </div>
  );
}
