import BlockAvatar from "../BlockAvatar";
import RoundAvatar from "../RoundAvatar";
import { parseAssignee, resolveAssigneeDisplay } from "@/lib/assignee";
import type { Agent, User } from "@/lib/types";

/**
 * Polymorphic assignee avatar. Block (square) for agents, round for
 * humans — the codebase already locked that axis via `AgentAvatar` /
 * `UserAvatar`, this component just routes the polymorphic
 * `agent:<id>` | `user:<id>` string to the right primitive.
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
  return display.kind === "agent" ? (
    <BlockAvatar name={display.name} size={size} />
  ) : (
    <RoundAvatar name={display.name} size={size} src={display.avatarUrl} />
  );
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
        stroke="var(--text-muted)"
        strokeWidth="1.2"
        strokeDasharray="2 2"
      />
    </svg>
  );
}
