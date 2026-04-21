import BlockAvatar from "./BlockAvatar";

/**
 * Canonical agent-identity avatar. Every surface that renders an
 * agent as a row — topbar crumb, sidebar tree root, agent list items —
 * calls this. One size, one site of truth, no callsite passes a literal.
 *
 * Child rows in the sidebar tree deliberately render smaller via
 * BlockAvatar(size=16) to encode depth; that's not identity, it's
 * hierarchy.
 */
export const AGENT_AVATAR_SIZE = 18;

export default function AgentAvatar({ name }: { name: string }) {
  return <BlockAvatar name={name} size={AGENT_AVATAR_SIZE} />;
}
