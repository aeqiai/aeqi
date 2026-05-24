import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { api } from "@/lib/api";
import { logError } from "@/lib/logging";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useNav } from "@/hooks/useNav";
import { createDraftId, useChatStore, type PendingMessage } from "@/store/chat";
import { useMessageProcessor } from "./session/useMessageProcessor";
import { useSessionManager } from "./session/useSessionManager";
import { useWebSocketChat } from "./session/useWebSocketChat";
import { useFileAttachments } from "./session/useFileAttachments";
import MessageItem from "./session/MessageItem";
import StreamingMessage from "./session/StreamingMessage";
import EmptyState from "./session/EmptyState";
import SessionDetail from "./sessions/SessionDetail";
import { sessionLabel } from "./session/types";

// ── Queued draft helpers ───────────────────────────────────────────────────

const EMPTY_QUEUED_DRAFTS: PendingMessage[] = [];

// ── Origin helper ─────────────────────────────────────────────────────────
//
// Mirrors the prior shell/SessionsRail.tsx prefix-stripping rules: surface
// the transport origin (telegram / whatsapp / web) on the detail header
// where it doesn't compete with the session title in the rail row.
function deriveOrigin(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  if (/^telegram dm:/i.test(name) || /^telegram:/i.test(name)) return "telegram";
  if (/^telegram group/i.test(name)) return "telegram · group";
  if (/^whatsapp:/i.test(name)) return "whatsapp";
  return undefined;
}

interface AgentSessionProps {
  agentId: string;
  sessionId: string | null;
}

/**
 * Agent session surface — drilled-into-an-agent inbox/chat view.
 *
 * Renders `<SessionDetail hideComposer={true} />` so the visual chrome
 * (ParticipantStrip + Header + Transcript) matches the entity inbox
 * (`/trust/<addr>/inbox`) exactly.
 * The composer for this surface lives in `AppLayout`'s `<ComposerRow>`
 * chrome and communicates via window events (`aeqi:send-message`,
 * `aeqi:stop-streaming`, `aeqi:streaming-state`).
 *
 * This component owns the WS streaming wiring, queued drafts, file
 * drag-drop, attach pickers, and keyboard shortcuts — none of which fit
 * inside the universal SessionDetail primitive. Those are surfaced into
 * the primitive via the threadTrailingSlot, onFork/onEdit/onResend, and
 * preThreadSlot props.
 */
export default function AgentSessionView({ agentId, sessionId: urlSessionId }: AgentSessionProps) {
  const token = useAuthStore((s) => s.token);
  const agents = useDaemonStore((s) => s.agents);
  const { trustId: routeTrustId } = useNav();

  const agentInfo = agents.find((a) => a.id === agentId);
  const agentName = agentInfo?.name || agentId;
  const displayName = agentName;
  const trustId = routeTrustId || agentInfo?.trust_id || null;

  const [sessionIdeas, setSessionIdeas] = useState<string[]>([]);
  const [sessionTask, setSessionTask] = useState<{ id: string; name: string } | null>(null);
  const [showAttachPicker, setShowAttachPicker] = useState<"idea" | "quest" | null>(null);
  const [availableIdeas, setAvailableIdeas] = useState<
    { name: string; description: string; tags: string[] }[]
  >([]);
  const [availableTasks, setAvailableTasks] = useState<
    { id: string; name: string; status: string }[]
  >([]);

  const processRawMessages = useMessageProcessor();

  const fileAttachments = useFileAttachments();

  const sessionManager = useSessionManager({
    agentId,
    urlSessionId,
    processRawMessages,
  });

  // Mirror the messages list into a ref so the WS hook can read the
  // current trailing message synchronously (decides skip-vs-attach on
  // live subscribe without going through React state propagation).
  const messagesRef = useRef(sessionManager.messages);
  messagesRef.current = sessionManager.messages;

  const wsChat = useWebSocketChat({
    token,
    agentId,
    agentName,
    trustId,
    activeSessionId: sessionManager.activeSessionId,
    sessionIdRef: sessionManager.sessionIdRef,
    prevSessionRef: sessionManager.prevSessionRef,
    setSession: sessionManager.setSession,
    setSessions: sessionManager.setSessions,
    messagesRef,
    setMessages: sessionManager.setMessages,
    sessionIdeas,
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
  } = sessionManager;

  const { streaming, liveSegments, thinkingStart, liveStepOffset, dispatchMessage } = wsChat;

  // Keeps polling paused while streaming.
  streamingRef.current = streaming;

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
        .catch((e) => logError("agent-session.load-ideas", e));
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
        .catch((e) => logError("agent-session.load-quests", e));
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
    // Bridge from ComposerRow's slash palette / attach buttons (which run
    // outside this view's React tree) to the local picker state.
    const openPickerHandler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const kind = detail?.kind;
      if (kind === "idea" || kind === "quest") {
        setShowAttachPicker((prev) => (prev === kind ? null : kind));
      }
    };
    window.addEventListener("aeqi:open-attach-picker", openPickerHandler);
    return () => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("aeqi:new-session", newSessionHandler);
      window.removeEventListener("aeqi:open-attach-picker", openPickerHandler);
    };
  }, [handleNewConversation]);

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

  // Resend a user message verbatim within the same session — no edit
  // flow, no forking. Appends a fresh optimistic user bubble and fires
  // the same dispatch path the composer uses.
  const handleResend = useCallback(
    (text: string) => {
      setMessages((prev) => [...prev, { role: "user", content: text, timestamp: Date.now() }]);
      void dispatchMessage(text);
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
  // are dispatched one at a time once the current turn finishes. Each draft
  // stays a distinct user message so multiple queued sends do not collapse
  // into one combined turn.
  const queuedDrafts = useChatStore((s) =>
    activeSessionId
      ? s.queuedDraftsBySession[activeSessionId] || EMPTY_QUEUED_DRAFTS
      : EMPTY_QUEUED_DRAFTS,
  );
  useEffect(() => {
    if (!activeSessionId || streaming) return;
    if (queuedDrafts.length === 0) return;
    const draft = useChatStore.getState().consumeQueuedDraft(activeSessionId);
    if (!draft) return;
    sendDraft(draft);
  }, [activeSessionId, streaming, queuedDrafts, sendDraft]);

  // Drop queued drafts (rendered separately in the trailing slot) and,
  // while streaming, the trailing draft assistant row from the DB poll —
  // the StreamingMessage owns the live turn; rendering both produces two
  // stacked thinking panels.
  const renderableMessages = useMemo(
    () =>
      messages.filter((msg, i, arr) => {
        if (msg.queued) return false;
        if (streaming && msg.role === "assistant" && msg.draft && i === arr.length - 1) {
          return false;
        }
        return true;
      }),
    [messages, streaming],
  );

  if (!agentId) return null;

  // ── SessionDetail bindings ───────────────────────────────────────────────

  const currentSession = sessions.find((s) => s.id === activeSessionId) || null;
  const title = currentSession ? sessionLabel(currentSession) : agentName;
  const subtitle = deriveOrigin(currentSession?.name);

  // Empty-state — surfaces the agent's full <EmptyState> block when there
  // are no messages, no queued drafts, and no live stream. Wraps in
  // preThreadSlot so SessionDetail's own empty-state title doesn't double.
  const showEmptyState = renderableMessages.length === 0 && queuedDrafts.length === 0 && !streaming;

  const threadTrailingSlot = (
    <>
      <StreamingMessage
        agentName={agentName}
        liveSegments={liveSegments}
        thinkingStart={thinkingStart}
        streaming={streaming}
        stepOffset={liveStepOffset}
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
          onResend={handleResend}
          sessionAgentId={agentId}
        />
      ))}
    </>
  );

  const preThreadSlot = showEmptyState ? (
    <EmptyState
      agentId={agentId}
      agentName={agentName}
      displayName={displayName}
      activeSessionId={activeSessionId}
      onSuggestionClick={handleSuggestionClick}
    />
  ) : null;

  return (
    <div
      className={`asv ${fileAttachments.dragOver ? "asv--dragover" : ""}`}
      onDrop={fileAttachments.handleDrop}
      onDragOver={fileAttachments.handleDragOver}
      onDragEnter={fileAttachments.handleDragEnter}
      onDragLeave={fileAttachments.handleDragLeave}
    >
      <SessionDetail
        sessionId={activeSessionId}
        trustId={trustId || undefined}
        agentId={agentId}
        title={title}
        subtitle={subtitle}
        messages={renderableMessages}
        isStreaming={streaming}
        onSend={() => {
          /* composer chrome lives in AppLayout; SessionDetail's composer is hidden */
        }}
        hideComposer={true}
        preThreadSlot={preThreadSlot}
        threadTrailingSlot={threadTrailingSlot}
        onFork={handleFork}
        onEdit={handleEdit}
        onResend={handleResend}
        emptyTitle="no messages yet"
        surface="recessed"
      />
    </div>
  );
}
