import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

  // Parent role(s) — who this role reports to. Explicit edges first;
  // operators with no explicit parent inherit the implicit governance
  // relation from every director (mirrors the synthesized canvas
  // connectors in RolesChart, so the inspector tells the same story
  // the chart shows). The `implicit` flag drives a quieter visual
  // treatment downstream — explicit wiring reads ink, implicit
  // governance reads muted, so the user can tell at a glance which
  // edges are data and which are inferred.
  const parentRoles = useMemo(() => {
    const explicit: Role[] = [];
    for (const e of edges) {
      if (e.child_role_id === role.id) {
        const parent = rolesById.get(e.parent_role_id);
        if (parent) explicit.push(parent);
      }
    }
    if (explicit.length > 0) return { roles: explicit, implicit: false };
    if (role.role_type === "operational") {
      const directors: Role[] = [];
      for (const candidate of rolesById.values()) {
        if (candidate.role_type === "director") directors.push(candidate);
      }
      return { roles: directors, implicit: directors.length > 0 };
    }
    return { roles: [], implicit: false };
  }, [edges, rolesById, role]);

  // Children (delegates) — every role that points down from this one.
  // Mirror the implicit-edge story in RolesChart: a director with no
  // explicit children implicitly delegates only to the APEX operators
  // (operators with no operational parent), not to every operator in
  // the TRUST. Enumerating all 9 operators here was authority fiction —
  // the chart already drew the relationship correctly, the inspector
  // was the one telling a louder story than the data.
  //
  // For directors with PARTIAL wiring (explicit edges to some apex ops,
  // but other apex ops unwired), `implicitChildren` enumerates the
  // synthesized destinations so the "+n implicit" tooltip can name them —
  // the chart fills in those edges as dashed, the inspector tells you
  // who they go to. Mirrors RolesChart.crossEdges per-director synthesis.
  const childRoles = useMemo(() => {
    const explicit: Role[] = [];
    for (const e of edges) {
      if (e.parent_role_id === role.id) {
        const child = rolesById.get(e.child_role_id);
        if (child) explicit.push(child);
      }
    }
    if (role.role_type === "director") {
      // Apex = operational roles with no operational parent. Same
      // definition as RolesChart's governance-edge synthesis.
      const opParentIds = new Set<string>();
      for (const e of edges) {
        const parent = rolesById.get(e.parent_role_id);
        const child = rolesById.get(e.child_role_id);
        if (parent?.role_type === "operational" && child?.role_type === "operational") {
          opParentIds.add(child.id);
        }
      }
      const apex: Role[] = [];
      for (const candidate of rolesById.values()) {
        if (candidate.role_type === "operational" && !opParentIds.has(candidate.id)) {
          apex.push(candidate);
        }
      }
      const explicitIds = new Set(explicit.map((r) => r.id));
      const implicitChildren = apex.filter((r) => !explicitIds.has(r.id));
      if (explicit.length > 0) {
        // Partial-implicit: explicit chips shown, implicit apex ops named
        // in the hint pill's tooltip.
        return {
          children: explicit,
          implicit: false,
          implicitChildren,
        };
      }
      // Fully implicit director — every apex op is synthesized.
      return { children: apex, implicit: apex.length > 0, implicitChildren: [] as Role[] };
    }
    if (explicit.length > 0) {
      return { children: explicit, implicit: false, implicitChildren: [] as Role[] };
    }
    return { children: [], implicit: false, implicitChildren: [] as Role[] };
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
  // Hover flag for the "+n implicit" pill in the "Delegates to" row.
  // When true, the explicit-delegate chips fade to muted and the
  // implicit-destination ghost chips glow into view — so the count's
  // referents are visually identified without leaving the inspector.
  const [hoveringImplicitPill, setHoveringImplicitPill] = useState(false);
  // 200ms hover-out grace mirrors the c11 pattern on `.role-node-edge-hint`
  // in RoleNode.tsx: a quick mouse jitter between the small "+n implicit"
  // pill and the adjacent explicit chips used to strobe the ghost-chip
  // fade — mouseLeave fired as the cursor crossed into a few pixels of
  // padding, dropping `hoveringImplicitPill` for a frame before mouseEnter
  // re-fired. The delay swallows those sub-perceptual gaps; the
  // cancel-on-re-enter guarantees a sustained hover holds the ghosts
  // without a stale clear landing later. Cleared on unmount so an
  // unmounting inspector mid-grace doesn't leave a pending setter.
  const implicitHoverGraceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (implicitHoverGraceRef.current !== null) {
        clearTimeout(implicitHoverGraceRef.current);
        implicitHoverGraceRef.current = null;
      }
    };
  }, []);
  const handleImplicitPillEnter = useCallback(() => {
    if (implicitHoverGraceRef.current !== null) {
      clearTimeout(implicitHoverGraceRef.current);
      implicitHoverGraceRef.current = null;
    }
    setHoveringImplicitPill(true);
  }, []);
  const handleImplicitPillLeave = useCallback(() => {
    if (implicitHoverGraceRef.current !== null) {
      clearTimeout(implicitHoverGraceRef.current);
    }
    implicitHoverGraceRef.current = setTimeout(() => {
      implicitHoverGraceRef.current = null;
      setHoveringImplicitPill(false);
    }, 200);
  }, []);
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
              {isTrust ? (
                <Link
                  to={`/trust/${encodeURIComponent(role.occupant_id)}`}
                  className="role-inspector-holder-link"
                  title={`Open ${occupantDisplayName ?? "TRUST"} profile`}
                >
                  {occupantDisplayName ? (
                    <>
                      <Landmark size={13} strokeWidth={1.6} aria-hidden />
                      <span>{occupantDisplayName}</span>
                      <code>{compactAddress(role.occupant_id)}</code>
                    </>
                  ) : (
                    <code>{compactAddress(role.occupant_id)}</code>
                  )}
                </Link>
              ) : (
                <code>{compactAddress(role.occupant_id)}</code>
              )}
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
          {/* The mandate IS the charter idea linked from the role row.
              Renders as a preview CARD (icon + name + first-paragraph
              excerpt + tag chips) that links to the canonical idea
              detail page on click — edits happen THERE, not inline.
              Keeps the role inspector compositional rather than a
              mini-editor. */}
          {charterIdeaId ? (
            <Link
              to={`${basePath}/ideas/${encodeURIComponent(charterIdeaId)}`}
              className="role-inspector-charter-card"
              title="Open charter idea"
            >
              <div className="role-inspector-charter-card-head">
                <FileText size={14} strokeWidth={1.6} aria-hidden />
                <span className="role-inspector-charter-card-name">
                  {charter?.name ?? "Loading…"}
                </span>
                <ArrowRight
                  size={13}
                  strokeWidth={1.8}
                  className="role-inspector-charter-card-arrow"
                  aria-hidden
                />
              </div>
              {charterExcerpt && (
                <p className="role-inspector-charter-card-excerpt">{charterExcerpt}</p>
              )}
              {charter?.tags && charter.tags.length > 0 && (
                <div className="role-inspector-charter-card-tags">
                  {charter.tags.slice(0, 4).map((tag) => (
                    <span key={tag} className="role-inspector-charter-card-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </Link>
          ) : (
            <Field>
              <span className="role-inspector-mandate">
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
          )}
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

          {parentRoles.roles.length > 0 && (
            <Field label="Reports to">
              {parentRoles.roles.slice(0, 3).map((p) => (
                <Link
                  key={p.id}
                  to={`${basePath}/roles?role=${encodeURIComponent(p.id)}`}
                  className={
                    parentRoles.implicit
                      ? "role-inspector-chip role-inspector-chip--implicit"
                      : "role-inspector-chip"
                  }
                  title={parentRoles.implicit ? "Implicit governance edge" : undefined}
                >
                  {p.title}
                </Link>
              ))}
              {parentRoles.roles.length > 3 && (
                <span className="role-inspector-meta">+{parentRoles.roles.length - 3} more</span>
              )}
              {parentRoles.implicit && (
                <span className="role-inspector-edge-hint" title="No explicit edge wired">
                  implicit
                </span>
              )}
            </Field>
          )}

          {/* Top-of-tree directors don't report up; they ARE the apex.
              "Scope" instead of "Authority" so we don't stack the same
              word twice inside the Authority section. */}
          {parentRoles.roles.length === 0 && role.role_type === "director" && (
            <Field label="Scope">
              <span className="role-inspector-meta">Root authority</span>
            </Field>
          )}

          {childRoles.children.length > 0 && (
            <Field
              label="Delegates to"
              className={hoveringImplicitPill ? "role-inspector-field--implicit-hover" : undefined}
            >
              {/* Chips for visual symmetry with "Reports to". When the
                 underlying edges are IMPLICIT (no explicit wiring on
                 the role row, but the chart synthesizes a director→apex-
                 operator governance edge) the chips get a muted treatment
                 + an "implicit" hint pill — explicit data reads ink,
                 inferred reads quieter. Apex-only enumeration mirrors
                 RolesChart so the two surfaces tell the same story. */}
              {childRoles.children.slice(0, 3).map((c) => (
                <Link
                  key={c.id}
                  to={`${basePath}/roles?role=${encodeURIComponent(c.id)}`}
                  className={
                    childRoles.implicit
                      ? "role-inspector-chip role-inspector-chip--implicit"
                      : "role-inspector-chip role-inspector-chip--explicit"
                  }
                  title={childRoles.implicit ? "Implicit delegation edge" : undefined}
                >
                  {c.title}
                </Link>
              ))}
              {childRoles.children.length > 3 && (
                <span className="role-inspector-meta">+{childRoles.children.length - 3} more</span>
              )}
              {childRoles.implicit && (
                <span className="role-inspector-edge-hint" title="No explicit edge wired">
                  implicit
                </span>
              )}
              {/* Partial-implicit hint — director with some wired chips
                 plus one or more synthesized apex destinations. The
                 chips above stay ink (they're real edges); the pill
                 here names the count. Hover surfaces the implicit
                 destinations as ghost chips inline (rendered below) so
                 the user can identify WHICH apex ops are inferred
                 without leaving the inspector. Distinct from the
                 fully-implicit "implicit" pill above (which paints
                 italic+muted on its own row). */}
              {!childRoles.implicit && childRoles.implicitChildren.length > 0 && (
                <>
                  <span
                    className="role-inspector-edge-hint role-inspector-edge-hint--partial"
                    title={`Also implicitly delegates to ${childRoles.implicitChildren
                      .map((c) => c.title)
                      .join(", ")}`}
                    onMouseEnter={handleImplicitPillEnter}
                    onMouseLeave={handleImplicitPillLeave}
                    onFocus={handleImplicitPillEnter}
                    onBlur={handleImplicitPillLeave}
                    tabIndex={0}
                  >
                    +{childRoles.implicitChildren.length} implicit
                  </span>
                  {/* Ghost chips — kept in the DOM at rest with a
                     compressed/faded treatment so they can glow into
                     view when the partial-implicit pill is hovered.
                     They link to the same role surface as explicit
                     chips; the visual treatment encodes the inferred
                     vs wired distinction. */}
                  {childRoles.implicitChildren.slice(0, 3).map((c) => (
                    <Link
                      key={`ghost-${c.id}`}
                      to={`${basePath}/roles?role=${encodeURIComponent(c.id)}`}
                      className="role-inspector-chip role-inspector-chip--ghost"
                      title="Implicit delegation edge"
                      aria-hidden={!hoveringImplicitPill}
                      tabIndex={hoveringImplicitPill ? 0 : -1}
                    >
                      {c.title}
                    </Link>
                  ))}
                  {childRoles.implicitChildren.length > 3 && (
                    <span
                      className="role-inspector-meta role-inspector-meta--ghost"
                      aria-hidden={!hoveringImplicitPill}
                    >
                      +{childRoles.implicitChildren.length - 3} more
                    </span>
                  )}
                </>
              )}
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
  /** Optional label. When omitted, the field renders bare — useful when
   * the section title already names the field (Mandate section's
   * single Mandate field, etc.) so we don't stack the same word twice. */
  label?: string;
  /** Optional extra class applied to the field root — used to drive
   * field-scoped hover states (e.g. fading explicit chips when the
   * partial-implicit pill is hovered). */
  className?: string;
  children: React.ReactNode;
}

function Field({ label, className, children }: FieldProps) {
  return (
    <div className={className ? `role-inspector-field ${className}` : "role-inspector-field"}>
      {label && <span className="role-inspector-field-label">{label}</span>}
      <div className="role-inspector-field-value">{children}</div>
    </div>
  );
}

function compactAddress(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
