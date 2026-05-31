import type React from "react";
import { IconButton, Tooltip } from "../ui";

export interface ComposerFooterProps {
  showAttachActions: boolean;
  hasIdeas: boolean;
  hasQuests: boolean;
  hasFiles: boolean;
  onAttachClick?: (kind: "idea" | "quest") => void;
  onReadFiles?: (files: FileList) => void;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  streaming: boolean;
  value: string;
  disabled: boolean;
  computedSendLabel: string;
  extraActions?: React.ReactNode;
  showCommandHints?: boolean;
  slashEnabled?: boolean;
  hasMentions?: boolean;
  hasHistory?: boolean;
  onStop?: () => void;
  onSend: () => void;
}

export default function ComposerFooter({
  showAttachActions,
  hasIdeas,
  hasQuests,
  hasFiles,
  onAttachClick,
  onReadFiles,
  fileInputRef,
  streaming,
  value,
  disabled,
  computedSendLabel,
  extraActions,
  showCommandHints = false,
  slashEnabled = false,
  hasMentions = false,
  hasHistory = false,
  onStop,
  onSend,
}: ComposerFooterProps) {
  return (
    <div className="asv-composer-footer">
      <div className="asv-attach-row">
        {showAttachActions && hasIdeas && onAttachClick && (
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
        {showAttachActions && hasQuests && onAttachClick && (
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
        {showCommandHints && (
          <div className="asv-composer-inline-hints" aria-hidden="true">
            {slashEnabled && (
              <span>
                <kbd>/</kbd> commands
              </span>
            )}
            {hasMentions && (
              <span>
                <kbd>@</kbd> mention
              </span>
            )}
            {hasIdeas && (
              <span>
                <kbd>⌘P</kbd> ideas
              </span>
            )}
            {hasQuests && (
              <span>
                <kbd>⌘Q</kbd> quests
              </span>
            )}
            {hasHistory && (
              <span>
                <kbd>↑</kbd> history
              </span>
            )}
            <span>
              <kbd>⇧⏎</kbd> newline
            </span>
          </div>
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
              onClick={onSend}
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
  );
}
