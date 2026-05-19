import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useUIStore } from "@/store/ui";
import { useActiveEntity } from "@/queries/entities";
import BlockAvatar from "@/components/BlockAvatar";

/**
 * Acting-as selector — the trust credential card in the sidebar's TRUST
 * group. Horizontal flow:
 *
 *   [avatar]  Trust Name              ›
 *             DIRECTOR
 *
 * Avatar anchors the left edge (identifies the trust), name + role stack
 * in the middle (carries the credential payload), chevron sits centered
 * on the right edge (signals interactivity to switch context).
 *
 * The card is given a small horizontal outer inset so the black panel
 * reads as a deliberately set-back credential — slightly narrower than
 * the nav rows above and below.
 *
 * Click navigates to `/trust` where the user can switch contexts.
 *
 * MVP wiring: trust = the active entity, role is a stub label until the
 * runtime exposes "current acting role" per (user × trust).
 */
export default function ActingAsSelector() {
  const navigate = useNavigate();
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const activeEntity = useActiveEntity(activeEntityId);

  const trustName = activeEntity?.name?.trim() || "Select a TRUST";
  const roleName = "Director";

  return (
    <button
      type="button"
      className="acting-as-trigger"
      onClick={() => navigate("/trust")}
      aria-label={`Switch context · currently ${roleName} at ${trustName}`}
    >
      <span className="acting-as-badge acting-as-badge--expanded" aria-hidden="true">
        <BlockAvatar name={trustName} size={32} />
      </span>
      <span className="acting-as-badge acting-as-badge--collapsed" aria-hidden="true">
        <BlockAvatar name={trustName} size={18} />
      </span>
      <span className="acting-as-meta">
        <span className="acting-as-trust">{trustName}</span>
        <span className="acting-as-role">{roleName}</span>
      </span>
      <span className="acting-as-chevron" aria-hidden="true">
        <ChevronRight size={14} strokeWidth={1.9} />
      </span>
    </button>
  );
}
