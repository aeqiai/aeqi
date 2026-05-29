import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Bot, Copy, Check, FileText, Landmark, Pencil, Mail } from "lucide-react";
import RoundAvatar from "@/components/RoundAvatar";
import type { Role, RoleEdge, Quest } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import { formatMediumDate } from "@/lib/i18n";

interface RoleInspectorProps {
  role: Role;
  edges: ReadonlyArray<RoleEdge>;
  rolesById: ReadonlyMap<string, Role>;
  trustId: string;
  basePath: string;
  onEdit?: () => void;
}

/**
 * Right-side inspector panel for the Roles surface. Always-rendered;
 * the parent picks a default (viewer's own role, falling back to a
 * founder) so this panel never shows an empty state.
 *
 * Shows: holder + role identifiers, mandate (placeholder until the
 * backend exposes a real field), grants count, explicit graph links,
 * active quests (from the daemon store, filtered by occupant_id),
 * created/updated metadata.
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
  onEdit,
}: RoleInspectorProps) {
  void trustId;
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const entities = useDaemonStore((s) => s.entities);

  const agentNamesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.name);
    return m;
  }, [agents]);

  // Entity name lookup for `occupant_kind === "trust"` holders (a parent
  // holding's TRUST occupying a Director / board seat). Falls back to
  // null when the daemon store hasn't loaded the parent entity into
  // the current viewer's scope.
  const entityNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entities) m.set(e.id, e.name);
    return m;
  }, [entities]);

  // Parent role(s) — who this role explicitly reports to. The canvas may
  // synthesize governance connectors for layout/teaching, but the inspector
  // only presents persisted edges as role facts.
  const parentRoles = useMemo(() => {
    const parents: Role[] = [];
    for (const e of edges) {
      if (e.child_role_id === role.id) {
        const parent = rolesById.get(e.parent_role_id);
        if (parent) parents.push(parent);
      }
    }
    return parents;
  }, [edges, rolesById, role]);

  // Children (delegates) — roles explicitly linked below this one. Keep
  // inferred chart connectors out of the details pane.
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

  // Resolved holder display name OR null when only a raw UUID is
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
    if (role.occupant_kind === "trust" && role.occupant_id) {
      // TRUST-occupied seats (parent holding's TRUST in a Director seat).
      // Resolve to the entity name from the daemon store.
      return entityNameById.get(role.occupant_id) || null;
    }
    return null;
  }, [role, agentNamesById, entityNameById]);

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copy = (value: string, fieldId: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField((cur) => (cur === fieldId ? null : cur)), 1500);
  };

  // Charter idea — the role's mandate document. The role row carries
  // `description_idea_id`; the Mandate section renders the idea as a
  // preview card (name + content excerpt + tags) that links to the
  // canonical idea detail page on click. Falls back to the empty-state
  // placeholder when no charter is linked.
  const charterIdeaId = role.description_idea_id ?? null;
  const [charter, setCharter] = useState<{
    name: string;
    content: string;
    tags: string[];
  } | null>(null);
  useEffect(() => {
    if (!charterIdeaId) {
      setCharter(null);
      return;
    }
    let cancelled = false;
    api
      .getIdeasByIds([charterIdeaId])
      .then((resp) => {
        if (cancelled) return;
        const idea = resp.ideas?.find((i) => i.id === charterIdeaId);
        if (idea) {
          setCharter({
            name: idea.name ?? "",
            content: idea.content ?? "",
            tags: idea.tags ?? [],
          });
        } else {
          setCharter(null);
        }
      })
      .catch(() => {
        if (!cancelled) setCharter(null);
      });
    return () => {
      cancelled = true;
    };
  }, [charterIdeaId]);

  // First-paragraph excerpt — the first ~180 chars, stopped at a
  // sentence boundary when possible. Keeps the preview card compact
  // and readable; full body lives on the idea detail page.
  const charterExcerpt = useMemo(() => {
    if (!charter?.content) return "";
    const text = charter.content.trim().replace(/\s+/g, " ");
    if (text.length <= 180) return text;
    const cut = text.slice(0, 180);
    const lastDot = cut.lastIndexOf(". ");
    return lastDot > 80 ? `${cut.slice(0, lastDot + 1)}` : `${cut}…`;
  }, [charter]);

  const isVacant = role.occupant_kind === "vacant";
  const isHuman = role.occupant_kind === "human";
  const isTrust = role.occupant_kind === "trust";
  const isAgent = role.occupant_kind === "agent";
  const heldByLabel = isHuman
    ? "a human"
    : isTrust
      ? "a TRUST"
      : isAgent
        ? "an agent"
        : "an occupant";
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
        <div className="role-inspector-head-main">
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
            ) : isTrust ? (
              <span className="role-inspector-avatar-trust">
                <Landmark size={28} strokeWidth={1.5} />
              </span>
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
              <p className="role-inspector-holder">Held by {heldByLabel} · see ID below</p>
            )}
            {isVacant && <p className="role-inspector-holder">Seat open</p>}
          </div>
        </div>
      </header>

      <div className="role-inspector-body">
        <Section title="Editable">
          <EditableRow
            label="Role profile"
            title={role.title}
            detail={`${roleTypeLabel.toLowerCase()} role`}
            icon={<Pencil size={14} strokeWidth={1.7} />}
            to={onEdit ? undefined : `${basePath}/roles/${encodeURIComponent(role.id)}/edit`}
            onClick={onEdit}
          />

          <EditableRow
            label="Assignment"
            title={
              isVacant
                ? "Seat open"
                : occupantDisplayName
                  ? occupantDisplayName
                  : `Held by ${heldByLabel}`
            }
            detail={isVacant ? "Invite someone into this role" : "Change the assigned holder"}
            icon={<Mail size={14} strokeWidth={1.7} />}
            to={`${basePath}/roles/${encodeURIComponent(role.id)}/invite`}
          />

          <EditableRow
            label="Mandate"
            title={charter?.name ?? (charterIdeaId ? "Loading charter" : "No mandate defined")}
            detail={charterExcerpt || "Describe what this role can decide, execute, or delegate."}
            icon={<FileText size={14} strokeWidth={1.6} />}
            to={
              charterIdeaId
                ? `${basePath}/ideas/${encodeURIComponent(charterIdeaId)}`
                : `${basePath}/roles/${encodeURIComponent(role.id)}/edit`
            }
          >
            {charter?.tags && charter.tags.length > 0 && (
              <div className="role-inspector-row-tags">
                {charter.tags.slice(0, 4).map((tag) => (
                  <span key={tag} className="role-inspector-row-tag">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </EditableRow>
        </Section>

        <Section title="Reference">
          {!isVacant && role.occupant_id && (
            <ReadOnlyRow label="Holder ID">
              {isTrust ? (
                <Link
                  to={`/trust/${encodeURIComponent(role.occupant_id)}`}
                  className="role-inspector-holder-link"
                  title={`Open ${occupantDisplayName ?? "TRUST"} profile`}
                >
                  {occupantDisplayName && (
                    <>
                      <Landmark size={13} strokeWidth={1.6} aria-hidden />
                      <span>{occupantDisplayName}</span>
                    </>
                  )}
                  <code>{compactAddress(role.occupant_id)}</code>
                </Link>
              ) : (
                <code>{compactAddress(role.occupant_id)}</code>
              )}
              <CopyButton
                copied={copiedField === "holder"}
                onClick={() => copy(role.occupant_id!, "holder")}
              />
            </ReadOnlyRow>
          )}

          <ReadOnlyRow label="Role ID">
            <code>{compactAddress(role.id)}</code>
            <CopyButton copied={copiedField === "roleId"} onClick={() => copy(role.id, "roleId")} />
          </ReadOnlyRow>
        </Section>

        <Section title="Authority">
          <ReadOnlyRow label="Grants">
            <span className="role-inspector-stat">{role.grants.length}</span>
            {role.grants.length > 0 && (
              <span className="role-inspector-meta">
                {role.grants.slice(0, 2).join(" · ")}
                {role.grants.length > 2 ? ` · +${role.grants.length - 2}` : ""}
              </span>
            )}
          </ReadOnlyRow>
        </Section>

        {(parentRoles.length > 0 || childRoles.length > 0 || role.role_type === "director") && (
          <Section title="Role graph">
            {parentRoles.length > 0 && (
              <ReadOnlyRow label="Reports to">
                {parentRoles.slice(0, 3).map((p) => (
                  <Link
                    key={p.id}
                    to={`${basePath}/roles?role=${encodeURIComponent(p.id)}`}
                    className="role-inspector-chip"
                  >
                    {p.title}
                  </Link>
                ))}
                {parentRoles.length > 3 && (
                  <span className="role-inspector-meta">+{parentRoles.length - 3} more</span>
                )}
              </ReadOnlyRow>
            )}

            {parentRoles.length === 0 && role.role_type === "director" && (
              <ReadOnlyRow label="Reports to">
                <span className="role-inspector-meta">Root role</span>
              </ReadOnlyRow>
            )}

            {childRoles.length > 0 && (
              <ReadOnlyRow label="Delegates to">
                {childRoles.slice(0, 3).map((c) => (
                  <Link
                    key={c.id}
                    to={`${basePath}/roles?role=${encodeURIComponent(c.id)}`}
                    className="role-inspector-chip"
                  >
                    {c.title}
                  </Link>
                ))}
                {childRoles.length > 3 && (
                  <span className="role-inspector-meta">+{childRoles.length - 3} more</span>
                )}
              </ReadOnlyRow>
            )}
          </Section>
        )}

        <Section title="Activity">
          {role.occupant_kind === "agent" && activeQuests > 0 && (
            <ReadOnlyRow label="Active quests">
              <Link to={`${basePath}/quests`} className="role-inspector-link">
                {activeQuests}
                <ArrowRight size={12} strokeWidth={1.8} />
              </Link>
            </ReadOnlyRow>
          )}

          <ReadOnlyRow label="Created">
            <span className="role-inspector-meta">{formatMediumDate(role.created_at)}</span>
          </ReadOnlyRow>
        </Section>
      </div>
    </aside>
  );
}

interface SectionProps {
  title: string;
  children?: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <div className="role-inspector-section">
      <p className="role-inspector-section-title">{title}</p>
      {children}
    </div>
  );
}

interface EditableRowProps {
  label: string;
  title: string;
  detail?: string;
  icon: React.ReactNode;
  to?: string;
  onClick?: () => void;
  children?: React.ReactNode;
}

function EditableRow({ label, title, detail, icon, to, onClick, children }: EditableRowProps) {
  const content = (
    <>
      <span className="role-inspector-row-icon" aria-hidden>
        {icon}
      </span>
      <span className="role-inspector-row-copy">
        <span className="role-inspector-row-label">{label}</span>
        <span className="role-inspector-row-title">{title}</span>
        {detail && <span className="role-inspector-row-detail">{detail}</span>}
        {children}
      </span>
      <ArrowRight size={13} strokeWidth={1.8} className="role-inspector-row-arrow" aria-hidden />
    </>
  );

  if (to) {
    return (
      <Link to={to} className="role-inspector-row role-inspector-row--editable">
        {content}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className="role-inspector-row role-inspector-row--editable"
      onClick={onClick}
      data-pill-allowed=""
    >
      {content}
    </button>
  );
}

interface ReadOnlyRowProps {
  label: string;
  children: React.ReactNode;
}

function ReadOnlyRow({ label, children }: ReadOnlyRowProps) {
  return (
    <div className="role-inspector-row role-inspector-row--readonly">
      <span className="role-inspector-row-label">{label}</span>
      <div className="role-inspector-row-value">{children}</div>
    </div>
  );
}

function CopyButton({ copied, onClick }: { copied: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="role-inspector-copy"
      onClick={onClick}
      title={copied ? "Copied" : "Copy ID"}
      data-pill-allowed=""
    >
      {copied ? <Check size={12} strokeWidth={1.8} /> : <Copy size={12} strokeWidth={1.5} />}
    </button>
  );
}

function compactAddress(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
