import { useCallback } from "react";
import { IconButton } from "@/components/ui";

interface ChatComposerProps {
  input: string;
  setInput: (val: string) => void;
  streaming: boolean;
  displayName: string;
  sessionPrompts: string[];
  setSessionPrompts: React.Dispatch<React.SetStateAction<string[]>>;
  sessionTask: { id: string; name: string } | null;
  setSessionTask: (val: { id: string; name: string } | null) => void;
  attachedFiles: { name: string; content: string; size: number }[];
  setAttachedFiles: React.Dispatch<
    React.SetStateAction<{ name: string; content: string; size: number }[]>
  >;
  setShowAttachPicker: (val: "prompt" | "quest" | null) => void;
  readFiles: (files: FileList | File[]) => void;
  dragOver: boolean;
  setDragOver: (val: boolean) => void;
  dragCounter: React.MutableRefObject<number>;
  onSend: () => void;
  onStop: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
}

export default function ChatComposer({
  input,
  setInput,
  streaming,
  displayName,
  sessionPrompts,
  setSessionPrompts,
  sessionTask,
  setSessionTask,
  attachedFiles,
  setAttachedFiles,
  setShowAttachPicker,
  readFiles,
  dragOver: _dragOver,
  setDragOver,
  dragCounter,
  onSend,
  onStop,
  inputRef,
  fileInputRef,
}: ChatComposerProps) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    },
    [onSend],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 360)}px`;
    },
    [setInput],
  );

  return (
    <>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          if (e.target.files) readFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* Input box */}
      <div className="asv-composer">
        <div className={`asv-composer-inner ${streaming ? "asv-composer-busy" : ""}`}>
          <div className="asv-composer-body">
            {/* Attached chips — always visible */}
            {(sessionPrompts.length > 0 || sessionTask || attachedFiles.length > 0) && (
              <div className="asv-attach-chips">
                {sessionPrompts.map((p, i) => (
                  <span key={`p-${i}`} className="asv-attach-chip">
                    {p}
                    <button
                      type="button"
                      className="asv-attach-chip-x"
                      onClick={() => setSessionPrompts((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={`Remove ${p}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {sessionTask && (
                  <span className="asv-attach-chip">
                    {sessionTask.name}
                    <button
                      type="button"
                      className="asv-attach-chip-x"
                      onClick={() => setSessionTask(null)}
                      aria-label={`Remove ${sessionTask.name}`}
                    >
                      ×
                    </button>
                  </span>
                )}
                {attachedFiles.map((f, i) => (
                  <span key={`f-${i}`} className="asv-attach-chip">
                    {f.name}
                    <button
                      type="button"
                      className="asv-attach-chip-x"
                      onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={`Remove ${f.name}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <textarea
              ref={inputRef}
              className="asv-textarea"
              placeholder={streaming ? "Queue a message..." : `Message ${displayName}...`}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              onDrop={(e) => {
                if (e.dataTransfer.files.length > 0) {
                  e.preventDefault();
                  e.stopPropagation();
                  dragCounter.current = 0;
                  setDragOver(false);
                  readFiles(e.dataTransfer.files);
                }
              }}
              rows={2}
            />
            {/* Footer — attach actions left, send right */}
            <div className="asv-composer-footer">
              <div className="asv-attach-row">
                <IconButton
                  variant="ghost"
                  size="sm"
                  className="asv-attach-btn"
                  onClick={() => setShowAttachPicker("prompt")}
                  aria-label="Attach idea"
                  title="Attach idea (Cmd+P)"
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <path
                      d="M7 2v2M7 10v2M2 7h2M10 7h2M3.8 3.8l1.4 1.4M8.8 8.8l1.4 1.4M10.2 3.8l-1.4 1.4M5.2 8.8l-1.4 1.4"
                      strokeLinecap="round"
                    />
                  </svg>
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="sm"
                  className="asv-attach-btn"
                  onClick={() => setShowAttachPicker("quest")}
                  aria-label="Attach quest"
                  title="Attach quest (Cmd+Q)"
                >
                  <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                    <path d="M4 3h8M4 7h8M4 11h6M2 3v0M2 7v0M2 11v0" strokeLinecap="round" />
                  </svg>
                </IconButton>
                <IconButton
                  variant="ghost"
                  size="sm"
                  className="asv-attach-btn"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach file"
                  title="Attach file"
                >
                  <svg
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  >
                    <path d="M7.5 2L4 5.5a2.12 2.12 0 003 3L10.5 5a3 3 0 00-4.24-4.24L2.5 4.5a4.24 4.24 0 006 6L12 7" />
                  </svg>
                </IconButton>
              </div>
              <div className="asv-send-stack">
                {streaming && (
                  <button className="asv-send busy" onClick={onStop} title="Stop execution">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="3" y="3" width="10" height="10" rx="2" />
                    </svg>
                    <span className="asv-send-label">Stop</span>
                  </button>
                )}
                <button
                  className={`asv-send ${input.trim() ? "ready" : ""}`}
                  onClick={onSend}
                  disabled={!input.trim()}
                  title={streaming ? "Queue message" : "Send"}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  >
                    <path
                      d="M3 8h10M9.5 4.5L13 8l-3.5 3.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span className="asv-send-label">{streaming ? "Queue" : "Send"}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="asv-composer-hint">
          <kbd>Enter</kbd>&nbsp;send&ensp;<kbd>Shift+Enter</kbd>&nbsp;newline
        </div>
      </div>
    </>
  );
}
