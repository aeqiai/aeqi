import { Bot, Landmark } from "lucide-react";
import type { CSSProperties } from "react";
import RoundAvatar from "@/components/RoundAvatar";
import CompanyAvatar from "@/components/CompanyAvatar";
import {
  relationLabel,
  roleTypeLabel,
  type AuthoritySegment,
  type RoleContextOption,
} from "@/lib/companyRoleContext";
import type { Role, Company } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";

type RoleContextCardVariant = "card" | "map";
type RoleContextCardTitleMode = "role" | "holder";

interface RoleContextCardProps {
  variant?: RoleContextCardVariant;
  company: Company;
  role: Role;
  roleContext?: RoleContextOption | null;
  relation?: AuthoritySegment["relation"];
  selected?: boolean;
  activePath?: boolean;
  terminalCount?: number;
  routeCount?: number;
  agentName?: string;
  showPathMeta?: boolean;
  titleMode?: RoleContextCardTitleMode;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onPreview?: (previewing: boolean) => void;
}

export default function RoleContextCard({
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
  showPathMeta = true,
  titleMode = "role",
  className,
  style,
  onClick,
  onDoubleClick,
  onPreview,
}: RoleContextCardProps) {
  const terminalRelation = roleContext?.route.at(-1)?.relation ?? relation ?? "direct";
  const terminalRouteCount = roleContext?.routeCount ?? routeCount;
  const terminalStatus = roleContext?.status ?? "available";
  const routeDepth = roleContext?.route.length ?? 1;
  const entities = useDaemonStore((s) => s.entities);
  const trustOccupantName =
    role.occupant_kind === "company" && role.occupant_id
      ? entities.find((entity) => entity.id === role.occupant_id)?.name
      : undefined;
  const occupant = describeOccupant(role, agentName, trustOccupantName);
  const roleLabel = role.title || roleTypeLabel(role.role_type);
  const titleLabel = titleMode === "holder" ? occupant.label : roleLabel;
  const subtitleLabel = titleMode === "holder" ? "" : company.name;
  const classNames = [
    "role-context-card",
    `role-context-card--${variant}`,
    `role-context-card--${titleMode}-title`,
    onClick ? "is-clickable" : "",
    selected ? "is-selected" : "",
    activePath ? "is-active-path" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");
  const label = `${roleLabel} in ${company.name}, held by ${occupant.label}, ${relationLabel(
    terminalRelation,
  )}`;
  const routeLabel =
    terminalStatus === "ambiguous"
      ? `${terminalRouteCount} routes`
      : routeDepth > 1
        ? `${routeDepth} steps`
        : terminalCount > 1
          ? `${terminalCount} routes`
          : "";
  const body = (
    <>
      <span className="role-context-card-head">
        {titleMode === "holder" ? (
          <OccupantAvatar role={role} label={occupant.label} />
        ) : (
          <span className="role-context-card-company-avatar" aria-hidden="true">
            <CompanyAvatar name={company.name} size={variant === "map" ? 28 : 38} />
          </span>
        )}
        <span className="role-context-card-copy">
          {showPathMeta ? (
            <span className="role-context-card-kicker">{relationLabel(terminalRelation)}</span>
          ) : null}
          <span className="role-context-card-title">{titleLabel}</span>
          {subtitleLabel ? (
            <span className="role-context-card-company-name">{subtitleLabel}</span>
          ) : null}
        </span>
        <span className={`role-context-card-pill role-context-card-pill--${role.role_type}`}>
          {roleTypeLabel(role.role_type)}
        </span>
      </span>
      {titleMode === "role" || (showPathMeta && routeLabel) ? (
        <span className="role-context-card-foot">
          {titleMode === "role" ? (
            <span className="role-context-card-holder">
              <OccupantAvatar role={role} label={occupant.label} />
              <span className="role-context-card-holder-label">{occupant.label}</span>
            </span>
          ) : null}
          {showPathMeta && routeLabel ? (
            <span className="role-context-card-route">{routeLabel}</span>
          ) : null}
        </span>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={classNames}
        style={style}
        aria-pressed={selected}
        aria-label={label}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onMouseEnter={() => onPreview?.(true)}
        onMouseLeave={() => onPreview?.(false)}
        onFocus={() => onPreview?.(true)}
        onBlur={() => onPreview?.(false)}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={classNames} style={style} aria-label={label}>
      {body}
    </div>
  );
}

function OccupantAvatar({ role, label }: { role: Role; label: string }) {
  if (role.occupant_kind === "human") {
    return <RoundAvatar name={label} src={role.occupant_avatar_url ?? null} size={24} />;
  }
  if (role.occupant_kind === "agent") {
    return (
      <span className="role-context-card-occupant-avatar role-context-card-occupant-avatar--agent">
        <Bot size={15} strokeWidth={1.6} />
      </span>
    );
  }
  if (role.occupant_kind === "company") {
    return (
      <span className="role-context-card-occupant-avatar role-context-card-occupant-avatar--company">
        <Landmark size={15} strokeWidth={1.6} />
      </span>
    );
  }
  return (
    <span className="role-context-card-occupant-avatar role-context-card-occupant-avatar--vacant" />
  );
}

function describeOccupant(role: Role, agentName?: string, trustName?: string) {
  if (role.occupant_kind === "human") {
    return { label: role.occupant_name || compactId(role.occupant_id) || "Human" };
  }
  if (role.occupant_kind === "agent") {
    return { label: agentName || "Agent" };
  }
  if (role.occupant_kind === "company") {
    return { label: trustName || "COMPANY" };
  }
  return { label: "Vacant" };
}

function compactId(value: string | null) {
  if (!value) return "";
  if (value.length <= 12) return value;
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
