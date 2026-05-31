import type { CSSProperties } from "react";
import CompanyAvatar from "@/components/CompanyAvatar";
import RoleContextCard from "@/components/company/RoleContextCard";
import type { AuthoritySegment, RoleContextOption } from "@/lib/companyRoleContext";
import type { Role, Company } from "@/lib/types";

type CompanyRoleOptionCardVariant = "card" | "map";

interface CompanyRoleOptionCardProps {
  variant?: CompanyRoleOptionCardVariant;
  company: Company;
  role: Role;
  roleContext?: RoleContextOption | null;
  relation?: AuthoritySegment["relation"];
  selected?: boolean;
  activePath?: boolean;
  terminalCount?: number;
  routeCount?: number;
  agentName?: string;
  trustLabel?: string;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onPreview?: (previewing: boolean) => void;
}

export default function CompanyRoleOptionCard({
  variant = "card",
  company,
  role,
  roleContext = null,
  relation,
  selected = false,
  activePath = false,
  terminalCount = 0,
  routeCount = 1,
  agentName,
  trustLabel = "COMPANY",
  className,
  style,
  onClick,
  onDoubleClick,
  onPreview,
}: CompanyRoleOptionCardProps) {
  const classNames = [
    "company-role-option-card",
    `company-role-option-card--${variant}`,
    selected ? "is-selected" : "",
    activePath ? "is-active-path" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={classNames} style={style} aria-label={`${role.title} in ${company.name}`}>
      <header className="company-role-option-card-head">
        <CompanyAvatar
          name={company.name}
          src={company.avatar}
          size={variant === "map" ? 30 : 42}
          className="company-role-option-card-avatar"
        />
        <span className="company-role-option-card-copy">
          <span className="company-role-option-card-kicker">{trustLabel}</span>
          <h3>{company.name}</h3>
        </span>
        <span className="company-role-option-card-stats">
          {terminalCount > 0
            ? `${terminalCount} ${terminalCount === 1 ? "role" : "roles"}`
            : `${routeCount} ${routeCount === 1 ? "path" : "paths"}`}
        </span>
      </header>
      <RoleContextCard
        variant={variant === "map" ? "map" : "card"}
        company={company}
        role={role}
        roleContext={roleContext}
        relation={relation}
        selected={false}
        activePath={false}
        terminalCount={terminalCount}
        routeCount={routeCount}
        agentName={agentName}
        showPathMeta={false}
        titleMode="holder"
        className="company-role-option-card-role"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onPreview={onPreview}
      />
    </article>
  );
}
