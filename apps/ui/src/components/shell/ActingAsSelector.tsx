import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useUIStore } from "@/store/ui";
import { useActiveEntity } from "@/queries/entities";

/**
 * Acting-as selector — the main accent block in the sidebar's "Network"
 * group. Two-line content + a right-aligned chevron that signals the
 * block is clickable / opens something:
 *
 *   <Role>             (top line, bolder — the relationship)
 *   <Trust name>       (bottom line, secondary — where)
 *                          [chevron →]
 *
 * Click navigates to `/network` where the user picks a different
 * operating context. Drops the actor name from the block — the actor is
 * already shown in the account block at the top of the rail, so
 * repeating it here is redundant; only the role and the trust matter
 * for "what am I currently operating as / inside."
 *
 * MVP wiring: trust = the active entity, role is a stub label until
 * the runtime exposes "current acting role" on a per-user × per-trust
 * basis. Black-accent treatment is intentional — this surface defines
 * the operating context for every scoped panel below it.
 */
export default function ActingAsSelector() {
  const navigate = useNavigate();
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const activeEntity = useActiveEntity(activeEntityId);

  const trustName = activeEntity?.name?.trim() || "Select a trust";
  // TODO: source from runtime when "current acting role" is wired per
  // user × trust. Stub label keeps the visual frame stable.
  const roleName = "Director";

  return (
    <button
      type="button"
      className="acting-as-trigger"
      onClick={() => navigate("/network")}
      aria-label={`Switch context · currently ${roleName} at ${trustName}`}
    >
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
