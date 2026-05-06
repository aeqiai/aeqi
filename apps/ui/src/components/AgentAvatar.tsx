import BlockAvatar from "./BlockAvatar";

/**
 * Canonical agent-identity avatar. Every surface that renders an
 * agent as a row — topbar crumb, sidebar tree root, agent list items —
 * calls this. One size, one site of truth, no callsite passes a literal.
 *
 * When a real avatar URL is available (agent.avatar field), render it as
 * a circle image. Otherwise fall through to the deterministic block avatar.
 *
 * Child rows in the sidebar tree deliberately render smaller via
 * BlockAvatar(size=16) to encode depth; that's not identity, it's
 * hierarchy.
 */
export const AGENT_AVATAR_SIZE = 18;

export default function AgentAvatar({ name, src }: { name: string; src?: string }) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={{
          width: AGENT_AVATAR_SIZE,
          height: AGENT_AVATAR_SIZE,
          borderRadius: 4,
          objectFit: "cover",
          display: "block",
          flexShrink: 0,
        }}
      />
    );
  }
  return <BlockAvatar name={name} size={AGENT_AVATAR_SIZE} />;
}
