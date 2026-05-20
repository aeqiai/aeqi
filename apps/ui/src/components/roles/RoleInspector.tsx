import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Copy, Check, Pencil, Mail } from "lucide-react";
import BlockAvatar from "@/components/BlockAvatar";
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

  const agentAvatarsById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) {
      if (a.avatar) m.set(a.id, a.avatar);
    }
    return m;
  }, [agents]);

  // Parent role (who I report to) — first parent edge wins; AEQI roles
  // are a DAG but in practice the org chart has at most one parent per
  // role. Multiple parents would render as "Reports to: A, B".
  const parentRoles = useMemo(() => {
    const parents: Role[] = [];
    for (const e of edges) {
      if (e.child_role_id === role.id) {
        const parent = rolesById.get(e.parent_role_id);
        if (parent) parents.push(parent);
      }
    }
    return parents;
  }, [edges, rolesById, role.id]);

  // Children (delegates) — every role that points up at this one.
  const childRoles = useMemo(() => {
    const children: Role[] = [];
    for (const e of edges) {
      if (e.parent_role_id === role.id) {
        const child = rolesById.get(e.child_role_id);
        if (child) children.push(child);
      }
    }
    return children;
  }, [edges, rolesById, role.id]);

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
  const isAgent = role.occupant_kind === "agent";
  // Role-type label — see RoleNode.pillLabel for why `founder` is NOT
  // a distinct user-facing tier and why "operational" surfaces as
  // "Operator" rather than the adjective form.
  const roleTypeLabel =
    role.role_type === "director"
      ? "DIRECTOR"
      : role.role_type === "advisor"
        ? "ADVISOR"
        : "OPERATOR";
  const agentAvatarUrl =
    isAgent && role.occupant_id ? (agentAvatarsById.get(role.occupant_id) ?? null) : null;

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
          ) : agentAvatarUrl ? (
            <img
              src={agentAvatarUrl}
              alt=""
              style={{
                width: 48,
                height: 48,
                borderRadius: "var(--radius-sm)",
                objectFit: "cover",
                display: "block",
              }}
            />
          ) : (
            <BlockAvatar
              name={occupantDisplayName ?? role.title}
              size={48}
              shape="rounded-square"
            />
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

      {/* Body sections */}
      <div className="role-inspector-body">
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

        <Field label="Mandate">
          <span className="role-inspector-mandate">
            {/* Mandate is not yet a stored field on Role — until backend
                exposes one, surface a placeholder that's honest about it
                rather than fabricating prose. The edit pencil goes to
                the existing edit page which DOES support narrative
                updates today via the grants list. */}
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
      </div>
    </aside>
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
