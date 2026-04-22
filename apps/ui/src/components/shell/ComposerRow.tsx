import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ChatComposer from "@/components/session/ChatComposer";
import { useChatStore } from "@/store/chat";
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
 * The composer owns all of its own local state (input, attachments, prompt
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
  const agents = useDaemonStore((s) => s.agents);
  const setPendingMessage = useChatStore((s) => s.setPendingMessage);

  const agent = agents.find((a) => a.id === agentId || a.name === agentId);
  const agentDisplayName = agent?.display_name || agent?.name || agentId || "";

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<{ name: string; content: string; size: number }[]>([]);
  const [prompts, setPrompts] = useState<string[]>([]);
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
      text,
      files: files.length > 0 ? files : undefined,
      prompts: prompts.length > 0 ? prompts : undefined,
      task: task || undefined,
    };
    if (sessionsMounted) {
      window.dispatchEvent(new CustomEvent("aeqi:send-message", { detail }));
    } else {
      setPendingMessage(detail);
      navigate(`${base}/sessions`);
    }
    setInput("");
    setFiles([]);
    setPrompts([]);
    setTask(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [input, files, prompts, task, sessionsMounted, setPendingMessage, navigate, base]);

  const handleStop = useCallback(() => {
    window.dispatchEvent(new CustomEvent("aeqi:stop-streaming"));
  }, []);

  // Stream state comes back from AgentSessionView via event.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      setStreaming(detail.streaming);
    };
    window.addEventListener("aeqi:streaming-state", handler);
    return () => window.removeEventListener("aeqi:streaming-state", handler);
  }, []);

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
  }, [agentId]);

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
  // .content-main-col so the thread's bottom padding and scroll-fade grow
  // with the card. Without this, typing a multi-line draft would push the
  // last message underneath the expanding composer.
  const rowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const col = el.closest<HTMLElement>(".content-main-col");
    if (!col) return;
    const apply = () => {
      col.style.setProperty("--composer-height", `${Math.ceil(el.offsetHeight)}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => {
      ro.disconnect();
      col.style.removeProperty("--composer-height");
    };
  }, []);

  return (
    <div className="composer-row" ref={rowRef}>
      <div className="composer-wrap">
        <div className="persistent-composer">
          <ChatComposer
            input={input}
            setInput={setInput}
            streaming={streaming}
            displayName={agentDisplayName || "agent"}
            sessionPrompts={prompts}
            setSessionPrompts={setPrompts}
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
          />
        </div>
      </div>
      <div className="composer-spacer" aria-hidden />
    </div>
  );
}
