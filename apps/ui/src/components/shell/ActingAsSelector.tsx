import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import BlockAvatar from "@/components/BlockAvatar";
import { useUIStore } from "@/store/ui";
import { useActiveEntity } from "@/queries/entities";

/**
 * Acting-as selector — the accent block in the sidebar's "Identity"
 * group. Reads as an ID badge: small trust avatar on the left, role +
 * trust name in the middle, right-aligned chevron signalling that the
 * block is clickable.
 *
 *   [avatar]  <Role>            (top line, bolder)
 *             <Trust name>      (bottom line, secondary)        [›]
 *
 * Click navigates to `/identity` where the user can switch contexts.
 * Drops the actor name from the block — the actor is already shown
 * in the account block at the top of the rail; only the role and the
 * trust matter for "what am I currently operating as."
 *
 * MVP wiring: trust = the active entity, role is a stub label until
 * the runtime exposes "current acting role" per (user × trust).
 */
export default function ActingAsSelector() {
  const navigate = useNavigate();
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const activeEntity = useActiveEntity(activeEntityId);

  const trustName = activeEntity?.name?.trim() || "Select a trust";
  const roleName = "Director";

  return (
    <button
      type="button"
      className="acting-as-trigger"
      onClick={() => navigate("/identity")}
      aria-label={`Switch context · currently ${roleName} at ${trustName}`}
    >
      <span className="acting-as-avatar" aria-hidden="true">
        <BlockAvatar name={trustName} size={28} />
      </span>
      <span className="acting-as-text">
        <span className="acting-as-role">{roleName}</span>
        <span className="acting-as-trust">{trustName}</span>
      </span>
      <span className="acting-as-chevron" aria-hidden="true">
        <ChevronRight size={14} strokeWidth={2} />
      </span>
    </button>
  );
}
