import { useState, useRef, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { createDraftId, useChatStore, type PendingMessage } from "@/store/chat";
import { useMessageProcessor } from "./session/useMessageProcessor";
import { useSessionManager } from "./session/useSessionManager";
import { useWebSocketChat } from "./session/useWebSocketChat";
import { useFileAttachments } from "./session/useFileAttachments";
import MessageItem from "./session/MessageItem";
import StreamingMessage from "./session/StreamingMessage";
import EmptyState from "./session/EmptyState";

// ── Main Component ──

const EMPTY_QUEUED_DRAFTS: PendingMessage[] = [];

function mergeQueuedDrafts(drafts: PendingMessage[]): PendingMessage {
  const text = drafts
    .map((draft) => draft.text.trim())
    .filter(Boolean)
    .join("\n\n");
  const filesByName = new Map<string, { name: string; content: string; size: number }>();
  const ideas = new Set<string>();
  let task: { id: string; name: string } | undefined;
  for (const draft of drafts) {
    for (const file of draft.files || []) {
      filesByName.set(file.name, file);
    }
    for (const idea of draft.ideas || []) {
      ideas.add(idea);
    }
    if (draft.task) {
      task = draft.task;
    }
  }
  return {
    id: createDraftId(),
    text,
    files: filesByName.size > 0 ? [...filesByName.values()] : undefined,
    ideas: ideas.size > 0 ? [...ideas] : undefined,
    task,
  };
}

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
  const displayName = agentName;

  // Attachment state
  const [sessionIdeas, setSessionIdeas] = useState<string[]>([]);
  const [sessionTask, setSessionTask] = useState<{ id: string; name: string } | null>(null);
  const [showAttachPicker, setShowAttachPicker] = useState<"idea" | "quest" | null>(null);
  const [availableIdeas, setAvailableIdeas] = useState<
    { name: string; description: string; tags: string[] }[]
  >([]);
  const [availableTasks, setAvailableTasks] = useState<
    { id: string; name: string; status: string }[]
  >([]);

  const messagesEnd = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const [atBottom, setAtBottom] = useState(true);

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
    activeSessionId: sessionManager.activeSessionId,
    sessionIdRef: sessionManager.sessionIdRef,
    prevSessionRef: sessionManager.prevSessionRef,
    setSession: sessionManager.setSession,
    setSessions: sessionManager.setSessions,
    setMessages: sessionManager.setMessages,
    sessionIdeas,
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

  const { streaming, liveSegments, thinkingStart, dispatchMessage } = wsChat;

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

  // Fetch available ideas and quests when picker opens
  useEffect(() => {
    if (showAttachPicker === "idea" && availableIdeas.length === 0) {
      api
        .getSkills()
        .then((data: Record<string, unknown>) => {
          const items = (data?.ideas || data?.skills || data?.prompts || []) as Array<
            Record<string, unknown>
          >;
          setAvailableIdeas(
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
        setShowAttachPicker((prev) => (prev === "idea" ? null : "idea"));
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

  // Auto-scroll - improved version that doesn't cause twitching
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const scrollEl = messagesScrollRef.current;
    const endEl = messagesEnd.current;
    if (!scrollEl || !endEl) return;

    // Calculate the exact position to scroll to
    const targetScrollTop = scrollEl.scrollHeight - scrollEl.clientHeight;

    // Only scroll if we're not already at the bottom (within a small threshold)
    const currentDistance = Math.abs(scrollEl.scrollTop - targetScrollTop);
    if (currentDistance > 2) {
      // 2px threshold to prevent micro-adjustments
      if (behavior === "smooth") {
        scrollEl.scrollTo({
          top: targetScrollTop,
          behavior: "smooth",
        });
      } else {
        scrollEl.scrollTop = targetScrollTop;
      }
    }
  }, []);

  useEffect(() => {
    scrollToBottom("auto");
    setAtBottom(true);
  }, [activeSessionId, scrollToBottom]);

  useEffect(() => {
    if (!atBottom) return;
    scrollToBottom("auto");
  }, [messages, liveSegments, atBottom, scrollToBottom]);

  const handleMessagesScroll = useCallback(() => {
    const el = messagesScrollRef.current;
    if (!el) return;

    // Calculate distance to bottom with a more generous threshold
    // that accounts for composer height changes
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;

    // Use a dynamic threshold based on composer height if available
    const composerHeight = parseInt(
      getComputedStyle(el).getPropertyValue("--composer-height") || "140",
    );
    const threshold = Math.max(48, composerHeight * 0.3); // At least 48px or 30% of composer height

    setAtBottom(distance < threshold);
  }, []);

  // Internal send handler — used by both local calls and the event bridge
  const sendDraft = useCallback(
    (draft: PendingMessage) => {
      if (!draft.text.trim() || !token) return;

      if (streaming) {
        if (activeSessionId) {
          useChatStore.getState().queueDraft(activeSessionId, draft);
        }
        return;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: draft.text,
          timestamp: Date.now(),
        },
      ]);

      void dispatchMessage(draft.text, {
        sessionIdeas: draft.ideas,
        sessionTask: draft.task || null,
        attachedFiles: draft.files || [],
      });
    },
    [streaming, token, dispatchMessage, setMessages, activeSessionId],
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
      const { text, files, ideas, task } = detail;
      if (ideas?.length) setSessionIdeas(ideas);
      if (task) setSessionTask(task);
      if (files?.length) fileAttachments.setAttachedFiles(files);
      sendDraft({
        id: detail.id || createDraftId(),
        text,
        files,
        ideas,
        task,
      });
    };
    const onStop = () => handleStop();
    window.addEventListener("aeqi:send-message", onSend);
    window.addEventListener("aeqi:stop-streaming", onStop);
    return () => {
      window.removeEventListener("aeqi:send-message", onSend);
      window.removeEventListener("aeqi:stop-streaming", onStop);
    };
  }, [sendDraft, handleStop, fileAttachments, setSessionIdeas, setSessionTask]);

  // Broadcast streaming state so the composer in AppLayout can reflect it
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("aeqi:streaming-state", {
        detail: { streaming, sessionId: activeSessionId },
      }),
    );
  }, [streaming, activeSessionId]);

  // Consume any pending message stashed by AppLayout's composer when there
  // was no chat mounted (type-anywhere flow). Fire once on mount/agent change.
  const consumePendingMessage = useChatStore((s) => s.consumePendingMessage);
  const drainQueuedDrafts = useChatStore((s) => s.drainQueuedDrafts);
  useEffect(() => {
    if (activeSessionId) return;
    const pendingMessage = consumePendingMessage(agentId);
    if (!pendingMessage || !token) return;
    sendDraft(pendingMessage);
  }, [agentId, token, activeSessionId, consumePendingMessage, sendDraft]);

  // Session-scoped queued drafts remain visible below the thinking panel and
  // are drained in-order once the current turn finishes.
  const queuedDrafts = useChatStore((s) =>
    activeSessionId
      ? s.queuedDraftsBySession[activeSessionId] || EMPTY_QUEUED_DRAFTS
      : EMPTY_QUEUED_DRAFTS,
  );
  useEffect(() => {
    if (!activeSessionId || streaming) return;
    if (queuedDrafts.length === 0) return;
    const drafts = drainQueuedDrafts(activeSessionId);
    if (drafts.length === 0) return;
    sendDraft(mergeQueuedDrafts(drafts));
  }, [activeSessionId, streaming, queuedDrafts, drainQueuedDrafts, sendDraft]);

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
        <div className="asv-messages" ref={messagesScrollRef} onScroll={handleMessagesScroll}>
          {messages.length === 0 && queuedDrafts.length === 0 && !streaming && (
            <EmptyState
              agentName={agentName}
              displayName={displayName}
              activeSessionId={activeSessionId}
              onSuggestionClick={handleSuggestionClick}
            />
          )}

          {messages
            .filter((msg) => !msg.queued)
            .map((msg, i) => (
              <MessageItem key={i} msg={msg} onFork={handleFork} onEdit={handleEdit} />
            ))}

          <StreamingMessage
            agentName={agentName}
            liveSegments={liveSegments}
            thinkingStart={thinkingStart}
            streaming={streaming}
          />

          {queuedDrafts.map((draft) => (
            <MessageItem
              key={draft.id}
              msg={{
                role: "user",
                content: draft.text,
                queued: true,
              }}
              onFork={handleFork}
              onEdit={handleEdit}
            />
          ))}

          <div ref={messagesEnd} />
        </div>
        {!atBottom && (
          <button
            type="button"
            className="asv-jump-bottom"
            onClick={() => {
              scrollToBottom("auto");
              setAtBottom(true);
            }}
          >
            Jump to latest
          </button>
        )}
      </div>
    </div>
  );
}
