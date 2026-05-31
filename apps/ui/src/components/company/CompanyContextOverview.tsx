import { roleTypeLabel, type RoleContextOption } from "@/lib/companyRoleContext";
import type { Company } from "@/lib/types";

interface CompanyContextOverviewProps {
  selected: RoleContextOption | null;
  activeCompany: Company | null;
  holder: string;
  relation: string;
  visibleCount: number;
  totalCount: number;
  trustCount: number;
  publicCompanyCount: number;
}

export default function CompanyContextOverview({
  selected,
  activeCompany,
  holder,
  relation,
  visibleCount,
  totalCount,
  trustCount,
  publicCompanyCount,
}: CompanyContextOverviewProps) {
  const roleLabel = selected ? selected.role.title || roleTypeLabel(selected.role.role_type) : null;
  const overviewCompany = activeCompany ?? selected?.company ?? null;
  const activeCompanyName = overviewCompany?.name ?? "No COMPANY selected";
  const privacyLabel = overviewCompany?.public ? "Public overview" : "Private workspace";

  return (
    <section className="company-context-overview" aria-label="Current role context">
      <div className="company-context-overview-copy">
        <span className="company-context-overview-kicker">COMPANY control surface</span>
        <h2 className="company-context-overview-title">{activeCompanyName}</h2>
        <p>
          {selected
            ? `${roleLabel} is held by ${holder}. ${relation} path is ready to activate for this session.`
            : "Choose a role path below to set the COMPANY context for this session."}
        </p>
        <div className="company-context-overview-chips" aria-label="COMPANY status">
          <span>{privacyLabel}</span>
          <span>{trustCount === 1 ? "1 COMPANY" : `${trustCount} Companies`}</span>
          <span>{publicCompanyCount === 1 ? "1 public" : `${publicCompanyCount} public`}</span>
        </div>
      </div>
      <dl className="company-context-overview-stats">
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
