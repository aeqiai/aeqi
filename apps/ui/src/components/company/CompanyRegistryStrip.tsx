import { useMemo } from "react";
import { ArrowRight, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import CompanyAvatar from "@/components/CompanyAvatar";
import type { RoleContextOption } from "@/lib/companyRoleContext";
import type { Company } from "@/lib/types";

interface CompanyRegistryStripProps {
  companies: Company[];
  activeCompanyId: string | null;
  roleContexts: RoleContextOption[];
  onOpen: (company: Company) => void;
}

export default function CompanyRegistryStrip({
  companies,
  activeCompanyId,
  roleContexts,
  onOpen,
}: CompanyRegistryStripProps) {
  const roleCountByCompanyId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const context of roleContexts) {
      counts.set(context.company.id, (counts.get(context.company.id) ?? 0) + 1);
    }
    return counts;
  }, [roleContexts]);

  if (companies.length === 0) {
    return (
      <div className="company-registry-empty">
        <Sparkles size={16} strokeWidth={1.6} aria-hidden />
        <span>
          Launch your first COMPANY to create a public overview and private operating room.
        </span>
      </div>
    );
  }

  return (
    <div className="company-registry-strip" aria-label="COMPANY registry">
      {companies.slice(0, 6).map((company) => {
        const selected = company.id === activeCompanyId;
        const roleCount = roleCountByCompanyId.get(company.id) ?? 0;
        return (
          <button
            key={company.id}
            type="button"
            className={selected ? "company-registry-card is-active" : "company-registry-card"}
            onClick={() => onOpen(company)}
          >
            <CompanyAvatar
              name={company.name}
              src={company.avatar}
              size={34}
              className="company-registry-avatar"
            />
            <span className="company-registry-copy">
              <span className="company-registry-name">{company.name}</span>
              <span className="company-registry-meta">
                {company.public ? "Public overview" : "Private"} · {roleCount}{" "}
                {roleCount === 1 ? "role" : "roles"}
              </span>
            </span>
            {company.public ? (
              <ShieldCheck size={14} strokeWidth={1.7} aria-hidden />
            ) : (
              <LockKeyhole size={14} strokeWidth={1.7} aria-hidden />
            )}
            <ArrowRight
              className="company-registry-arrow"
              size={14}
              strokeWidth={1.8}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}
