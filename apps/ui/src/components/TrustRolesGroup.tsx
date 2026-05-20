import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Users2, Crown, Briefcase, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import type { Role } from "@/lib/types";

interface TrustRolesGroupProps {
  trustId: string;
  basePath: string;
}

/**
 * Roles row — a 4-card row (Roles · Directors · Operators · Vacant)
 * under the trust hero, sitting above the Execution row. Parallels
 * the Execution / Ownership group components so the trust overview
 * reads as three peer tiers: Roles (authority), Execution (runtime
 * activity), Ownership (on-chain state).
 *
 * Each card links into the Roles page; the Vacant card surfaces in
 * the warmth tone when there's an open seat to fill.
 */
export default function TrustRolesGroup({ trustId, basePath }: TrustRolesGroupProps) {
  const [roles, setRoles] = useState<Role[]>([]);

  useEffect(() => {
    let cancelled = false;
    api
      .getRoles(trustId)
      .then((resp) => {
        if (cancelled) return;
        setRoles(resp.roles ?? []);
      })
      .catch(() => {
        if (!cancelled) setRoles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [trustId]);

  let total = 0;
  let directors = 0;
  let operators = 0;
  let vacant = 0;
  for (const r of roles) {
    total += 1;
    if (r.role_type === "director") directors += 1;
    else if (r.role_type === "operational") operators += 1;
    if (r.occupant_kind === "vacant") vacant += 1;
  }

  return (
    <section className="trust-group-cards" aria-label="Roles">
      <PrimitiveCard
        to={`${basePath}/roles`}
        icon={<Users2 size={16} strokeWidth={1.5} />}
        label="Roles"
        value={String(total)}
        hint={total === 1 ? "in this TRUST" : "in this TRUST"}
        sub={total === 0 ? "No roles yet" : ""}
      />
      <PrimitiveCard
        to={`${basePath}/roles?occupant=all&filter=director`}
        icon={<Crown size={16} strokeWidth={1.5} />}
        label="Directors"
        value={String(directors)}
        hint="stewardship"
        sub=""
      />
      <PrimitiveCard
        to={`${basePath}/roles?occupant=all&filter=operator`}
        icon={<Briefcase size={16} strokeWidth={1.5} />}
        label="Operators"
        value={String(operators)}
        hint="execution"
        sub=""
      />
      <PrimitiveCard
        to={`${basePath}/roles?occupant=vacant`}
        icon={<UserPlus size={16} strokeWidth={1.5} />}
        label="Vacant"
        value={String(vacant)}
        hint={vacant === 1 ? "open seat" : "open seats"}
        sub={vacant === 0 && total > 0 ? "All seats filled" : ""}
        tone={vacant > 0 ? "warmth" : undefined}
      />
    </section>
  );
}

interface PrimitiveCardProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  sub: string;
  tone?: "warmth";
}

function PrimitiveCard({ to, icon, label, value, hint, sub, tone }: PrimitiveCardProps) {
  return (
    <Link
      to={to}
      className={`trust-card trust-primitive-card${tone === "warmth" ? " trust-primitive-card--warmth" : ""}`}
    >
      <span className="trust-primitive-icon" aria-hidden>
        {icon}
      </span>
      <span className="trust-primitive-label">{label}</span>
      <span className="trust-primitive-value">
        {value}
        {hint && <span className="trust-primitive-hint"> {hint}</span>}
      </span>
      {sub && <span className="trust-primitive-sub">{sub}</span>}
    </Link>
  );
}
