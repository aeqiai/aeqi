import type { Role } from "@/lib/types";

export interface RoleNodeProps {
  role: Role;
  agentName?: string;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Canonical role tile — used by the org chart and the cards view so the
 * two surfaces share one visual language. Three variants:
 *
 *   agent     — filled accent monogram, agent name beneath title
 *   human     — outline monogram with `H`, "human" sublabel
 *   vacant    — dashed shell, "vacant" sublabel, muted accent
 */
export default function RoleNode({
  role,
  agentName,
  selected = false,
  onClick,
  className,
  style,
}: RoleNodeProps) {
  const occupant = describeOccupant(role, agentName);
  const initials = occupant.label ? initialsFor(occupant.label) : "·";
  const isVacant = role.occupant_kind === "vacant";

  const classNames = [
    "role-node",
    `role-node--${role.occupant_kind}`,
    selected ? "is-selected" : "",
    onClick ? "is-clickable" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      className={classNames}
      onClick={onClick}
      disabled={!onClick}
      style={style}
      aria-label={`${role.title || "Untitled role"} — ${occupant.label}`}
    >
      <span className="role-node-monogram" aria-hidden>
        {isVacant ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor">
            <circle cx="7" cy="5" r="2.4" strokeWidth="1.2" />
            <path d="M2.5 11.5 C3.5 9 10.5 9 11.5 11.5" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        ) : (
          initials
        )}
      </span>
      <span className="role-node-body">
        <span className="role-node-title">{role.title || "Untitled"}</span>
        <span className="role-node-occupant">{occupant.label}</span>
      </span>
    </button>
  );
}

function describeOccupant(role: Role, agentName?: string): { label: string } {
  if (role.occupant_kind === "vacant") return { label: "vacant" };
  if (role.occupant_kind === "agent") {
    return { label: agentName ?? role.occupant_id?.slice(0, 8) ?? "agent" };
  }
  return { label: role.occupant_id ?? "human" };
}

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
