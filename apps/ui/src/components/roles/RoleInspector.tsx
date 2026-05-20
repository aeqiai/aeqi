import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bot, Copy, Check, Pencil, Mail } from "lucide-react";
import RoundAvatar from "@/components/RoundAvatar";
import type { Role, RoleEdge, Quest } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { formatMediumDate } from "@/lib/i18n";

interface RoleInspectorProps {
  role: Role;
  edges: ReadonlyArray<RoleEdge>;
  rolesById: ReadonlyMap<string, Role>;
  trustId: string;
  basePath: string;
}

/**
 * Right-side inspector panel for the Roles surface. Always-rendered;
 * the parent picks a default (viewer's own role, falling back to a
 * founder) so this panel never shows an empty state.
 *
 * Shows: holder + role identifiers, mandate (placeholder until the
 * backend exposes a real field), reports-to + delegates-to derived
 * from the role edges DAG, grants count, active quests (from the
 * daemon store, filtered by occupant_id), created/updated metadata.
 *
 * Edit / invite affordances are surfaced but route to existing
 * standalone pages (`/roles/<id>/edit`, `/roles/<id>/invite`) rather
 * than opening modals — keeps the inspector composable, lets the
 * existing flows do the actual work.
 */
export default function RoleInspector({
  role,
  edges,
  rolesById,
  trustId,
  basePath,
}: RoleInspectorProps) {
  void trustId;
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];

  const agentNamesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.name);
    return m;
  }, [agents]);

  // Parent role(s) — who this role reports to. Explicit edges first;
  // operators with no explicit parent inherit the implicit governance
  // relation from every director (mirrors the synthesized canvas
  // connectors in RolesChart, so the inspector tells the same story
  // the chart shows). Multiple parents render as "Reports to: A, B".
  const parentRoles = useMemo(() => {
    const parents: Role[] = [];
    for (const e of edges) {
      if (e.child_role_id === role.id) {
        const parent = rolesById.get(e.parent_role_id);
        if (parent) parents.push(parent);
      }
    }
    if (parents.length === 0 && role.role_type === "operational") {
      for (const candidate of rolesById.values()) {
        if (candidate.role_type === "director") parents.push(candidate);
      }
    }
    return parents;
  }, [edges, rolesById, role]);

  // Children (delegates) — every role that points up at this one.
  // Mirror the implicit-edge story: a director with no explicit
  // children but operators in the same TRUST implicitly delegates to
  // each operator.
  const childRoles = useMemo(() => {
    const children: Role[] = [];
    for (const e of edges) {
      if (e.parent_role_id === role.id) {
        const child = rolesById.get(e.child_role_id);
        if (child) children.push(child);
      }
    }
    if (children.length === 0 && role.role_type === "director") {
      for (const candidate of rolesById.values()) {
        if (candidate.role_type === "operational") children.push(candidate);
      }
    }
    return children;
  }, [edges, rolesById, role]);

  // Active quests held by THIS role's occupant when it's an agent.
  // For human-held or vacant roles, this stays 0; quests are agent-
  // owned in the AEQI model.
  const activeQuests = useMemo(() => {
    if (role.occupant_kind !== "agent" || !role.occupant_id) return 0;
    return quests.filter(
      (q) =>
        q.agent_id === role.occupant_id &&
        (q.status === "in_progress" ||
          q.status === "in_review" ||
          q.status === "todo" ||
          q.status === "backlog"),
    ).length;
  }, [quests, role]);

  // Resolved human/agent display name OR null when only a raw UUID is
  // available. The HOLDER chip below already shows the truncated ID;
  // the inspector header line should NOT echo a 36-char UUID as prose.
  // Renders as "Held by …" only when we have a real name.
  const occupantDisplayName = useMemo(() => {
    if (role.occupant_kind === "vacant") return null;
    if (role.occupant_kind === "human") {
      // Real name OR null — never the raw id (which is a UUID/address
      // with no human signal).
      return role.occupant_name || null;
    }
    if (role.occupant_kind === "agent" && role.occupant_id) {
      // Daemon-store name lookup; null if the agent lives outside this
      // trust's runtime scope (cross-trust agent occupants are common).
      return agentNamesById.get(role.occupant_id) || null;
    }
    return null;
  }, [role, agentNamesById]);

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copy = (value: string, fieldId: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField((cur) => (cur === fieldId ? null : cur)), 1500);
  };

  const isVacant = role.occupant_kind === "vacant";
  const isHuman = role.occupant_kind === "human";
  // Role-type label — see RoleNode.pillLabel for why `founder` is NOT
  // a distinct user-facing tier and why "operational" surfaces as
  // "Operator" rather than the adjective form.
  const roleTypeLabel =
    role.role_type === "director"
      ? "DIRECTOR"
      : role.role_type === "advisor"
        ? "ADVISOR"
        : "OPERATOR";
  return (
    <aside className="role-inspector" aria-label="Selected role">
      {/* Header */}
      <header className="role-inspector-head">
        <div
          className={`role-inspector-avatar role-inspector-avatar--${role.occupant_kind}`}
          aria-hidden
        >
          {isVacant ? (
            <span className="role-inspector-avatar-vacant">—</span>
          ) : isHuman ? (
            <RoundAvatar
              name={occupantDisplayName ?? role.title}
              src={role.occupant_avatar_url ?? null}
              size={48}
            />
          ) : (
            <span className="role-inspector-avatar-agent">
              <Bot size={28} strokeWidth={1.5} />
            </span>
          )}
        </div>
        <div className="role-inspector-titles">
          <p className="role-inspector-eyebrow">{roleTypeLabel}</p>
          <h2 className="role-inspector-title">{role.title}</h2>
          {!isVacant && occupantDisplayName && (
            <p className="role-inspector-holder">Held by {occupantDisplayName}</p>
          )}
          {!isVacant && !occupantDisplayName && (
            <p className="role-inspector-holder">
              Held by {isHuman ? "a human" : "an agent"} · see ID below
            </p>
          )}
          {isVacant && <p className="role-inspector-holder">Seat open</p>}
        </div>
      </header>

      {/* Vacant action — primary affordance for an empty seat */}
      {isVacant && (
        <Link
          to={`${basePath}/roles/${encodeURIComponent(role.id)}/invite`}
          className="role-inspector-invite"
        >
          <Mail size={14} strokeWidth={1.6} />
          Invite someone to this role
          <ArrowRight size={14} strokeWidth={1.8} />
        </Link>
      )}

      {/* Body — grouped into Identity / Mandate / Authority / Activity
         sections so a fresh visitor reads top-to-bottom in a clear
         narrative arc (who is this, what can they do, what authority
         do they have, what has happened). Section titles use sentence-
         case bold-muted instead of uppercase eyebrow caps to stay on
         the right side of the design-system editorial-flourish rule. */}
      <div className="role-inspector-body">
        <Section title="Identity">
          {!isVacant && role.occupant_id && (
            <Field label="Holder">
              <code>{compactAddress(role.occupant_id)}</code>
              <button
                type="button"
                className="role-inspector-copy"
                onClick={() => copy(role.occupant_id!, "holder")}
                title={copiedField === "holder" ? "Copied" : "Copy ID"}
              >
                {copiedField === "holder" ? (
                  <Check size={12} strokeWidth={1.8} />
                ) : (
                  <Copy size={12} strokeWidth={1.5} />
                )}
              </button>
            </Field>
          )}

          <Field label="Role ID">
            <code>{compactAddress(role.id)}</code>
            <button
              type="button"
              className="role-inspector-copy"
              onClick={() => copy(role.id, "roleId")}
              title={copiedField === "roleId" ? "Copied" : "Copy ID"}
            >
              {copiedField === "roleId" ? (
                <Check size={12} strokeWidth={1.8} />
              ) : (
                <Copy size={12} strokeWidth={1.5} />
              )}
            </button>
          </Field>
        </Section>

        <Section title="Mandate">
          <Field label="Mandate">
            <span className="role-inspector-mandate">
              {/* Mandate is not yet a stored field on Role — until backend
                  exposes one, surface a placeholder that's honest about it
                  rather than fabricating prose. The edit pencil goes to
                  the existing edit page. */}
              <em className="role-inspector-mandate-empty">
                No mandate defined yet. Describe what this role can decide, execute, or delegate.
              </em>
            </span>
            <Link
              to={`${basePath}/roles/${encodeURIComponent(role.id)}/edit`}
              className="role-inspector-copy"
              title="Edit role"
            >
              <Pencil size={12} strokeWidth={1.6} />
            </Link>
          </Field>
        </Section>

        <Section title="Authority">
          <Field label="Grants">
            <span className="role-inspector-stat">{role.grants.length}</span>
            {role.grants.length > 0 && (
              <span className="role-inspector-meta">
                {role.grants.slice(0, 2).join(" · ")}
                {role.grants.length > 2 ? ` · +${role.grants.length - 2}` : ""}
              </span>
            )}
          </Field>

          {parentRoles.length > 0 && (
            <Field label="Reports to">
              {parentRoles.map((p) => (
                <Link
                  key={p.id}
                  to={`${basePath}/roles?role=${encodeURIComponent(p.id)}`}
                  className="role-inspector-chip"
                >
                  {p.title}
                </Link>
              ))}
            </Field>
          )}

          {/* Top-of-tree directors don't report up; they ARE the apex. */}
          {parentRoles.length === 0 && role.role_type === "director" && (
            <Field label="Authority">
              <span className="role-inspector-meta">Root authority</span>
            </Field>
          )}

          {childRoles.length > 0 && (
            <Field label="Delegates to">
              <span className="role-inspector-stat">{childRoles.length}</span>
              <span className="role-inspector-meta">
                {childRoles
                  .slice(0, 2)
                  .map((c) => c.title)
                  .join(" · ")}
                {childRoles.length > 2 ? ` · +${childRoles.length - 2}` : ""}
              </span>
            </Field>
          )}
        </Section>

        <Section title="Activity">
          {role.occupant_kind === "agent" && activeQuests > 0 && (
            <Field label="Active quests">
              <Link to={`${basePath}/quests`} className="role-inspector-link">
                {activeQuests}
                <ArrowRight size={12} strokeWidth={1.8} />
              </Link>
            </Field>
          )}

          <Field label="Created">
            <span className="role-inspector-meta">{formatMediumDate(role.created_at)}</span>
          </Field>
        </Section>
      </div>
    </aside>
  );
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="role-inspector-section">
      <p className="role-inspector-section-title">{title}</p>
      {children}
    </div>
  );
}

interface FieldProps {
  label: string;
  children: React.ReactNode;
}

function Field({ label, children }: FieldProps) {
  return (
    <div className="role-inspector-field">
      <span className="role-inspector-field-label">{label}</span>
      <div className="role-inspector-field-value">{children}</div>
    </div>
  );
}

function compactAddress(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
