import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowRight, Landmark } from "lucide-react";
import type { Idea, OccupantKind, Role, RoleEdge, Quest, RoleType } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import * as ideasApi from "@/api/ideas";
import { formatMediumDate } from "@/lib/i18n";
import IdeaLinksPanel from "../IdeaLinksPanel";
import TagsEditor from "../TagsEditor";
import {
  CopyableRow,
  PropertyGroup,
  PropertyRow,
  ReadOnlyRow,
  RoleEdgesModal,
  compactAddress,
  labelRoleType,
} from "./RoleInspectorPrimitives";
import { RoleAssignmentModal, RoleGrantsModal, RoleTypeModal } from "./RoleInspectorModals";

interface RoleInspectorProps {
  role: Role;
  edges: ReadonlyArray<RoleEdge>;
  rolesById: ReadonlyMap<string, Role>;
  trustId: string;
  basePath: string;
  idea?: Idea | null;
  ideaTagSuggestions?: string[];
  onCopyValue?: (value: string) => void | Promise<void>;
  onIdeaUpdated?: (idea: Idea) => void;
  onRoleUpdated?: (role: Role) => void;
  onEdgesUpdated?: (edges: RoleEdge[]) => void;
  variant?: "panel" | "page";
}

type Editor = "type" | "assignment" | "parents" | "grants";

export default function RoleInspector({
  role,
  edges,
  rolesById,
  trustId,
  basePath,
  idea,
  ideaTagSuggestions = [],
  onCopyValue,
  onIdeaUpdated,
  onRoleUpdated,
  onEdgesUpdated,
  variant = "panel",
}: RoleInspectorProps) {
  const agents = useDaemonStore((s) => s.agents);
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const entities = useDaemonStore((s) => s.entities);

  const agentNamesById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents.filter(Boolean)) m.set(a.id, a.name);
    return m;
  }, [agents]);

  const entityNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of entities.filter(Boolean)) m.set(e.id, e.name);
    return m;
  }, [entities]);

  const parentRoles = useMemo(() => {
    const parents: Role[] = [];
    for (const e of edges.filter(Boolean)) {
      if (e.child_role_id === role.id) {
        const parent = rolesById.get(e.parent_role_id);
        if (parent) parents.push(parent);
      }
    }
    return parents;
  }, [edges, rolesById, role.id]);

  const candidateRoles = useMemo(
    () => Array.from(rolesById.values()).filter((candidate) => candidate.id !== role.id),
    [rolesById, role.id],
  );

  const activeQuests = useMemo(() => {
    if (role.occupant_kind !== "agent" || !role.occupant_id) return 0;
    return quests.filter(
      (q) =>
        q &&
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
  const [typeDraft, setTypeDraft] = useState<RoleType>(role.role_type);
  const [assignmentDraft, setAssignmentDraft] = useState<{
    kind: OccupantKind;
    id: string;
  }>({
    kind: role.occupant_kind,
    id: role.occupant_id ?? "",
  });
  const [parentDraft, setParentDraft] = useState<string[]>(parentRoles.map((r) => r.id));
  const [grantsDraft, setGrantsDraft] = useState<string[]>(role.grants ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideaTagError, setIdeaTagError] = useState<string | null>(null);

  useEffect(() => {
    setTypeDraft(role.role_type);
    setAssignmentDraft({ kind: role.occupant_kind, id: role.occupant_id ?? "" });
    setParentDraft(parentRoles.map((r) => r.id));
    setGrantsDraft(role.grants ?? []);
    setError(null);
    setSubmitting(false);
  }, [role, parentRoles]);

  const copy = (value: string, fieldId: string) => {
    const write = onCopyValue ? onCopyValue(value) : navigator.clipboard.writeText(value);
    void Promise.resolve(write).then(() => {
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField((cur) => (cur === fieldId ? null : cur)), 1500);
    });
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

  const saveParents = async (event: FormEvent) => {
    event.preventDefault();
    await saveEdges({ parent_role_ids: parentDraft }, "Could not update reporting line.");
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

  const updateIdeaTags = async (nextTags: string[]) => {
    if (!idea) return;
    const previous = idea.tags ?? [];
    setIdeaTagError(null);
    onIdeaUpdated?.({ ...idea, tags: nextTags });
    try {
      await ideasApi.updateIdea(idea.id, { tags: nextTags }, trustId);
    } catch (err) {
      onIdeaUpdated?.({ ...idea, tags: previous });
      setIdeaTagError(err instanceof Error ? err.message : "Could not update tags.");
    }
  };

  return (
    <aside className={`role-inspector role-inspector--${variant}`} aria-label="Selected role">
      <header className="role-inspector-topbar">
        <span className="role-inspector-object">Details</span>
      </header>

      <div className="role-inspector-body">
        <PropertyGroup title="Idea" defaultOpen>
          {idea ? (
            <>
              <ReadOnlyRow label="Scope">
                <span className="role-inspector-meta">{formatIdeaScope(idea)}</span>
              </ReadOnlyRow>
              {idea.kind && (
                <ReadOnlyRow label="Kind">
                  <span className="role-inspector-meta">{formatIdeaKind(idea.kind)}</span>
                </ReadOnlyRow>
              )}
              <CopyableRow
                label="Idea ID"
                title={compactAddress(idea.id)}
                copied={copiedField === "ideaId"}
                onCopy={() => copy(idea.id, "ideaId")}
              />
              <div className="role-inspector-field-block">
                <span className="role-inspector-row-label">Tags</span>
                <div className="role-inspector-field-body">
                  <TagsEditor
                    tags={idea.tags ?? []}
                    typed={idea.tags ?? []}
                    suggestions={ideaTagSuggestions}
                    onAdd={(tag) => void updateIdeaTags([...(idea.tags ?? []), tag])}
                    onRemove={(tag) =>
                      void updateIdeaTags((idea.tags ?? []).filter((item) => item !== tag))
                    }
                  />
                  {ideaTagError && <span className="role-inspector-error">{ideaTagError}</span>}
                </div>
              </div>
              <div className="role-inspector-field-block">
                <span className="role-inspector-row-label">References</span>
                <div className="role-inspector-field-body">
                  <IdeaLinksPanel ideaId={idea.id} agentId={idea.agent_id ?? trustId} />
                </div>
              </div>
            </>
          ) : (
            <ReadOnlyRow label="Status">
              <span className="role-inspector-meta">No canonical idea linked</span>
            </ReadOnlyRow>
          )}
        </PropertyGroup>

        <PropertyGroup title="Role" defaultOpen>
          <PropertyRow label="Type" title={roleTypeLabel} onClick={() => openEditor("type")} />
          <PropertyRow
            label="Assigned to"
            title={holderLabel}
            onClick={() => openEditor("assignment")}
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
          {!role.occupant_id ? null : (
            <CopyableRow
              label="Holder ID"
              copied={copiedField === "holder"}
              onCopy={() => copy(role.occupant_id!, "holder")}
            >
              {role.occupant_kind === "trust" && occupantDisplayName ? (
                <>
                  <Landmark size={13} strokeWidth={1.6} aria-hidden />
                  {occupantDisplayName}
                  <span className="role-inspector-row-muted">
                    {compactAddress(role.occupant_id)}
                  </span>
                </>
              ) : (
                compactAddress(role.occupant_id)
              )}
            </CopyableRow>
          )}
          <CopyableRow
            label="Role ID"
            title={compactAddress(role.id)}
            copied={copiedField === "roleId"}
            onCopy={() => copy(role.id, "roleId")}
          />
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
      </div>

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

function formatIdeaScope(idea: Idea): string {
  if (idea.scope === "global" || (!idea.scope && !idea.agent_id)) return "Global";
  if (idea.scope === "siblings") return "Siblings";
  if (idea.scope === "children") return "Children";
  if (idea.scope === "branch") return "Branch";
  return "Self";
}

function formatIdeaKind(kind: string): string {
  if (kind === "note") return "Note";
  if (kind === "file") return "File";
  if (kind === "goal") return "Goal";
  if (kind.startsWith("custom:")) return kind.slice(7) || "Custom";
  return kind;
}
