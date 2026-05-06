import { useState } from "react";
import type { Role } from "@/lib/types";
import BlockAvatar from "../BlockAvatar";

export interface RoleNodeProps {
  role: Role;
  agentName?: string;
  /** Avatar URL for an agent occupant (sourced from the daemon store). */
  agentAvatar?: string;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Canonical role tile — used by the org chart and the cards view so the
 * two surfaces share one visual language. Three variants:
 *
 *   agent     — deterministic BlockAvatar identicon (or real avatar URL), agent name beneath title
 *   human     — Google profile photo (or initials fallback), "human" sublabel
 *   vacant    — dashed shell, "vacant" sublabel, muted accent
 *
 * Avatar priority:
 *   1. Real URL (occupant_avatar_url for humans, agentAvatar for agents) → img circle
 *   2. Agent occupant fallback → BlockAvatar identicon (matches Agents page)
 *   3. Human occupant fallback → text initials inside the monogram
 *
 * onError on the <img> swaps to the fallback path (initials/identicon)
 * if the image URL is unreachable.
 */
export default function RoleNode({
  role,
  agentName,
  agentAvatar,
  selected = false,
  onClick,
  className,
  style,
}: RoleNodeProps) {
  const occupant = describeOccupant(role, agentName);
  const initials = occupant.label ? initialsFor(occupant.label) : "·";
  const isVacant = role.occupant_kind === "vacant";
  const [imgErrored, setImgErrored] = useState(false);

  // Resolve the avatar URL: human → occupant_avatar_url, agent → agentAvatar prop.
  const avatarUrl =
    role.occupant_kind === "human"
      ? (role.occupant_avatar_url ?? null)
      : role.occupant_kind === "agent"
        ? (agentAvatar ?? null)
        : null;
  const showImage = avatarUrl && !imgErrored;
  const isAgent = role.occupant_kind === "agent";

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
        ) : showImage ? (
          <img
            src={avatarUrl ?? undefined}
            alt=""
            onError={() => setImgErrored(true)}
            style={{
              width: "100%",
              height: "100%",
              borderRadius: isAgent ? 4 : "999px",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : isAgent ? (
          <BlockAvatar name={occupant.label} size={22} />
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
  // Human occupant: prefer platform-resolved display name, fall back to
  // email local-part (if the name looks like one), then truncated id.
  if (role.occupant_name) return { label: role.occupant_name };
  if (role.occupant_id) {
    const id = role.occupant_id;
    return { label: `${id.slice(0, 4)}…${id.slice(-4)}` };
  }
  return { label: "human" };
}

function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "·";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
