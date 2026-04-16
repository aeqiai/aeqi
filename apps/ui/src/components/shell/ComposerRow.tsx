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
}

/**
 * Persistent composer row at the bottom of the content card. Communicates
 * with the active AgentSessionView via window events, and with the chat
 * store via a `pendingMessage` slot for the "type-anywhere, navigate, and
 * send on mount" flow.
 *
 * The composer owns all of its own local state (input, attachments, prompt
 * picker, drag overlay). The send flow is:
 *   1. If a chat is mounted, fire `aeqi:send-message` — the active view
 *      picks it up and dispatches it through its websocket.
 *   2. If not, stash the payload in chat store and navigate to /sessions.
 *      The chat view drains `pendingMessage` on mount.
 */
export default function ComposerRow({ agentId, base }: ComposerRowProps) {
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
    if (agentId) {
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
  }, [input, files, prompts, task, agentId, setPendingMessage, navigate, base]);

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

  // Reset streaming indicator whenever the active chat changes.
  useEffect(() => {
    setStreaming(false);
  }, [agentId]);

  return (
    <div className="composer-row">
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
