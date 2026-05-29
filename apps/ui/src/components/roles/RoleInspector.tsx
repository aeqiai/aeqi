import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Landmark, Link2, PanelRightClose } from "lucide-react";
import type { Idea, OccupantKind, Role, RoleEdge, Quest, RoleType } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import { formatMediumDate } from "@/lib/i18n";
import {
  CopyButton,
  PropertyGroup,
  PropertyRow,
  ReadOnlyRow,
  RoleEdgesModal,
  compactAddress,
  labelRoleType,
} from "./RoleInspectorPrimitives";
import {
  RoleAssignmentModal,
  RoleGrantsModal,
  RoleMandateModal,
  RoleNameModal,
  RoleTypeModal,
} from "./RoleInspectorModals";

interface RoleInspectorProps {
  role: Role;
  edges: ReadonlyArray<RoleEdge>;
  rolesById: ReadonlyMap<string, Role>;
  trustId: string;
  basePath: string;
  onCollapse?: () => void;
  onRoleUpdated?: (role: Role) => void;
  onEdgesUpdated?: (edges: RoleEdge[]) => void;
}

type Editor = "name" | "type" | "assignment" | "mandate" | "parents" | "children" | "grants";

export default function RoleInspector({
  role,
  edges,
  rolesById,
  trustId,
  basePath,
  onCollapse,
  onRoleUpdated,
  onEdgesUpdated,
}: RoleInspectorProps) {
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const entities = useDaemonStore((s) => s.entities);

  const agentNamesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.name);
    return m;
  }, [agents]);

  const entityNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entities) m.set(e.id, e.name);
    return m;
  }, [entities]);

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

  const candidateRoles = useMemo(
    () => Array.from(rolesById.values()).filter((candidate) => candidate.id !== role.id),
    [rolesById, role.id],
  );

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
  }, [quests, role.occupant_id, role.occupant_kind]);

  const occupantDisplayName = useMemo(() => {
    if (role.occupant_kind === "vacant") return null;
    if (role.occupant_kind === "human") return role.occupant_name || null;
    if (role.occupant_kind === "agent" && role.occupant_id) {
      return agentNamesById.get(role.occupant_id) || null;
    }
    if (role.occupant_kind === "trust" && role.occupant_id) {
      return entityNameById.get(role.occupant_id) || null;
    }
    return null;
  }, [role, agentNamesById, entityNameById]);

  const roleTypeLabel = labelRoleType(role.role_type);
  const holderLabel =
    role.occupant_kind === "vacant"
      ? "Vacant"
      : occupantDisplayName ||
        (role.occupant_kind === "human"
          ? "Human"
          : role.occupant_kind === "trust"
            ? "TRUST"
            : "Agent");

  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [titleDraft, setTitleDraft] = useState(role.title);
  const [typeDraft, setTypeDraft] = useState<RoleType>(role.role_type);
  const [assignmentDraft, setAssignmentDraft] = useState<{
    kind: OccupantKind;
    id: string;
  }>({
    kind: role.occupant_kind,
    id: role.occupant_id ?? "",
  });
  const [mandateDraft, setMandateDraft] = useState(role.description_idea_id ?? "");
  const [ideaQuery, setIdeaQuery] = useState("");
  const [ideaOptions, setIdeaOptions] = useState<Idea[]>([]);
  const [parentDraft, setParentDraft] = useState<string[]>(parentRoles.map((r) => r.id));
  const [childDraft, setChildDraft] = useState<string[]>(childRoles.map((r) => r.id));
  const [grantsDraft, setGrantsDraft] = useState<string[]>(role.grants ?? []);
  const [charter, setCharter] = useState<Idea | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const charterIdeaId = role.description_idea_id ?? null;

  useEffect(() => {
    setTitleDraft(role.title);
    setTypeDraft(role.role_type);
    setAssignmentDraft({ kind: role.occupant_kind, id: role.occupant_id ?? "" });
    setMandateDraft(role.description_idea_id ?? "");
    setParentDraft(parentRoles.map((r) => r.id));
    setChildDraft(childRoles.map((r) => r.id));
    setGrantsDraft(role.grants ?? []);
    setError(null);
    setSubmitting(false);
  }, [role, parentRoles, childRoles]);

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
        setCharter((resp.ideas?.find((i) => i.id === charterIdeaId) as Idea | undefined) ?? null);
      })
      .catch(() => {
        if (!cancelled) setCharter(null);
      });
    return () => {
      cancelled = true;
    };
  }, [charterIdeaId]);

  useEffect(() => {
    if (editor !== "mandate") return;
    let cancelled = false;
    api
      .getIdeas({ root: trustId, query: ideaQuery, limit: 12 })
      .then((data) => {
        if (cancelled) return;
        setIdeaOptions(((data.ideas as Idea[] | undefined) ?? []) as Idea[]);
      })
      .catch(() => {
        if (!cancelled) setIdeaOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [editor, ideaQuery, trustId]);

  const copy = (value: string, fieldId: string) => {
    navigator.clipboard.writeText(value);
    setCopiedField(fieldId);
    setTimeout(() => setCopiedField((cur) => (cur === fieldId ? null : cur)), 1500);
  };

  const copyRoleLink = () => {
    copy(
      `${window.location.origin}${basePath}/roles?role=${encodeURIComponent(role.id)}`,
      "roleLink",
    );
  };

  const closeEditor = () => {
    if (submitting) return;
    setEditor(null);
    setError(null);
  };

  const openEditor = (next: Editor) => {
    setError(null);
    setEditor(next);
  };

  const saveRolePatch = async (patch: {
    title?: string;
    role_type?: RoleType;
    grants?: string[];
    description_idea_id?: string | null;
  }) => {
    setSubmitting(true);
    setError(null);
    try {
      const resp = await api.updateRole(role.id, patch);
      onRoleUpdated?.(resp.role);
      setEditor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update role.");
    } finally {
      setSubmitting(false);
    }
  };

  const saveName = (event: FormEvent) => {
    event.preventDefault();
    const next = titleDraft.trim();
    if (!next) {
      setError("Name is required.");
      return;
    }
    if (next === role.title) {
      setEditor(null);
      return;
    }
    void saveRolePatch({ title: next });
  };

  const saveType = (event: FormEvent) => {
    event.preventDefault();
    if (typeDraft === role.role_type) {
      setEditor(null);
      return;
    }
    void saveRolePatch({ role_type: typeDraft });
  };

  const saveAssignment = async (event: FormEvent) => {
    event.preventDefault();
    const id = assignmentDraft.kind === "vacant" ? undefined : assignmentDraft.id;
    if (assignmentDraft.kind !== "vacant" && !id) {
      setError("Choose an assignee.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.assignRoleOccupant(role.id, {
        occupant_kind: assignmentDraft.kind,
        ...(id ? { occupant_id: id } : {}),
      });
      const resp = await api.getRole(role.id);
      onRoleUpdated?.(resp.role);
      setEditor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update assignment.");
    } finally {
      setSubmitting(false);
    }
  };

  const saveMandate = (event: FormEvent) => {
    event.preventDefault();
    void saveRolePatch({ description_idea_id: mandateDraft.trim() || null });
  };

  const saveParents = async (event: FormEvent) => {
    event.preventDefault();
    await saveEdges({ parent_role_ids: parentDraft }, "Could not update reporting line.");
  };

  const saveChildren = async (event: FormEvent) => {
    event.preventDefault();
    await saveEdges({ child_role_ids: childDraft }, "Could not update delegate roles.");
  };

  const saveEdges = async (
    patch: { parent_role_ids?: string[]; child_role_ids?: string[] },
    fallback: string,
  ) => {
    setSubmitting(true);
    setError(null);
    try {
      const resp = await api.updateRoleEdges(role.id, patch);
      onRoleUpdated?.(resp.role);
      onEdgesUpdated?.(resp.edges);
      setEditor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setSubmitting(false);
    }
  };

  const saveGrants = (event: FormEvent) => {
    event.preventDefault();
    void saveRolePatch({ grants: grantsDraft });
  };

  const toggleGrant = (grantId: string, checked: boolean) => {
    setGrantsDraft((prev) => (checked ? [...prev, grantId] : prev.filter((g) => g !== grantId)));
  };

  return (
    <aside className="role-inspector" aria-label="Selected role">
      <header className="role-inspector-topbar">
        <span className="role-inspector-object">Role</span>
        <div className="role-inspector-actions" aria-label="Role actions">
          <button
            type="button"
            className="role-inspector-icon-action"
            onClick={copyRoleLink}
            title={copiedField === "roleLink" ? "Copied role link" : "Copy role link"}
            aria-label={copiedField === "roleLink" ? "Copied role link" : "Copy role link"}
            data-pill-allowed=""
          >
            {copiedField === "roleLink" ? (
              <Check size={13} strokeWidth={1.8} />
            ) : (
              <Link2 size={13} strokeWidth={1.7} />
            )}
          </button>
          {onCollapse && (
            <button
              type="button"
              className="role-inspector-icon-action"
              onClick={onCollapse}
              title="Collapse role panel"
              aria-label="Collapse role panel"
              data-pill-allowed=""
            >
              <PanelRightClose size={13} strokeWidth={1.7} />
            </button>
          )}
        </div>
      </header>

      <div className="role-inspector-body">
        <PropertyGroup title="Properties" defaultOpen>
          <PropertyRow label="Name" title={role.title} onClick={() => openEditor("name")} />
          <PropertyRow label="Type" title={roleTypeLabel} onClick={() => openEditor("type")} />
          <PropertyRow
            label="Assigned to"
            title={holderLabel}
            onClick={() => openEditor("assignment")}
          />
          <PropertyRow
            label="Mandate"
            title={charter?.name ?? (charterIdeaId ? "Loading mandate" : "No mandate defined")}
            onClick={() => openEditor("mandate")}
          />
          <PropertyRow
            label="Reports to"
            title={parentRoles.length === 0 && role.role_type === "director" ? "Root role" : ""}
            onClick={() => openEditor("parents")}
          >
            {parentRoles.map((p) => (
              <span key={p.id} className="role-inspector-chip">
                {p.title}
              </span>
            ))}
          </PropertyRow>
          <PropertyRow
            label="Delegates to"
            title={childRoles.length === 0 ? "No delegates" : ""}
            onClick={() => openEditor("children")}
          >
            {childRoles.slice(0, 3).map((c) => (
              <span key={c.id} className="role-inspector-chip">
                {c.title}
              </span>
            ))}
            {childRoles.length > 3 && (
              <span className="role-inspector-meta">+{childRoles.length - 3}</span>
            )}
          </PropertyRow>
          {!role.occupant_id ? null : (
            <ReadOnlyRow label="Holder ID">
              {role.occupant_kind === "trust" ? (
                <a
                  href={`/trust/${encodeURIComponent(role.occupant_id)}`}
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
                </a>
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
        </PropertyGroup>

        <PropertyGroup title="Authority" defaultOpen={role.grants.length > 0}>
          <PropertyRow
            label="Capabilities"
            title={`${role.grants.length} capabilit${role.grants.length === 1 ? "y" : "ies"}`}
            onClick={() => openEditor("grants")}
          />
          {role.grants.length > 0 && (
            <div className="role-inspector-grant-preview">
              {role.grants.slice(0, 4).map((grant) => (
                <span key={grant} className="role-inspector-meta">
                  {grant}
                </span>
              ))}
              {role.grants.length > 4 && (
                <span className="role-inspector-meta">+{role.grants.length - 4}</span>
              )}
            </div>
          )}
        </PropertyGroup>

        <PropertyGroup title="Activity">
          {role.occupant_kind === "agent" && activeQuests > 0 && (
            <ReadOnlyRow label="Active quests">
              <a href={`${basePath}/quests`} className="role-inspector-link">
                {activeQuests}
                <ArrowRight size={12} strokeWidth={1.8} />
              </a>
            </ReadOnlyRow>
          )}
          <ReadOnlyRow label="Created">
            <span className="role-inspector-meta">{formatMediumDate(role.created_at)}</span>
          </ReadOnlyRow>
        </PropertyGroup>
      </div>

      <RoleNameModal
        open={editor === "name"}
        titleDraft={titleDraft}
        setTitleDraft={setTitleDraft}
        onSubmit={saveName}
        error={error}
        submitting={submitting}
        onClose={closeEditor}
      />

      <RoleTypeModal
        open={editor === "type"}
        typeDraft={typeDraft}
        setTypeDraft={setTypeDraft}
        onSubmit={saveType}
        error={error}
        submitting={submitting}
        onClose={closeEditor}
      />

      <RoleAssignmentModal
        open={editor === "assignment"}
        agents={agents}
        entities={entities}
        trustId={trustId}
        assignmentDraft={assignmentDraft}
        setAssignmentDraft={setAssignmentDraft}
        onSubmit={saveAssignment}
        error={error}
        submitting={submitting}
        onClose={closeEditor}
      />

      <RoleMandateModal
        open={editor === "mandate"}
        ideaQuery={ideaQuery}
        setIdeaQuery={setIdeaQuery}
        mandateDraft={mandateDraft}
        setMandateDraft={setMandateDraft}
        ideaOptions={ideaOptions}
        onSubmit={saveMandate}
        error={error}
        submitting={submitting}
        onClose={closeEditor}
      />

      <RoleEdgesModal
        open={editor === "parents"}
        title="Reports to"
        roles={candidateRoles}
        selected={parentDraft}
        onSelected={setParentDraft}
        onClose={closeEditor}
        onSubmit={saveParents}
        submitting={submitting}
        error={error}
      />

      <RoleEdgesModal
        open={editor === "children"}
        title="Delegates to"
        roles={candidateRoles}
        selected={childDraft}
        onSelected={setChildDraft}
        onClose={closeEditor}
        onSubmit={saveChildren}
        submitting={submitting}
        error={error}
      />

      <RoleGrantsModal
        open={editor === "grants"}
        grantsDraft={grantsDraft}
        toggleGrant={toggleGrant}
        onSubmit={saveGrants}
        error={error}
        submitting={submitting}
        onClose={closeEditor}
      />
    </aside>
  );
}
