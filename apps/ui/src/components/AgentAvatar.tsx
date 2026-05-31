import { useState } from "react";
import { Bot } from "lucide-react";
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

export default function AgentAvatar({ name, src }: { name: string; src?: string }) {
  const [errored, setErrored] = useState(false);
  if (src && !errored) {
    return <img src={src} alt="" onError={() => setErrored(true)} className={styles.avatar} />;
  }
  return (
    <span className={styles.fallback} aria-hidden="true" title={name}>
      <Bot size={12} strokeWidth={1.75} />
    </span>
  );
}
