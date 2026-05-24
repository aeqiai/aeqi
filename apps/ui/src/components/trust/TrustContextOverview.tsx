import { roleTypeLabel, type RoleContextOption } from "@/lib/trustRoleContext";

interface TrustContextOverviewProps {
  selected: RoleContextOption | null;
  holder: string;
  relation: string;
  visibleCount: number;
  totalCount: number;
}

export default function TrustContextOverview({
  selected,
  holder,
  relation,
  visibleCount,
  totalCount,
}: TrustContextOverviewProps) {
  const roleLabel = selected ? selected.role.title || roleTypeLabel(selected.role.role_type) : null;

  return (
    <section className="trust-context-overview" aria-label="Current role context">
      <div className="trust-context-overview-copy">
        <span className="trust-context-overview-kicker">Current context</span>
        <h2 className="trust-context-overview-title">
          {selected ? `${roleLabel} in ${selected.trust.name}` : "No role active"}
        </h2>
        <p>
          {selected
            ? `${roleTypeLabel(selected.role.role_type)} role held by ${holder}. ${relation} path is available to activate.`
            : "Choose a role path below to set the TRUST context for this session."}
        </p>
      </div>
      <dl className="trust-context-overview-stats">
        <div>
          <dt>Visible roles</dt>
          <dd>{visibleCount}</dd>
        </div>
        <div>
          <dt>Total roles</dt>
          <dd>{totalCount}</dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>{selected?.route.length ?? 0}</dd>
        </div>
      </dl>
    </section>
  );
}
