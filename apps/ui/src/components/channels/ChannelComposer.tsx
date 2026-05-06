import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Textarea } from "@/components/ui";

export interface MentionTarget {
  kind: string;
  id: string;
  label: string;
  /** The token inserted into the body after the `@`. */
  token: string;
}

interface ChannelComposerProps {
  disabled?: boolean;
  mentionables: MentionTarget[];
  onSend: (body: string) => void;
}

/**
 * Plaintext channel composer. Enter sends, Shift+Enter newlines.
 *
 * `@` opens an autocomplete dropdown of the channel's participants. Pick
 * one and the composer inserts a canonical `@agent:<id>` / `@user:<id>`
 * token (matching the parser in `crates/aeqi-orchestrator/src/mentions.rs`)
 * so the orchestrator can resolve the mention without name lookup.
 *
 * No formatting toolbar. No file uploads. Phase 2 swaps this out for the
 * BlockNote editor when the editor primitive lands.
 */
export default function ChannelComposer({ disabled, mentionables, onSend }: ChannelComposerProps) {
  const [body, setBody] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(-1);
  const [activeIdx, setActiveIdx] = useState(0);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const filtered = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    return mentionables.filter((m) => (q ? m.label.toLowerCase().includes(q) : true)).slice(0, 6);
  }, [mentionQuery, mentionables]);

  useEffect(() => {
    setActiveIdx(0);
  }, [mentionQuery, mentionOpen]);

  const flush = () => {
    if (disabled) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setBody("");
    setMentionOpen(false);
  };

  const insertMention = (m: MentionTarget) => {
    const ta = taRef.current;
    if (!ta) return;
    const tokenLiteral =
      m.kind === "agent" || m.kind === "user" || m.kind === "position"
        ? `@${m.kind}:${m.id}`
        : `@${m.token}`;
    const before = body.slice(0, mentionStart);
    const after = body.slice(ta.selectionStart);
    const next = `${before}${tokenLiteral} ${after}`;
    setBody(next);
    setMentionOpen(false);
    setMentionQuery("");
    setMentionStart(-1);
    requestAnimationFrame(() => {
      const pos = before.length + tokenLiteral.length + 1;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  };

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setBody(value);
    const cursor = e.target.selectionStart;
    // Walk back to nearest `@` or whitespace.
    let start = -1;
    for (let i = cursor - 1; i >= 0; i--) {
      const ch = value[i];
      if (ch === "@") {
        start = i;
        break;
      }
      if (/\s/.test(ch)) break;
    }
    if (start >= 0) {
      setMentionOpen(true);
      setMentionStart(start);
      setMentionQuery(value.slice(start + 1, cursor));
    } else {
      setMentionOpen(false);
      setMentionStart(-1);
      setMentionQuery("");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && filtered.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => (i + 1) % filtered.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => (i - 1 + filtered.length) % filtered.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        insertMention(filtered[activeIdx]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionOpen(false);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      flush();
    }
  };

  return (
    <div
      style={{
        position: "relative",
        padding: "var(--space-3) var(--space-4)",
        background: "var(--color-card)",
      }}
    >
      {mentionOpen && filtered.length > 0 && (
        <div
          role="listbox"
          aria-label="Mention a participant"
          style={{
            position: "absolute",
            bottom: "calc(100% - var(--space-2))",
            left: "var(--space-4)",
            right: "var(--space-4)",
            background: "var(--color-card)",
            borderRadius: "var(--radius-2)",
            boxShadow: "var(--shadow-md)",
            maxHeight: 200,
            overflowY: "auto",
            zIndex: 50,
          }}
        >
          {filtered.map((m, i) => (
            <button
              key={`${m.kind}:${m.id}`}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(m);
              }}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "var(--space-2) var(--space-3)",
                background: i === activeIdx ? "var(--color-bg-subtle)" : "transparent",
                border: 0,
                cursor: "pointer",
                fontSize: "var(--font-size-sm)",
                color: "var(--color-text-primary)",
              }}
            >
              <span>{m.label}</span>
              <span
                style={{
                  marginLeft: "var(--space-2)",
                  color: "var(--color-text-muted)",
                  fontSize: "var(--font-size-xs)",
                }}
              >
                {m.kind}
              </span>
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "flex-end" }}>
        <Textarea
          ref={taRef}
          value={body}
          placeholder="Message the channel — @ to mention, Shift+Enter for newline"
          onChange={onChange}
          onKeyDown={onKeyDown}
          disabled={disabled}
          rows={2}
          style={{ flex: 1, resize: "none" }}
        />
        <Button
          variant="primary"
          size="sm"
          type="button"
          onClick={flush}
          disabled={disabled || body.trim().length === 0}
        >
          Send
        </Button>
      </div>
    </div>
  );
}
