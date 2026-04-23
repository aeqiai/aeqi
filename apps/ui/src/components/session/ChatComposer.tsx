import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "@/components/ui";
import SlashPalette, { type SlashCommand } from "./SlashPalette";

interface ChatComposerProps {
  input: string;
  setInput: (val: string) => void;
  streaming: boolean;
  displayName: string;
  sessionIdeas: string[];
  setSessionIdeas: React.Dispatch<React.SetStateAction<string[]>>;
  sessionTask: { id: string; name: string } | null;
  setSessionTask: (val: { id: string; name: string } | null) => void;
  attachedFiles: { name: string; content: string; size: number }[];
  setAttachedFiles: React.Dispatch<
    React.SetStateAction<{ name: string; content: string; size: number }[]>
  >;
  setShowAttachPicker: (val: "idea" | "quest" | null) => void;
  readFiles: (files: FileList | File[]) => void;
  dragOver: boolean;
  setDragOver: (val: boolean) => void;
  dragCounter: React.MutableRefObject<number>;
  onSend: () => void;
  onStop: () => void;
  inputRef: React.RefObject<HTMLTextAreaElement | null>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  /**
   * Prior user-message texts for the current session, oldest→newest. Used to
   * seed the ArrowUp scrollback so prior turns (including ones typed in a
   * different browser tab / before reload) are reachable from the composer.
   * Re-seeded when it changes (keyed on session switch by the parent).
   */
  historySeed?: string[];
}

const HISTORY_LIMIT = 50;

export default function ChatComposer({
  input,
  setInput,
  streaming,
  displayName,
  sessionIdeas,
  setSessionIdeas,
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
  historySeed,
}: ChatComposerProps) {
  // Slash-command palette state. `open` gates rendering; `query` is the
  // fragment typed after the leading "/" (lowercased, used to filter).
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashActive, setSlashActive] = useState(0);

  // Draft we park when the user starts walking backward through history, so
  // ArrowDown past the latest history entry restores what they were typing.
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef<number | null>(null);
  const draftRef = useRef<string>("");

  // Seed the scrollback whenever the parent hands us a new history (usually
  // on session switch). We take a fresh tail-cap copy so subsequent sends
  // can push on top without mutating the parent's data.
  useEffect(() => {
    if (!historySeed) return;
    const capped = historySeed.slice(-HISTORY_LIMIT);
    historyRef.current = capped;
    historyIdxRef.current = null;
    draftRef.current = "";
  }, [historySeed]);

  const commands = useMemo<SlashCommand[]>(
    () => [
      {
        slug: "idea",
        label: "Attach an idea to this message",
        shortcut: "⌘P",
        run: () => setShowAttachPicker("idea"),
      },
      {
        slug: "quest",
        label: "Attach a quest",
        shortcut: "⌘Q",
        run: () => setShowAttachPicker("quest"),
      },
      {
        slug: "file",
        label: "Attach a file from disk",
        run: () => fileInputRef.current?.click(),
      },
      {
        slug: "clear",
        label: "Clear the current draft",
        run: () => {
          setInput("");
          historyIdxRef.current = null;
        },
      },
    ],
    [setShowAttachPicker, fileInputRef, setInput],
  );

  const filtered = useMemo(() => {
    if (!slashQuery) return commands;
    const q = slashQuery.toLowerCase();
    return commands.filter((c) => c.slug.startsWith(q) || c.label.toLowerCase().includes(q));
  }, [commands, slashQuery]);

  const dismissSlash = useCallback(() => {
    setSlashOpen(false);
    setSlashQuery("");
    setSlashActive(0);
  }, []);

  const runSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      // Strip the slash token we just consumed so the textarea isn't left with
      // "/idea" as literal text after the command executes.
      const el = inputRef.current;
      if (el) {
        const caret = el.selectionStart ?? input.length;
        const before = input.slice(0, caret);
        const lastSlash = before.lastIndexOf("/");
        if (lastSlash >= 0) {
          const next = input.slice(0, lastSlash) + input.slice(caret);
          setInput(next);
          requestAnimationFrame(() => {
            if (inputRef.current) {
              inputRef.current.selectionStart = lastSlash;
              inputRef.current.selectionEnd = lastSlash;
            }
          });
        }
      }
      cmd.run();
    },
    [input, inputRef, setInput],
  );

  const pushHistoryAndSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const h = historyRef.current;
    // De-dupe consecutive identical entries.
    if (h[h.length - 1] !== text) {
      h.push(text);
      if (h.length > HISTORY_LIMIT) h.shift();
    }
    historyIdxRef.current = null;
    draftRef.current = "";
    onSend();
  }, [input, onSend]);

  const stepHistory = useCallback(
    (direction: -1 | 1) => {
      const h = historyRef.current;
      if (h.length === 0) return false;
      const idx = historyIdxRef.current;
      if (direction === -1) {
        // Walking back into history.
        if (idx === null) {
          // First step — stash the live draft.
          draftRef.current = input;
          historyIdxRef.current = h.length - 1;
        } else if (idx > 0) {
          historyIdxRef.current = idx - 1;
        } else {
          return true; // already at oldest — consume the key without moving
        }
        setInput(h[historyIdxRef.current]);
        return true;
      }
      // direction === 1 (forward toward present).
      if (idx === null) return false;
      if (idx < h.length - 1) {
        historyIdxRef.current = idx + 1;
        setInput(h[historyIdxRef.current]);
      } else {
        historyIdxRef.current = null;
        setInput(draftRef.current);
      }
      return true;
    },
    [input, setInput],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Palette owns arrow/enter/esc when open.
      if (slashOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActive((i) => (filtered.length ? (i + 1) % filtered.length : 0));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActive((i) =>
            filtered.length ? (i - 1 + filtered.length) % filtered.length : 0,
          );
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const cmd = filtered[slashActive];
          if (cmd) runSlashCommand(cmd);
          dismissSlash();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          dismissSlash();
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        pushHistoryAndSend();
        return;
      }

      // History scrollback — only fires when palette is closed AND caret is at
      // the top (ArrowUp) or bottom (ArrowDown) of the textarea. Inline editing
      // always wins.
      if (e.key === "ArrowUp" && !e.shiftKey) {
        const el = e.currentTarget;
        if (el.selectionStart === 0 && el.selectionEnd === 0) {
          if (stepHistory(-1)) e.preventDefault();
        }
        return;
      }
      if (e.key === "ArrowDown" && !e.shiftKey) {
        const el = e.currentTarget;
        if (el.selectionStart === input.length && el.selectionEnd === input.length) {
          if (historyIdxRef.current !== null) {
            if (stepHistory(1)) e.preventDefault();
          }
        }
      }
    },
    [
      slashOpen,
      filtered,
      slashActive,
      runSlashCommand,
      dismissSlash,
      pushHistoryAndSend,
      stepHistory,
      input.length,
    ],
  );

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      setInput(next);
      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 360)}px`;

      // Slash-palette tracking: look backward from the caret. A "/" that sits
      // at column 0 or follows whitespace opens the palette; anything typed
      // between that "/" and the caret becomes the query. A space or newline
      // closes the palette.
      const caret = el.selectionStart ?? next.length;
      const before = next.slice(0, caret);
      const match = before.match(/(?:^|\s)(\/\w*)$/);
      if (match) {
        setSlashOpen(true);
        setSlashQuery(match[1].slice(1));
        setSlashActive(0);
      } else if (slashOpen) {
        dismissSlash();
      }
    },
    [setInput, slashOpen, dismissSlash],
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
          <SlashPalette
            open={slashOpen}
            query={slashQuery}
            commands={filtered}
            activeIndex={slashActive}
            onActiveChange={setSlashActive}
            onRun={runSlashCommand}
            onDismiss={dismissSlash}
          />
          <div className="asv-composer-body">
            {/* Attached chips — always visible */}
            {(sessionIdeas.length > 0 || sessionTask || attachedFiles.length > 0) && (
              <div className="asv-attach-chips">
                {sessionIdeas.map((p, i) => (
                  <span key={`p-${i}`} className="asv-attach-chip">
                    {p}
                    <button
                      type="button"
                      className="asv-attach-chip-x"
                      onClick={() => setSessionIdeas((prev) => prev.filter((_, j) => j !== i))}
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
                  onClick={() => setShowAttachPicker("idea")}
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
                {/* Send button holds the primary slot when idle; during
                    streaming it becomes Queue and is only rendered once
                    there's actually a draft to queue. That keeps the
                    send-stack's reserved height at one button's worth,
                    so the composer's footer doesn't grow the moment
                    streaming begins — CSS floats this button above Stop
                    when both are on-screen. */}
                {(!streaming || input.trim()) && (
                  <button
                    className={`asv-send ${input.trim() ? "ready" : ""}`}
                    onClick={pushHistoryAndSend}
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
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="asv-composer-ribbon">
          <span>
            <kbd>/</kbd>&nbsp;commands
          </span>
          <span>
            <kbd>⌘P</kbd>&nbsp;ideas
          </span>
          <span>
            <kbd>⌘Q</kbd>&nbsp;quests
          </span>
          <span>
            <kbd>↑</kbd>&nbsp;history
          </span>
          <span>
            <kbd>⇧⏎</kbd>&nbsp;newline
          </span>
        </div>
      </div>
    </>
  );
}
