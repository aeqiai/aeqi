import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Users2, Crown, Briefcase, UserPlus } from "lucide-react";
import { api } from "@/lib/api";
import { formatInteger } from "@/lib/i18n";
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
 *
 * Cycle 3 (2026-05-21): the leading Roles tile (total count) now
 * carries a status-dot signal-row footer — directors (verified jade)
 * · operators (progress indigo) · vacant (review warmth) — echoing
 * the Agents/Quests footer pattern shipped in c1+c2 on the Operations
 * card. The breakdown still has its own dedicated tiles to the right,
 * but the signal-row turns the bare total into a glanceable health
 * read in the same dot grammar used across the cockpit.
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
    <section
      className="trust-cockpit-card trust-cockpit-card--roles"
      aria-labelledby="trust-roles-heading"
    >
      <header className="trust-cockpit-card-header">
        <h2 id="trust-roles-heading" className="trust-cockpit-card-title">
          Roles
        </h2>
        <span className="trust-cockpit-card-sub">Authority</span>
      </header>
      <div className="trust-cockpit-inner-grid">
        <PrimitiveCard
          to={`${basePath}/roles`}
          icon={<Users2 size={16} strokeWidth={1.5} />}
          label="Roles"
          value={formatInteger(total)}
          hint="in this TRUST"
          sub={total === 0 ? "No roles yet" : undefined}
          footer={
            total > 0 ? (
              <span className="trust-quest-signals" aria-label="role composition breakdown">
                <span className="trust-quest-signal" title="Directors">
                  <span className="trust-role-dot trust-role-dot--director" aria-hidden />
                  {directors}
                </span>
                <span className="trust-quest-signal" title="Operators">
                  <span className="trust-role-dot trust-role-dot--operator" aria-hidden />
                  {operators}
                </span>
                <span className="trust-quest-signal" title="Vacant">
                  <span className="trust-role-dot trust-role-dot--vacant" aria-hidden />
                  {vacant}
                </span>
              </span>
            ) : undefined
          }
        />
        <PrimitiveCard
          to={`${basePath}/roles?occupant=all&filter=director`}
          icon={<Crown size={16} strokeWidth={1.5} />}
          label="Directors"
          value={formatInteger(directors)}
          hint="stewardship"
        />
        <PrimitiveCard
          to={`${basePath}/roles?occupant=all&filter=operator`}
          icon={<Briefcase size={16} strokeWidth={1.5} />}
          label="Operators"
          value={formatInteger(operators)}
          hint="execution"
        />
        <PrimitiveCard
          to={`${basePath}/roles?occupant=vacant`}
          icon={<UserPlus size={16} strokeWidth={1.5} />}
          label="Vacant"
          value={formatInteger(vacant)}
          hint={vacant === 1 ? "open seat" : "open seats"}
          sub={vacant === 0 && total > 0 ? "All seats filled" : undefined}
          tone={vacant > 0 ? "warmth" : undefined}
        />
      </div>
    </section>
  );
}

interface PrimitiveCardProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  sub?: string;
  tone?: "warmth";
  /** Optional rich footer (e.g. status-dot signal row). Takes precedence over `sub`. */
  footer?: React.ReactNode;
}

function PrimitiveCard({ to, icon, label, value, hint, sub, tone, footer }: PrimitiveCardProps) {
  return (
    <Link
      to={to}
      className={`trust-cockpit-mini${tone === "warmth" ? " trust-cockpit-mini--warmth" : ""}`}
    >
      <span className="trust-primitive-icon" aria-hidden>
        {icon}
      </span>
      <span className="trust-primitive-label">{label}</span>
      <span className="trust-primitive-value">
        {value}
        {hint && <span className="trust-primitive-hint"> {hint}</span>}
      </span>
      {footer ? footer : sub ? <span className="trust-primitive-sub">{sub}</span> : null}
    </Link>
  );
}
