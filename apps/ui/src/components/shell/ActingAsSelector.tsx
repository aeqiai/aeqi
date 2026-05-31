import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { useUIStore } from "@/store/ui";
import { useActiveEntity } from "@/queries/entities";
import CompanyAvatar from "@/components/CompanyAvatar";
import { Icon } from "@/components/ui";

/**
 * Acting-as selector — the company credential card in the sidebar's COMPANY
 * group. Horizontal flow:
 *
 *   [avatar]  Company Name              ›
 *             DIRECTOR
 *
 * Avatar anchors the left edge (identifies the company), name + role stack
 * in the middle (carries the credential payload), chevron sits centered
 * on the right edge (signals interactivity to switch context).
 *
 * The card is given a small horizontal outer inset so the black panel
 * reads as a deliberately set-back credential — slightly narrower than
 * the nav rows above and below.
 *
 * Click navigates to `/company` where the user can switch contexts.
 *
 * MVP wiring: company = the active entity, role is a stub label until the
 * runtime exposes "current acting role" per (user × company).
 */
export default function ActingAsSelector() {
  const navigate = useNavigate();
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const activeEntity = useActiveEntity(activeEntityId);

  const trustName = activeEntity?.name?.trim() || "Select a COMPANY";
  const roleName = "Director";

  return (
    <button
      type="button"
      className="acting-as-trigger"
      onClick={() => navigate("/company")}
      aria-label={`Switch context · currently ${roleName} at ${trustName}`}
    >
      <span className="acting-as-badge acting-as-badge--expanded" aria-hidden="true">
        <CompanyAvatar name={trustName} size={32} />
      </span>
      <span className="acting-as-badge acting-as-badge--collapsed" aria-hidden="true">
        <CompanyAvatar name={trustName} size={18} />
      </span>
      <span className="acting-as-meta">
        <span className="acting-as-company">{trustName}</span>
        <span className="acting-as-role">{roleName}</span>
      </span>
      <span className="acting-as-chevron" aria-hidden="true">
        <Icon icon={ChevronRight} size="sm" />
      </span>
    </button>
  );
}
