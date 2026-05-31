import { useState } from "react";
import { Bot } from "lucide-react";
import type { CSSProperties } from "react";
import styles from "./AgentAvatar.module.css";

/**
 * Canonical agent-identity avatar. Every surface that renders an
 * agent as a row — topbar crumb, sidebar tree root, agent list items —
 * calls this. One size, one site of truth, no callsite passes a literal.
 *
 * When a real avatar URL is available (agent.avatar field), render it as
 * a circular image. Otherwise — or if the image fails to load — fall through
 * to the canonical software glyph. The onError handler ensures broken
 * URLs (404s, network errors) silently degrade to the agent mark
 * instead of showing a broken-image icon.
 */
export const AGENT_AVATAR_SIZE = 18;

export default function AgentAvatar({
  name,
  src,
  size = AGENT_AVATAR_SIZE,
}: {
  name: string;
  src?: string;
  size?: number;
}) {
  const [errored, setErrored] = useState(false);
  const style = { "--agent-avatar-size": `${size}px` } as CSSProperties;
  const iconSize = Math.max(12, Math.round(size * 0.58));
  if (src && !errored) {
    return (
      <img
        src={src}
        alt=""
        onError={() => setErrored(true)}
        className={styles.avatar}
        style={style}
      />
    );
  }
  return (
    <span className={styles.fallback} aria-hidden="true" title={name} style={style}>
      <Bot size={iconSize} strokeWidth={1.75} />
    </span>
  );
}
