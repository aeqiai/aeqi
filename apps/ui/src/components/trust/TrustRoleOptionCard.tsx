import type { CSSProperties } from "react";
import TrustAvatar from "@/components/TrustAvatar";
import RoleContextCard from "@/components/trust/RoleContextCard";
import type { AuthoritySegment, RoleContextOption } from "@/lib/trustRoleContext";
import type { Role, Trust } from "@/lib/types";

type TrustRoleOptionCardVariant = "card" | "map";

interface TrustRoleOptionCardProps {
  variant?: TrustRoleOptionCardVariant;
  trust: Trust;
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

export default function TrustRoleOptionCard({
  variant = "card",
  trust,
  role,
  roleContext = null,
  relation,
  selected = false,
  activePath = false,
  terminalCount = 0,
  routeCount = 1,
  agentName,
  trustLabel = "TRUST",
  className,
  style,
  onClick,
  onDoubleClick,
  onPreview,
}: TrustRoleOptionCardProps) {
  const classNames = [
    "trust-role-option-card",
    `trust-role-option-card--${variant}`,
    selected ? "is-selected" : "",
    activePath ? "is-active-path" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article className={classNames} style={style} aria-label={`${role.title} in ${trust.name}`}>
      <header className="trust-role-option-card-head">
        <TrustAvatar
          name={trust.name}
          src={trust.avatar}
          size={variant === "map" ? 30 : 42}
          className="trust-role-option-card-avatar"
        />
        <span className="trust-role-option-card-copy">
          <span className="trust-role-option-card-kicker">{trustLabel}</span>
          <h3>{trust.name}</h3>
        </span>
        <span className="trust-role-option-card-stats">
          {terminalCount > 0
            ? `${terminalCount} ${terminalCount === 1 ? "role" : "roles"}`
            : `${routeCount} ${routeCount === 1 ? "path" : "paths"}`}
        </span>
      </header>
      <RoleContextCard
        variant={variant === "map" ? "map" : "card"}
        trust={trust}
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
        className="trust-role-option-card-role"
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onPreview={onPreview}
      />
    </article>
  );
}
