import AgentAvatar from "../AgentAvatar";
import BlockAvatar from "../BlockAvatar";
import RoundAvatar from "../RoundAvatar";
import { parseAssignee, resolveAssigneeDisplay } from "@/lib/assignee";
import type { Agent, User } from "@/lib/types";

/**
 * Polymorphic assignee avatar. Humans and agents are round actor
 * identities; structural roles remain block marks. This component routes the polymorphic
 * `agent:<id>` | `user:<id>` | `role:<id>` string to the right primitive.
 *
 * Roles render as a block avatar (square slot) — they are positions,
 * not principals, and the block silhouette reads as "structural" the
 * same way agents do. Phase-1 doesn't pass a roles dictionary in
 * yet, so the rendered name falls back to the role id (the resolver
 * handles that gracefully). See `assignee.ts` TODO.
 *
 * Unassigned renders a dotted ring placeholder so the assignment slot
 * is always present (the affordance reads "click me to assign", not
 * "this row is half-rendered").
 */
export default function AssigneeAvatar({
  assignee,
  agents,
  users,
  size = 18,
}: {
  assignee: string | null | undefined;
  agents: Pick<Agent, "id" | "name">[];
  users: Pick<User, "id" | "name" | "avatar_url">[];
  size?: number;
}) {
  const identity = parseAssignee(assignee);
  if (!identity) return <UnassignedDot size={size} />;
  const display = resolveAssigneeDisplay(identity, agents, users);
  if (!display) return <UnassignedDot size={size} />;
  if (display.kind === "agent") {
    return <AgentAvatar name={display.name} />;
  }
  if (display.kind === "role") {
    return <BlockAvatar name={display.name} size={size} />;
  }
  return <RoundAvatar name={display.name} size={size} src={display.avatarUrl} />;
}

function UnassignedDot({ size }: { size: number }) {
  // Dotted ring — same diameter as the resolved avatars so the row
  // doesn't shift width on assign/unassign. Stroke at 1px with
  // 2/2 dasharray reads as "placeholder, click to populate" without
  // shouting like a hard outline would.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-label="Unassigned"
      style={{ flexShrink: 0, display: "block" }}
    >
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke="var(--color-text-muted)"
        strokeWidth="1.2"
        strokeDasharray="2 2"
      />
    </svg>
  );
}
