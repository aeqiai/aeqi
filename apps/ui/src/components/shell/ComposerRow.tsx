import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ChatComposer from "@/components/session/ChatComposer";
import { api } from "@/lib/api";
import { createDraftId, useChatStore } from "@/store/chat";
import { useDaemonStore } from "@/store/daemon";

interface ComposerRowProps {
  /** Current agent receiving messages, or null when no chat is mounted. */
  agentId: string | null;
  /** Base path for this root scope (e.g. "/root-1"). Used for navigation. */
  base: string;
  /** True iff AgentSessionView is mounted and listening for send events. */
  sessionsMounted: boolean;
}

/**
 * Persistent composer row at the bottom of the content card. Communicates
 * with the active AgentSessionView via window events, and with the chat
 * store via a `pendingMessage` slot for the "type-anywhere, navigate, and
 * send on mount" flow.
 *
 * The composer owns all of its own local state (input, attachments, idea
 * picker, drag overlay). The send flow is:
 *   1. If AgentSessionView is mounted, fire `aeqi:send-message` — the
 *      active view picks it up and dispatches it through its websocket.
 *   2. Otherwise (user is on /:agent/quests, /events, etc.) stash the
 *      payload in chat store and navigate to /:agent/sessions. The chat
 *      view drains `pendingMessage` on mount and the send continues
 *      seamlessly.
 */
export default function ComposerRow({ agentId, base, sessionsMounted }: ComposerRowProps) {
  const navigate = useNavigate();
  const { tab, itemId } = useParams<{ tab?: string; itemId?: string }>();
  const agents = useDaemonStore((s) => s.agents);
  const setPendingMessage = useChatStore((s) => s.setPendingMessage);

  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const agentDisplayName = agent?.name || agentId || "";
  const currentSessionId = tab === "sessions" ? itemId || null : null;

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<{ name: string; content: string; size: number }[]>([]);
  const [ideas, setIdeas] = useState<string[]>([]);
  const [task, setTask] = useState<{ id: string; name: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);

  const readFiles = useCallback((fl: FileList | File[]) => {
    Array.from(fl).forEach((file) => {
      if (file.size > 512_000) return;
      const reader = new FileReader();
      reader.onload = () => {
        const content = reader.result as string;
        setFiles((prev) => {
          if (prev.some((f) => f.name === file.name)) return prev;
          return [...prev, { name: file.name, content, size: file.size }];
        });
      };
      reader.readAsText(file);
    });
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const detail = {
      id: createDraftId(),
      text,
      files: files.length > 0 ? files : undefined,
      ideas: ideas.length > 0 ? ideas : undefined,
      task: task || undefined,
    };
    if (sessionsMounted) {
      window.dispatchEvent(new CustomEvent("aeqi:send-message", { detail }));
    } else {
      if (agentId) setPendingMessage(agentId, detail);
      navigate(`${base}/sessions`);
    }
    setInput("");
    setFiles([]);
    setIdeas([]);
    setTask(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [input, files, ideas, task, sessionsMounted, setPendingMessage, navigate, base, agentId]);

  const handleStop = useCallback(() => {
    window.dispatchEvent(new CustomEvent("aeqi:stop-streaming"));
  }, []);

  // Stream state comes back from AgentSessionView via event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!currentSessionId || !detail?.sessionId || detail.sessionId !== currentSessionId) {
        return;
      }
      setStreaming(detail.streaming);
    };
    window.addEventListener("aeqi:streaming-state", handler);
    return () => window.removeEventListener("aeqi:streaming-state", handler);
  }, [currentSessionId]);

  // "Edit and resend" hands the composer the original user text so it can
  // be revised in place. Forking happens upstream; we only manage input.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const text = (detail?.text as string) || "";
      setInput(text);
      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.style.height = "auto";
        el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
        const len = el.value.length;
        el.setSelectionRange(len, len);
      });
    };
    window.addEventListener("aeqi:set-composer-input", handler);
    return () => window.removeEventListener("aeqi:set-composer-input", handler);
  }, []);

  // Reset streaming indicator whenever the active chat changes.
  useEffect(() => {
    setStreaming(false);
  }, [agentId, currentSessionId]);

  // Seed the composer's arrow-up scrollback with every prior user message
  // from this session — so reloads and cross-tab navigation don't lose the
  // scrollback, and new visitors to an old session can step back through
  // what was asked before.
  const [historySeed, setHistorySeed] = useState<string[]>([]);
  useEffect(() => {
    if (!currentSessionId) {
      setHistorySeed([]);
      return;
    }
    let cancelled = false;
    api
      .getSessionMessages(currentSessionId, 500)
      .then((d: Record<string, unknown>) => {
        if (cancelled) return;
        const raw = (d.messages as Array<Record<string, unknown>>) || [];
        const userTexts = raw
          .filter((m) => m.role === "user" || m.role === "User")
          .map((m) => String(m.content || "").trim())
          .filter((t) => t.length > 0);
        setHistorySeed(userTexts);
      })
      .catch(() => {
        if (!cancelled) setHistorySeed([]);
      });
    return () => {
      cancelled = true;
    };
  }, [currentSessionId]);

  // Keyboard shortcut `c` jumps focus into the composer without touching
  // the current input — lets a power user start typing from anywhere in
  // the app. Separate from set-composer-input (which replaces the text).
  useEffect(() => {
    const handler = () => {
      requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("aeqi:focus-composer", handler);
    return () => window.removeEventListener("aeqi:focus-composer", handler);
  }, []);

  // Publish the composer's live height as --composer-height on the enclosing
  // .content-main-col so the session's bottom padding and scroll-fade grow
  // with the card. Without this, typing a multi-line draft would push the
  // last message underneath the expanding composer.
  const rowRef = useRef<HTMLDivElement>(null);
  const lastHeightRef = useRef<number>(0);

  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const col = el.closest<HTMLElement>(".content-main-col");
    if (!col) return;

    const apply = () => {
      const newHeight = Math.ceil(el.offsetHeight);
      // Only update if height actually changed (helps prevent unnecessary reflows)
      if (newHeight !== lastHeightRef.current) {
        lastHeightRef.current = newHeight;
        col.style.setProperty("--composer-height", `${newHeight}px`);
      }
    };

    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);

    // Also observe child elements that might affect height
    const composerInner = el.querySelector(".asv-composer-inner");
    if (composerInner) {
      ro.observe(composerInner);
    }

    return () => {
      ro.disconnect();
      col.style.removeProperty("--composer-height");
    };
  }, []);

  // Force height recalculation when input changes significantly
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;

    // Debounced height recalculation for input changes
    const timeoutId = setTimeout(() => {
      const col = el.closest<HTMLElement>(".content-main-col");
      if (col) {
        const newHeight = Math.ceil(el.offsetHeight);
        if (newHeight !== lastHeightRef.current) {
          lastHeightRef.current = newHeight;
          col.style.setProperty("--composer-height", `${newHeight}px`);
        }
      }
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [input, ideas.length, task, files.length]);

  return (
    <div className="composer-row" ref={rowRef}>
      <div className="composer-wrap">
        <div className="persistent-composer">
          <ChatComposer
            input={input}
            setInput={setInput}
            streaming={streaming}
            displayName={agentDisplayName || "agent"}
            sessionIdeas={ideas}
            setSessionIdeas={setIdeas}
            sessionTask={task}
            setSessionTask={setTask}
            attachedFiles={files}
            setAttachedFiles={setFiles}
            setShowAttachPicker={() => {}}
            readFiles={readFiles}
            dragOver={dragOver}
            setDragOver={setDragOver}
            dragCounter={dragCounter}
            onSend={handleSend}
            onStop={handleStop}
            inputRef={inputRef}
            fileInputRef={fileInputRef}
            historySeed={historySeed}
          />
        </div>
      </div>
      <div className="composer-spacer" aria-hidden />
    </div>
  );
}
