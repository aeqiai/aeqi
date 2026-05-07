/**
 * Composer — canonical conversation primitive.
 *
 * Per `architecture_session_primitive.md`: Session is the universal
 * conversation primitive (chat / inbox / comments / activity / channels /
 * mentions). Five surface-specific composers contradicted that contract;
 * this primitive collapses them into one and each surface mounts it with
 * its own props.
 *
 * Capability surface (opt-in via props, all default to off):
 *   - auto-resize textarea
 *   - "/"-palette (slash commands: idea, quest, file, clear) + ⌘P/⌘Q/⌘F
 *     shortcuts when `attachmentTypes` is set
 *   - ArrowUp scrollback over `historySource` (50 entries, de-duped)
 *   - attached chips above input (ideas / quest / files)
 *   - drag-drop files when an attachment handler is wired
 *   - streaming Stop / Queue states
 *   - kbd ribbon at the bottom (revealed on focus)
 *   - @mention autocomplete from a `mentionables` source (channel surface)
 *   - surface-specific extra actions slot (e.g. inbox Archive)
 *
 * Enter sends, ⇧⏎ inserts newline. `composerRef` exposes the inner
 * textarea so parents can focus it (used by the inbox surface,
 * AppLayout's `aeqi:focus-composer` event, etc.).
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChipClose, IconButton, Textarea, Tooltip } from "@/components/ui";
import SlashPalette, { type SlashCommand } from "@/components/session/SlashPalette";

const HISTORY_LIMIT = 50;

export type ComposerAttachmentKind = "idea" | "quest" | "file";

export interface ComposerFile {
  name: string;
  content: string;
  size: number;
}

export interface ComposerMentionTarget {
  kind: string;
  id: string;
  label: string;
  /** The token inserted into the body after the `@`. */
  token: string;
}

export interface ComposerProps {
  // Input state — always required.
  value: string;
  onChange: (next: string) => void;
  onSend: () => void;

  // Surface context.
  placeholder?: string;
  composerRef?: React.RefObject<HTMLTextAreaElement | null>;
  disabled?: boolean;

  // Visual variant — controls outer chrome (background, padding, ribbon).
  // - "shell": flat full-width composer (chat session, AppLayout footer)
  // - "card":  bordered card on a surface (inbox, idea-comments, channels)
  variant?: "shell" | "card";

  // Attachments (opt-in slots).
  attachmentTypes?: ComposerAttachmentKind[];
  attachedIdeas?: string[];
  setAttachedIdeas?: React.Dispatch<React.SetStateAction<string[]>>;
  attachedQuest?: { id: string; name: string } | null;
  setAttachedQuest?: (next: { id: string; name: string } | null) => void;
  attachedFiles?: ComposerFile[];
  setAttachedFiles?: React.Dispatch<React.SetStateAction<ComposerFile[]>>;
  /** Open the parent's idea/quest picker modal. */
  onAttachClick?: (kind: "idea" | "quest") => void;
  /** Read a FileList off disk into ComposerFile entries. */
  onReadFiles?: (files: FileList | File[]) => void;

  // ArrowUp scrollback. Empty / undefined disables history.
  historySource?: string[];

  // Slash palette — auto-on when attachmentTypes is set; can be force-off.
  showSlashPalette?: boolean;

  // Streaming.
  streaming?: boolean;
  onStop?: () => void;

  // Kbd ribbon — auto-on with slash palette; can be force-off.
  showKbdRibbon?: boolean;

  // @mention autocomplete (channel surface). When non-empty, an `@`
  // followed by a partial name opens a list and Tab/Enter inserts the
  // canonical `@<kind>:<id>` token (matching aeqi-orchestrator's parser).
  mentionables?: ComposerMentionTarget[];

  // Surface-specific actions rendered before the Send button (e.g.
  // inbox Archive). Use IconButton or buttons styled for the asv-send row.
  extraActions?: React.ReactNode;

  // Send-button label override. Defaults to "Send" / "Queue" (streaming)
  // when not provided.
  sendLabel?: string;

  // Optional className on the outer wrapper.
  className?: string;
}

export interface ComposerHandle {
  focus: () => void;
}

const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    value,
    onChange,
    onSend,
    placeholder = "Message…",
    composerRef,
    disabled = false,
    variant = "shell",
    attachmentTypes,
    attachedIdeas,
    setAttachedIdeas,
    attachedQuest,
    setAttachedQuest,
    attachedFiles,
    setAttachedFiles,
    onAttachClick,
    onReadFiles,
    historySource,
    showSlashPalette,
    streaming = false,
    onStop,
    showKbdRibbon,
    mentionables,
    extraActions,
    sendLabel,
    className,
  },
  ref,
) {
  // ── Refs ──────────────────────────────────────────────────────────────
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = composerRef ?? internalRef;
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      focus: () => textareaRef.current?.focus(),
    }),
    [textareaRef],
  );

  // ── Capability gating ─────────────────────────────────────────────────
  const hasIdeas = attachmentTypes?.includes("idea") ?? false;
  const hasQuests = attachmentTypes?.includes("quest") ?? false;
  const hasFiles = attachmentTypes?.includes("file") ?? false;
  const hasAnyAttachment = hasIdeas || hasQuests || hasFiles;
  const slashEnabled = showSlashPalette ?? hasAnyAttachment;
  const ribbonEnabled = showKbdRibbon ?? slashEnabled;
  const hasMentions = (mentionables?.length ?? 0) > 0;

  // ── Slash palette state ───────────────────────────────────────────────
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const [slashActive, setSlashActive] = useState(0);

  const slashCommands = useMemo<SlashCommand[]>(() => {
    const cmds: SlashCommand[] = [];
    if (hasIdeas && onAttachClick) {
      cmds.push({
        slug: "idea",
        label: "Attach an idea to this message",
        shortcut: "⌘P",
        run: () => onAttachClick("idea"),
      });
    }
    if (hasQuests && onAttachClick) {
      cmds.push({
        slug: "quest",
        label: "Attach a quest",
        shortcut: "⌘Q",
        run: () => onAttachClick("quest"),
      });
    }
    if (hasFiles) {
      cmds.push({
        slug: "file",
        label: "Attach a file from disk",
        run: () => fileInputRef.current?.click(),
      });
    }
    cmds.push({
      slug: "clear",
      label: "Clear the current draft",
      run: () => {
        onChange("");
        historyIdxRef.current = null;
      },
    });
    return cmds;
  }, [hasIdeas, hasQuests, hasFiles, onAttachClick, onChange]);

  const filteredSlash = useMemo(() => {
    if (!slashQuery) return slashCommands;
    const q = slashQuery.toLowerCase();
    return slashCommands.filter((c) => c.slug.startsWith(q) || c.label.toLowerCase().includes(q));
  }, [slashCommands, slashQuery]);

  const dismissSlash = useCallback(() => {
    setSlashOpen(false);
    setSlashQuery("");
    setSlashActive(0);
  }, []);

  const runSlashCommand = useCallback(
    (cmd: SlashCommand) => {
      // Strip the slash token we just consumed so the textarea isn't left
      // with literal "/idea" after the command runs.
      const el = textareaRef.current;
      if (el) {
        const caret = el.selectionStart ?? value.length;
        const before = value.slice(0, caret);
        const lastSlash = before.lastIndexOf("/");
        if (lastSlash >= 0) {
          const next = value.slice(0, lastSlash) + value.slice(caret);
          onChange(next);
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.selectionStart = lastSlash;
              textareaRef.current.selectionEnd = lastSlash;
            }
          });
        }
      }
      cmd.run();
    },
    [value, textareaRef, onChange],
  );

  // ── History scrollback ────────────────────────────────────────────────
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef<number | null>(null);
  const draftRef = useRef<string>("");

  useEffect(() => {
    if (!historySource) return;
    historyRef.current = historySource.slice(-HISTORY_LIMIT);
    historyIdxRef.current = null;
    draftRef.current = "";
  }, [historySource]);

  const pushHistoryAndSend = useCallback(() => {
    const text = value.trim();
    if (!text) return;
    const h = historyRef.current;
    if (h[h.length - 1] !== text) {
      h.push(text);
      if (h.length > HISTORY_LIMIT) h.shift();
    }
    historyIdxRef.current = null;
    draftRef.current = "";
    onSend();
  }, [value, onSend]);

  const stepHistory = useCallback(
    (direction: -1 | 1) => {
      const h = historyRef.current;
      if (h.length === 0) return false;
      const idx = historyIdxRef.current;
      if (direction === -1) {
        if (idx === null) {
          draftRef.current = value;
          historyIdxRef.current = h.length - 1;
        } else if (idx > 0) {
          historyIdxRef.current = idx - 1;
        } else {
          return true;
        }
        onChange(h[historyIdxRef.current]);
        return true;
      }
      if (idx === null) return false;
      if (idx < h.length - 1) {
        historyIdxRef.current = idx + 1;
        onChange(h[historyIdxRef.current]);
      } else {
        historyIdxRef.current = null;
        onChange(draftRef.current);
      }
      return true;
    },
    [value, onChange],
  );

  // ── @mention autocomplete (channel surface) ───────────────────────────
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionActive, setMentionActive] = useState(0);

  const filteredMentions = useMemo(() => {
    if (!hasMentions) return [];
    const q = mentionQuery.trim().toLowerCase();
    return (mentionables ?? [])
      .filter((m) => (q ? m.label.toLowerCase().includes(q) : true))
      .slice(0, 6);
  }, [hasMentions, mentionables, mentionQuery]);

  useEffect(() => {
    setMentionActive(0);
  }, [mentionQuery, mentionOpen]);

  const insertMention = useCallback(
    (m: ComposerMentionTarget) => {
      const ta = textareaRef.current;
      if (!ta) return;
      const tokenLiteral =
        m.kind === "agent" || m.kind === "user" || m.kind === "position"
          ? `@${m.kind}:${m.id}`
          : `@${m.token}`;
      const before = value.slice(0, mentionStart);
      const after = value.slice(ta.selectionStart);
      const next = `${before}${tokenLiteral} ${after}`;
      onChange(next);
      setMentionOpen(false);
      setMentionQuery("");
      setMentionStart(-1);
      requestAnimationFrame(() => {
        const pos = before.length + tokenLiteral.length + 1;
        ta.focus();
        ta.setSelectionRange(pos, pos);
      });
    },
    [value, mentionStart, onChange, textareaRef],
  );

  // ── Drag-drop files ───────────────────────────────────────────────────
  const dragCounter = useRef(0);
  const [, setDragOver] = useState(false);

  // ── Input handlers ────────────────────────────────────────────────────
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      onChange(next);

      const el = e.target;
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 360)}px`;

      const caret = el.selectionStart ?? next.length;
      const before = next.slice(0, caret);

      // Slash palette tracking.
      if (slashEnabled) {
        const slashMatch = before.match(/(?:^|\s)(\/\w*)$/);
        if (slashMatch) {
          setSlashOpen(true);
          setSlashQuery(slashMatch[1].slice(1));
          setSlashActive(0);
        } else if (slashOpen) {
          dismissSlash();
        }
      }

      // Mention tracking.
      if (hasMentions) {
        let start = -1;
        for (let i = caret - 1; i >= 0; i--) {
          const ch = next[i];
          if (ch === "@") {
            start = i;
            break;
          }
          if (/\s/.test(ch)) break;
        }
        if (start >= 0) {
          setMentionOpen(true);
          setMentionStart(start);
          setMentionQuery(next.slice(start + 1, caret));
        } else {
          setMentionOpen(false);
          setMentionStart(-1);
          setMentionQuery("");
        }
      }
    },
    [onChange, slashEnabled, slashOpen, dismissSlash, hasMentions],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // Mention autocomplete owns arrow/Tab/Enter when open.
      if (mentionOpen && filteredMentions.length > 0) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setMentionActive((i) => (i + 1) % filteredMentions.length);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setMentionActive((i) => (i - 1 + filteredMentions.length) % filteredMentions.length);
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          insertMention(filteredMentions[mentionActive]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setMentionOpen(false);
          return;
        }
      }

      // Slash palette owns arrow/Enter/Esc when open.
      if (slashOpen) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashActive((i) => (filteredSlash.length ? (i + 1) % filteredSlash.length : 0));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashActive((i) =>
            filteredSlash.length ? (i - 1 + filteredSlash.length) % filteredSlash.length : 0,
          );
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const cmd = filteredSlash[slashActive];
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

      // Enter sends, ⇧⏎ newline. Canonical chat-shape.
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        pushHistoryAndSend();
        return;
      }

      // History scrollback at top/bottom of textarea.
      if (historyRef.current.length > 0) {
        if (e.key === "ArrowUp" && !e.shiftKey) {
          const el = e.currentTarget;
          if (el.selectionStart === 0 && el.selectionEnd === 0) {
            if (stepHistory(-1)) e.preventDefault();
          }
          return;
        }
        if (e.key === "ArrowDown" && !e.shiftKey) {
          const el = e.currentTarget;
          if (el.selectionStart === value.length && el.selectionEnd === value.length) {
            if (historyIdxRef.current !== null) {
              if (stepHistory(1)) e.preventDefault();
            }
          }
        }
      }
    },
    [
      mentionOpen,
      filteredMentions,
      mentionActive,
      insertMention,
      slashOpen,
      filteredSlash,
      slashActive,
      runSlashCommand,
      dismissSlash,
      pushHistoryAndSend,
      stepHistory,
      value.length,
    ],
  );

  // ── Render ────────────────────────────────────────────────────────────
  const wrapClass = ["asv-composer", `asv-composer--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  const innerClass = `asv-composer-inner${streaming ? " asv-composer-busy" : ""}`;

  const showAttachActions = hasAnyAttachment && onAttachClick;
  const showAttachChips =
    (attachedIdeas && attachedIdeas.length > 0) ||
    !!attachedQuest ||
    (attachedFiles && attachedFiles.length > 0);

  const computedSendLabel = sendLabel ?? (streaming ? "Queue" : "Send");

  return (
    <div className={wrapClass}>
      {/* Hidden file input — mounted only when files are an attachment kind */}
      {hasFiles && onReadFiles && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            if (e.target.files) onReadFiles(e.target.files);
            e.target.value = "";
          }}
        />
      )}

      <div className={innerClass}>
        {/* Slash palette */}
        {slashEnabled && (
          <SlashPalette
            open={slashOpen}
            query={slashQuery}
            commands={filteredSlash}
            activeIndex={slashActive}
            onActiveChange={setSlashActive}
            onRun={runSlashCommand}
            onDismiss={dismissSlash}
          />
        )}

        {/* Mention autocomplete */}
        {hasMentions && mentionOpen && filteredMentions.length > 0 && (
          <div role="listbox" aria-label="Mention a participant" className="asv-mention-list">
            {filteredMentions.map((m, i) => (
              <button
                key={`${m.kind}:${m.id}`}
                type="button"
                className={`asv-mention-item${i === mentionActive ? " active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  insertMention(m);
                }}
              >
                <span className="asv-mention-label">{m.label}</span>
                <span className="asv-mention-kind">{m.kind}</span>
              </button>
            ))}
          </div>
        )}

        <div className="asv-composer-body">
          {/* Attached chips above input */}
          {showAttachChips && (
            <div className="asv-attach-chips">
              {(attachedIdeas ?? []).map((p, i) => (
                <span key={`p-${i}`} className="asv-attach-chip">
                  {p}
                  {setAttachedIdeas && (
                    <ChipClose
                      label={`Remove ${p}`}
                      onClick={() => setAttachedIdeas((prev) => prev.filter((_, j) => j !== i))}
                    />
                  )}
                </span>
              ))}
              {attachedQuest && (
                <span className="asv-attach-chip">
                  {attachedQuest.name}
                  {setAttachedQuest && (
                    <ChipClose
                      label={`Remove ${attachedQuest.name}`}
                      onClick={() => setAttachedQuest(null)}
                    />
                  )}
                </span>
              )}
              {(attachedFiles ?? []).map((f, i) => (
                <span key={`f-${i}`} className="asv-attach-chip">
                  {f.name}
                  {setAttachedFiles && (
                    <ChipClose
                      label={`Remove ${f.name}`}
                      onClick={() => setAttachedFiles((prev) => prev.filter((_, j) => j !== i))}
                    />
                  )}
                </span>
              ))}
            </div>
          )}

          <Textarea
            bare
            ref={textareaRef}
            className="asv-textarea"
            placeholder={streaming && hasAnyAttachment ? "Queue a message..." : placeholder}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={2}
            aria-label="Message body"
            onDrop={(e) => {
              if (onReadFiles && hasFiles && e.dataTransfer.files.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                dragCounter.current = 0;
                setDragOver(false);
                onReadFiles(e.dataTransfer.files);
              }
            }}
          />

          {/* Footer — attach actions left, send right */}
          <div className="asv-composer-footer">
            <div className="asv-attach-row">
              {showAttachActions && hasIdeas && (
                <Tooltip content="Attach idea (Cmd+P)">
                  <IconButton
                    variant="ghost"
                    size="sm"
                    className="asv-attach-btn"
                    onClick={() => onAttachClick("idea")}
                    aria-label="Attach idea"
                  >
                    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                      <path
                        d="M7 2v2M7 10v2M2 7h2M10 7h2M3.8 3.8l1.4 1.4M8.8 8.8l1.4 1.4M10.2 3.8l-1.4 1.4M5.2 8.8l-1.4 1.4"
                        strokeLinecap="round"
                      />
                    </svg>
                  </IconButton>
                </Tooltip>
              )}
              {showAttachActions && hasQuests && (
                <Tooltip content="Attach quest (Cmd+Q)">
                  <IconButton
                    variant="ghost"
                    size="sm"
                    className="asv-attach-btn"
                    onClick={() => onAttachClick("quest")}
                    aria-label="Attach quest"
                  >
                    <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                      <path d="M4 3h8M4 7h8M4 11h6M2 3v0M2 7v0M2 11v0" strokeLinecap="round" />
                    </svg>
                  </IconButton>
                </Tooltip>
              )}
              {hasFiles && onReadFiles && (
                <Tooltip content="Attach file">
                  <IconButton
                    variant="ghost"
                    size="sm"
                    className="asv-attach-btn"
                    onClick={() => fileInputRef.current?.click()}
                    aria-label="Attach file"
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
                </Tooltip>
              )}
            </div>
            <div className="asv-send-stack">
              {extraActions}
              {streaming && onStop && (
                <Tooltip content="Stop execution">
                  <button type="button" className="asv-send busy" onClick={onStop}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                      <rect x="3" y="3" width="10" height="10" rx="2" />
                    </svg>
                    <span className="asv-send-label">Stop</span>
                  </button>
                </Tooltip>
              )}
              {(!streaming || value.trim()) && (
                <Tooltip content={streaming ? "Queue message" : "Send"}>
                  <button
                    type="button"
                    className={`asv-send ${value.trim() ? "ready" : ""}`}
                    onClick={pushHistoryAndSend}
                    disabled={disabled || !value.trim()}
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
                    <span className="asv-send-label">{computedSendLabel}</span>
                  </button>
                </Tooltip>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Kbd ribbon — fades in on focus */}
      {ribbonEnabled && (
        <div className="asv-composer-ribbon">
          {slashEnabled && (
            <span>
              <kbd>/</kbd>&nbsp;commands
            </span>
          )}
          {hasIdeas && (
            <span>
              <kbd>⌘P</kbd>&nbsp;ideas
            </span>
          )}
          {hasQuests && (
            <span>
              <kbd>⌘Q</kbd>&nbsp;quests
            </span>
          )}
          {(historySource?.length ?? 0) > 0 && (
            <span>
              <kbd>↑</kbd>&nbsp;history
            </span>
          )}
          <span>
            <kbd>⇧⏎</kbd>&nbsp;newline
          </span>
        </div>
      )}
    </div>
  );
});

export default Composer;
