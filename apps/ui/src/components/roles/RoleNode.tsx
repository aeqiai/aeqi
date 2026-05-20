import { Bot } from "lucide-react";
import type { Role } from "@/lib/types";
import RoundAvatar from "../RoundAvatar";

export interface RoleNodeProps {
  role: Role;
  agentName?: string;
  /** Avatar URL for an agent occupant (sourced from the daemon store). */
  agentAvatar?: string;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
  /** Ref callback exposed so RolesChart can measure node positions for
   * cross-zone connector geometry (director → operational lines). */
  nodeRef?: (el: HTMLButtonElement | null) => void;
}

const AVATAR_SIZE = 32;

/**
 * Canonical role tile — used by the org chart and the cards view so the
 * two surfaces share one visual language.
 *
 * Avatar render contract by occupant kind:
 *
 *   human   → RoundAvatar (circle photo or hue-tinted initials)
 *   agent   → Bot icon in a rounded-square frame (ALWAYS — agents are
 *             software, not personas; a photo would imply human-likeness
 *             that the AEQI model deliberately doesn't claim)
 *   vacant  → dashed circle silhouette
 *
 * The agent-always-robot rule is intentional. Hash-based identicons and
 * agent profile photos both invite users to anthropomorphise; a literal
 * robot glyph keeps the line between human and software legible at a
 * glance.
 */
export default function RoleNode({
  role,
  agentName,
  agentAvatar,
  selected = false,
  onClick,
  className,
  style,
  nodeRef,
}: RoleNodeProps) {
  const occupant = describeOccupant(role, agentName);
  const isVacant = role.occupant_kind === "vacant";
  const isAgent = role.occupant_kind === "agent";
  const isHuman = role.occupant_kind === "human";
  // agentAvatar URL is intentionally NOT used — see avatar-contract doc
  // comment above. Keeping the prop signature stable for callers.
  void agentAvatar;

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
      ref={nodeRef}
      type="button"
      className={classNames}
      onClick={onClick}
      disabled={!onClick}
      style={style}
      aria-label={`${role.title || "Untitled role"} — ${occupant.label}`}
    >
      <span className="role-node-avatar" aria-hidden>
        {isVacant ? (
          <span className="role-node-avatar-vacant">
            <svg
              width={AVATAR_SIZE - 8}
              height={AVATAR_SIZE - 8}
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
            >
              <circle cx="7" cy="5" r="2.4" strokeWidth="1.2" />
              <path d="M2.5 11.5 C3.5 9 10.5 9 11.5 11.5" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          </span>
        ) : isHuman ? (
          <RoundAvatar
            name={occupant.label}
            src={role.occupant_avatar_url ?? null}
            size={AVATAR_SIZE}
          />
        ) : isAgent ? (
          <span className="role-node-avatar-agent">
            <Bot size={AVATAR_SIZE - 12} strokeWidth={1.6} />
          </span>
        ) : null}
      </span>
      <span className="role-node-body">
        <span className="role-node-title">{role.title || "Untitled"}</span>
        <span className="role-node-occupant">
          {/* "Held by X" makes the relation between role and holder
             explicit — three distinct pieces of info on the card:
             role title (what the seat IS), holder identity (WHO sits
             in it), and role type via the pill (what authority it
             carries). The verb keeps identity visually adjacent to
             the avatar that shows the same person. */}
          {role.occupant_kind === "vacant" ? "Seat open" : <>Held by {occupant.label}</>}
        </span>
      </span>
      <span className={`role-node-pill role-node-pill--${pillTone(role)}`} aria-hidden>
        {pillLabel(role)}
      </span>
    </button>
  );
}

// Role-type label. The `founder` boolean exists in the data model
// (used internally for board / Venture-TRUST equity accounting) but is
// intentionally NOT surfaced as a user-facing label here — board
// members are Directors. If a Venture surface ever needs to distinguish
// founders from other directors, add a separate marker rather than
// hijacking this pill.
//
// "Operational" role_type → "Operator" user-facing label. An Operator
// IS someone who executes; "Operational" sounds like a status. Internal
// role_type values are untouched.
function pillLabel(role: Role): string {
  if (role.role_type === "director") return "Director";
  if (role.role_type === "advisor") return "Advisor";
  return "Operator";
}

function pillTone(role: Role): "director" | "advisor" | "operational" {
  if (role.role_type === "director") return "director";
  if (role.role_type === "advisor") return "advisor";
  return "operational";
}

// Occupant subtitle for the card. Returns a human-readable label
// only — never a raw UUID prefix. When the agent or human name can't
// resolve (cross-trust occupant, missing platform record), fall back
// to a generic "agent" / "human" tag. The card already shows the
// role title above; the subtitle is for occupant identity, and a
// UUID prefix is not identity. Sibling fix to the inspector header
// fallback shipped at cf32cc78.
function describeOccupant(role: Role, agentName?: string): { label: string } {
  if (role.occupant_kind === "vacant") return { label: "vacant" };
  if (role.occupant_kind === "agent") {
    return { label: agentName ?? "agent" };
  }
  if (role.occupant_name) return { label: role.occupant_name };
  return { label: "human" };
}
