import { useState } from "react";
import type { Role } from "@/lib/types";
import BlockAvatar from "../BlockAvatar";
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
 * Avatar render contract follows the app-wide rule (UserAvatar / AgentAvatar
 * / BlockAvatar primitives):
 *
 *   human   → RoundAvatar (circle photo, hue-tinted initials fallback)
 *   agent   → block identicon (rounded-square) or rounded-square photo
 *   vacant  → dashed circle silhouette — seat is open, no occupant shape yet
 *
 * `BlockAvatar` is the canonical agent fallback; its default shape is
 * rounded-square so it matches the rest of the app's agent treatment.
 * Don't wrap any of these in a circular monogram — that's the bug the
 * old monogram path was creating (rounded-square inside circle).
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
  const [imgErrored, setImgErrored] = useState(false);

  const agentImageUrl = isAgent && agentAvatar && !imgErrored ? agentAvatar : null;

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
        ) : agentImageUrl ? (
          <img
            src={agentImageUrl}
            alt=""
            onError={() => setImgErrored(true)}
            style={{
              width: AVATAR_SIZE,
              height: AVATAR_SIZE,
              borderRadius: "var(--radius-sm)",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          <BlockAvatar name={occupant.label} size={AVATAR_SIZE} shape="rounded-square" />
        )}
      </span>
      <span className="role-node-body">
        <span className="role-node-title">{role.title || "Untitled"}</span>
        <span className="role-node-occupant">{occupant.label}</span>
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
function pillLabel(role: Role): string {
  if (role.role_type === "director") return "Director";
  if (role.role_type === "advisor") return "Advisor";
  return "Operational";
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
