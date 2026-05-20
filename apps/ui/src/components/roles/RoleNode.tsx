import { useMemo } from "react";
import { Bot, Landmark } from "lucide-react";
import type { Role } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
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
 *   trust   → Landmark icon in an outlined rounded-square frame —
 *             signals a board / director seat held by another entity's
 *             TRUST address (e.g. parent holding's TRUST). The outlined
 *             vs filled distinction keeps board-tier authority visually
 *             distinct from execution-tier (agent).
 *   vacant  → dashed circle silhouette
 *
 * The agent-always-robot rule is intentional. Hash-based identicons and
 * agent profile photos both invite users to anthropomorphise; a literal
 * robot glyph keeps the line between human and software legible at a
 * glance. Same principle for trust seats: institutional iconography
 * instead of any portrait.
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
  // Entity name lookup for `occupant_kind === "trust"` holders (parent
  // holding's TRUST in a Director / board seat). Falls back to "a TRUST"
  // when the entity isn't in the viewer's daemon scope.
  const entities = useDaemonStore((s) => s.entities);
  const entityName = useMemo(() => {
    if (role.occupant_kind !== "trust" || !role.occupant_id) return undefined;
    return entities.find((e) => e.id === role.occupant_id)?.name;
  }, [entities, role.occupant_id, role.occupant_kind]);

  const occupant = describeOccupant(role, agentName, entityName);
  const isVacant = role.occupant_kind === "vacant";
  const isAgent = role.occupant_kind === "agent";
  const isHuman = role.occupant_kind === "human";
  const isTrust = role.occupant_kind === "trust";
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
      {/* Top half — canonical role identity. Title is the primary
         signal (what the seat IS); pill carries the authority tier
         (Director / Operator / Advisor). Both stay with the seat
         even when the occupant rotates. */}
      <span className="role-node-head">
        <span className="role-node-title">{role.title || "Untitled"}</span>
        <span className={`role-node-pill role-node-pill--${pillTone(role)}`} aria-hidden>
          {pillLabel(role)}
        </span>
      </span>
      {/* Bottom half — who currently holds the seat. Skipped entirely
         when vacant (the seat title in the top half already says
         everything; "Seat open" prose + dashed silhouette was visual
         noise on cards that intentionally have no occupant). */}
      {!isVacant && (
        <span className="role-node-foot">
          <span className="role-node-avatar" aria-hidden>
            {isHuman ? (
              <RoundAvatar
                name={occupant.label}
                src={role.occupant_avatar_url ?? null}
                size={AVATAR_SIZE}
              />
            ) : isTrust ? (
              <span className="role-node-avatar-trust">
                <Landmark size={AVATAR_SIZE - 12} strokeWidth={1.6} />
              </span>
            ) : isAgent ? (
              <span className="role-node-avatar-agent">
                <Bot size={AVATAR_SIZE - 12} strokeWidth={1.6} />
              </span>
            ) : null}
          </span>
          <span className="role-node-holder">{occupant.label}</span>
        </span>
      )}
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
// only — never a raw UUID prefix. When the agent / human / trust name
// can't resolve (cross-trust occupant, missing platform record,
// daemon-store not yet hydrated), fall back to a phrase with the
// indefinite article so the card subtitle reads "Held by an agent" /
// "Held by a human" / "Held by a TRUST" — grammatical and matching
// the inspector header copy. Sibling fix to cf32cc78 (no UUID prose)
// and to ae8fe2fe (Held-by prefix).
function describeOccupant(role: Role, agentName?: string, entityName?: string): { label: string } {
  if (role.occupant_kind === "vacant") return { label: "vacant" };
  if (role.occupant_kind === "agent") {
    // Prefer the daemon-store-resolved agent name; fall back to a
    // truncated agent ID rather than the prose "an agent" — the
    // identity matters, the indefinite article doesn't.
    return { label: agentName ?? compactId(role.occupant_id) };
  }
  if (role.occupant_kind === "trust") {
    return { label: entityName ?? compactId(role.occupant_id) };
  }
  if (role.occupant_name) return { label: role.occupant_name };
  return { label: compactId(role.occupant_id) };
}

/** 8…4 truncation for unresolved occupant IDs. Mirrors compactAddress
 *  used by the inspector so both surfaces show the same ID shape. */
function compactId(id: string | null | undefined): string {
  if (!id) return "—";
  if (id.length <= 12) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}
