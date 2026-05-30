import { roleTypeLabel, type RoleContextOption } from "@/lib/trustRoleContext";
import type { Trust } from "@/lib/types";

interface TrustContextOverviewProps {
  selected: RoleContextOption | null;
  activeTrust: Trust | null;
  holder: string;
  relation: string;
  visibleCount: number;
  totalCount: number;
  trustCount: number;
  publicTrustCount: number;
}

export default function TrustContextOverview({
  selected,
  activeTrust,
  holder,
  relation,
  visibleCount,
  totalCount,
  trustCount,
  publicTrustCount,
}: TrustContextOverviewProps) {
  const roleLabel = selected ? selected.role.title || roleTypeLabel(selected.role.role_type) : null;
  const overviewTrust = activeTrust ?? selected?.trust ?? null;
  const activeTrustName = overviewTrust?.name ?? "No TRUST selected";
  const privacyLabel = overviewTrust?.public ? "Public overview" : "Private workspace";

  return (
    <section className="trust-context-overview" aria-label="Current role context">
      <div className="trust-context-overview-copy">
        <span className="trust-context-overview-kicker">TRUST control surface</span>
        <h2 className="trust-context-overview-title">{activeTrustName}</h2>
        <p>
          {selected
            ? `${roleLabel} is held by ${holder}. ${relation} path is ready to activate for this session.`
            : "Choose a role path below to set the TRUST context for this session."}
        </p>
        <div className="trust-context-overview-chips" aria-label="TRUST status">
          <span>{privacyLabel}</span>
          <span>{trustCount === 1 ? "1 TRUST" : `${trustCount} TRUSTs`}</span>
          <span>{publicTrustCount === 1 ? "1 public" : `${publicTrustCount} public`}</span>
        </div>
      </div>
      <dl className="trust-context-overview-stats">
        <div>
          <dt>Shown</dt>
          <dd>{visibleCount}</dd>
        </div>
        <div>
          <dt>Roles</dt>
          <dd>{totalCount}</dd>
        </div>
        <div>
          <dt>Route depth</dt>
          <dd>{selected?.route.length ?? 0}</dd>
        </div>
      </dl>
    </section>
  );
}
