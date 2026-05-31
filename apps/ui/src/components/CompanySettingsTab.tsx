import { useMemo } from "react";
import { useDaemonStore } from "@/store/daemon";
import CompanyOwnershipTransferControl from "./CompanyOwnershipTransferControl";
import "./CompanySettingsTab.css";

interface CompanySettingsTabProps {
  companyId: string;
}

/**
 * Company-level settings surface. Lives at `/company/<addr>/settings`. Home for
 * irreversible administrative actions on a COMPANY that don't belong inside
 * the day-to-day ownership/governance rails — currently ownership
 * transfer; future tenants: archival, principal rotation, runtime detach.
 */
export default function CompanySettingsTab({ companyId }: CompanySettingsTabProps) {
  const entities = useDaemonStore((s) => s.entities);
  const company = useMemo(() => entities.find((e) => e.id === companyId), [entities, companyId]);
  const companyAddress = company?.company_address ?? null;

  return (
    <div className="company-settings-tab">
      <header className="company-settings-header">
        <h1 className="company-settings-title">Settings</h1>
        <p className="company-settings-subtitle">
          Administrative actions on this COMPANY. Operations here are irreversible — handle with
          intent.
        </p>
      </header>
      <section className="company-settings-section">
        <h2 className="company-settings-section-title">Ownership</h2>
        <CompanyOwnershipTransferControl hasCompanyAddress={!!companyAddress} />
      </section>
    </div>
  );
}
