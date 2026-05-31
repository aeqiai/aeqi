import { ArrowRight, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import CompanyAvatar from "@/components/CompanyAvatar";
import CompanyRoleOptionCard from "@/components/company/CompanyRoleOptionCard";
import type { RoleContextOption } from "@/lib/companyRoleContext";
import type { Role, Company } from "@/lib/types";

export interface OperatingContextMetric {
  label: string;
  value: number | string;
}

interface OperatingContextCardProps {
  variant?: "card" | "inline";
  activeCompany: Company | null;
  activeRole?: Role | null;
  roleContext?: RoleContextOption | null;
  rolesLoading?: boolean;
  metrics?: ReadonlyArray<OperatingContextMetric>;
  latestActivity?: string;
  agentNames?: ReadonlyMap<string, string>;
  onSelectRole?: (role: Role) => void;
  ctaTo?: string;
  ctaLabel?: string | null;
  emptyActionTo?: string;
  emptyActionLabel?: string;
  inlineLabel?: string;
  className?: string;
}

export default function OperatingContextCard({
  variant = "card",
  activeCompany,
  activeRole = null,
  roleContext = null,
  rolesLoading = false,
  metrics = [],
  latestActivity,
  agentNames,
  onSelectRole,
  ctaTo = "/company",
  ctaLabel = "Your Companies",
  emptyActionTo = "/launch",
  emptyActionLabel = "Launch COMPANY",
  inlineLabel = "Current role",
  className,
}: OperatingContextCardProps) {
  const contextCompany = roleContext?.company ?? activeCompany;
  const contextRole = roleContext?.role ?? activeRole;
  const hasFooter = metrics.length > 0 || !!latestActivity;

  if (variant === "inline") {
    return (
      <div
        className={["company-context-active", className].filter(Boolean).join(" ")}
        aria-label="Active role context"
      >
        <span className="company-context-active-avatar" aria-hidden="true">
          <CompanyAvatar name={contextCompany?.name ?? "COMPANY"} size={32} />
        </span>
        <span className="company-context-active-copy">
          <span className="company-context-kicker">{inlineLabel}</span>
          <span className="company-context-active-title">
            {contextCompany && contextRole
              ? `${contextRole.title} in ${contextCompany.name}`
              : contextCompany
                ? `${contextCompany.name} has no role loaded`
                : "Choose a role"}
          </span>
        </span>
      </div>
    );
  }

  if (!contextCompany) {
    return (
      <article
        className={["home-card home-card--context home-card--empty", className]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="home-context-panel" aria-label="Current COMPANY">
          <h2 className="home-context-heading">COMPANY</h2>
          <div className="home-context-empty">
            <span className="home-context-avatar home-context-avatar--ghost" aria-hidden="true">
              <Plus size={26} strokeWidth={1.5} />
            </span>
            <h3 className="home-context-title">No active COMPANY</h3>
            <p className="home-context-line">
              Launch a COMPANY to create a shared workspace for roles, agents, quests, and memory.
            </p>
          </div>
          <Link to={emptyActionTo} className="home-primary-action">
            {emptyActionLabel}
            <ArrowRight size={14} strokeWidth={1.8} />
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article className={["home-card home-card--context", className].filter(Boolean).join(" ")}>
      <section className="home-context-panel" aria-label="Current COMPANY">
        <header className="home-context-head">
          <h2 className="home-context-heading">COMPANY</h2>
          {ctaLabel ? (
            <Link to={ctaTo} className="home-context-cta">
              {ctaLabel}
              <ArrowRight size={14} strokeWidth={1.8} />
            </Link>
          ) : null}
        </header>
        <div
          className="home-context-representation"
          aria-label="Active COMPANY role representation"
        >
          {contextRole ? (
            <CompanyRoleOptionCard
              company={contextCompany}
              role={contextRole}
              roleContext={roleContext}
              trustLabel="Active COMPANY"
              agentName={
                contextRole.occupant_id ? agentNames?.get(contextRole.occupant_id) : undefined
              }
              onClick={() => onSelectRole?.(contextRole)}
              className="home-context-role-card"
            />
          ) : (
            <div className="home-context-role-empty">
              <span className="home-context-kicker">Active COMPANY</span>
              <h3 className="home-context-title">{contextCompany.name}</h3>
              <span className="home-context-role-empty-title">
                {rolesLoading ? "Loading role" : "No active role"}
              </span>
              <span className="home-context-role-empty-copy">
                {rolesLoading
                  ? "Resolving this COMPANY's current holder."
                  : "Create a role to connect authority, agents, and people."}
              </span>
            </div>
          )}
        </div>
        {hasFooter ? (
          <div className="home-context-footer">
            {metrics.length > 0 ? (
              <dl className="home-context-metrics" aria-label="COMPANY activity overview">
                {metrics.map((metric) => (
                  <div key={metric.label}>
                    <dt>{metric.label}</dt>
                    <dd>{metric.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {latestActivity ? (
              <p className="home-context-line">Latest activity: {latestActivity}</p>
            ) : null}
          </div>
        ) : null}
      </section>
    </article>
  );
}
