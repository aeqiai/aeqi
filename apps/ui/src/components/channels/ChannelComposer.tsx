import { useState } from "react";
import Composer, { type ComposerMentionTarget } from "@/components/composer/Composer";

export type MentionTarget = ComposerMentionTarget;

interface ChannelComposerProps {
  disabled?: boolean;
  mentionables: MentionTarget[];
  onSend: (body: string) => void;
}

/**
 * ChannelComposer — thin wrapper around the canonical `<Composer>`
 * primitive that wires the channel's `mentionables` source. `@` opens
 * an autocomplete dropdown of channel participants; selecting one
 * inserts a canonical `@<kind>:<id>` token (matching the parser in
 * `crates/aeqi-orchestrator/src/mentions.rs`).
 *
 * Enter sends, ⇧⏎ newline. Per `architecture_session_primitive.md`
 * channels are sessions like everything else; the composer is the
 * canonical primitive.
 */
export default function ChannelComposer({ disabled, mentionables, onSend }: ChannelComposerProps) {
  const [body, setBody] = useState("");

  const flush = () => {
    if (disabled) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setBody("");
  };

  return (
    <Composer
      variant="card"
      value={body}
      onChange={setBody}
      onSend={flush}
      placeholder="Message the channel — @ to mention, Shift+Enter for newline"
      disabled={disabled}
      mentionables={mentionables}
    />
  );
}
