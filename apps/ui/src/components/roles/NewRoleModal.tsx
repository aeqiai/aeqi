import { useMemo, useState } from "react";
import { api } from "@/lib/api";
import * as ideasApi from "@/api/ideas";
import { CAPABILITY_CATALOG, DEFAULT_GRANTS } from "@/lib/grants";
import type { Agent, OccupantKind, Role, RoleType } from "@/lib/types";
import { Button, Input, Modal, Select } from "@/components/ui";
import { ROLE_TYPE_OPTIONS } from "./roleOptions";

interface NewRoleModalProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  roles: Role[];
  agents: Agent[];
  onCreated: (role: Role) => void;
}

const KIND_OPTIONS = [
  { value: "vacant", label: "Vacant" },
  { value: "agent", label: "Agent" },
  { value: "human", label: "Human" },
];

/**
 * Modal form for creating a new role inside an entity. Title + kind
 * are always present; occupant is conditional on kind; parent is
 * optional. On success, the parent component refreshes the role graph
 * and selects the created role in the property sheet.
 */
export default function NewRoleModal({
  open,
  onClose,
  companyId,
  roles,
  agents,
  onCreated,
}: NewRoleModalProps) {
  const [title, setTitle] = useState("");
  const [roleType, setRoleType] = useState<RoleType>("operational");
  const [kind, setKind] = useState<OccupantKind>("vacant");
  const [agentId, setAgentId] = useState("");
  const [humanId, setHumanId] = useState("");
  const [parentRoleId, setParentRoleId] = useState("");
  const [grants, setGrants] = useState<string[]>(() => DEFAULT_GRANTS.operational);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scopedAgents = useMemo(
    () => agents.filter((a) => a.company_id === companyId || a.id === companyId),
    [agents, companyId],
  );

  const agentOptions = useMemo(
    () => scopedAgents.map((a) => ({ value: a.id, label: a.name })),
    [scopedAgents],
  );

  const parentOptions = useMemo(
    () => [
      { value: "", label: "None" },
      ...roles.map((p) => ({ value: p.id, label: p.title || "(untitled)" })),
    ],
    [roles],
  );

  const reset = () => {
    setTitle("");
    setRoleType("operational");
    setKind("vacant");
    setAgentId("");
    setHumanId("");
    setParentRoleId("");
    setGrants(DEFAULT_GRANTS.operational);
    setSubmitting(false);
    setError(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleRoleTypeChange = (next: RoleType) => {
    setRoleType(next);
    setGrants(DEFAULT_GRANTS[next]);
  };

  const toggleGrant = (grantId: string, checked: boolean) => {
    setGrants((prev) => (checked ? [...prev, grantId] : prev.filter((id) => id !== grantId)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }

    let occupantId: string | undefined;
    if (kind === "agent") {
      if (!agentId) {
        setError("Select an agent for this role.");
        return;
      }
      occupantId = agentId;
    } else if (kind === "human") {
      const trimmedHuman = humanId.trim();
      if (!trimmedHuman) {
        setError("Enter a user id or email for this role.");
        return;
      }
      occupantId = trimmedHuman;
    }

    setSubmitting(true);
    try {
      const idea = await ideasApi.storeIdea(
        {
          name: trimmedTitle,
          content: "",
          tags: ["role"],
          agent_id: companyId,
          scope: "global",
          kind: "custom:role",
        },
        companyId,
      );
      const resp = await api.createRole({
        company_id: companyId,
        title: trimmedTitle,
        occupant_kind: kind,
        ...(occupantId ? { occupant_id: occupantId } : {}),
        ...(parentRoleId ? { parent_role_id: parentRoleId } : {}),
        role_type: roleType,
        grants,
        description_idea_id: idea.id,
      });
      onCreated(resp.role);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create role.");
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="New role"
      description="Create a company role, choose who owns it, and attach the operating permissions it should carry."
      className="role-inspector-modal role-inspector-modal--wide"
      footer={
        <div className="role-inspector-modal-footer">
          {error && (
            <p className="role-inspector-modal-error" role="alert">
              {error}
            </p>
          )}
          <div className="role-inspector-modal-actions">
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={handleClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              form="new-role-form"
              loading={submitting}
            >
              Create role
            </Button>
          </div>
        </div>
      }
    >
      <form id="new-role-form" className="role-inspector-modal-form" onSubmit={handleSubmit}>
        <label className="role-inspector-modal-field" htmlFor="new-role-title">
          <span>Name</span>
          <Input
            id="new-role-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Head of Engineering"
            autoFocus
          />
        </label>

        <div className="role-inspector-modal-section-label">Role type</div>
        <div className="role-inspector-option-grid" role="radiogroup" aria-label="Role type">
          {ROLE_TYPE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={
                roleType === option.value
                  ? "role-inspector-option role-inspector-option--selected"
                  : "role-inspector-option"
              }
            >
              <input
                type="radio"
                name="new-role-type"
                checked={roleType === option.value}
                onChange={() => handleRoleTypeChange(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.desc}</small>
              </span>
            </label>
          ))}
        </div>

        <label className="role-inspector-modal-field" htmlFor="new-role-kind">
          <span>Assigned to</span>
          <Select
            id="new-role-kind"
            options={KIND_OPTIONS}
            value={kind}
            onChange={(v) => setKind(v as OccupantKind)}
            fullWidth
          />
        </label>

        {kind === "agent" && (
          <label className="role-inspector-modal-field" htmlFor="new-role-agent">
            <span>Agent</span>
            <Select
              id="new-role-agent"
              options={agentOptions}
              value={agentId}
              onChange={setAgentId}
              placeholder={agentOptions.length === 0 ? "No agents in this entity" : "Select agent"}
              disabled={agentOptions.length === 0}
              fullWidth
            />
          </label>
        )}

        {kind === "human" && (
          <label className="role-inspector-modal-field" htmlFor="new-role-human">
            <span>Human</span>
            <Input
              id="new-role-human"
              value={humanId}
              onChange={(e) => setHumanId(e.target.value)}
              placeholder="user id or email"
            />
          </label>
        )}

        <label className="role-inspector-modal-field" htmlFor="new-role-parent">
          <span>Reports to</span>
          <Select
            id="new-role-parent"
            options={parentOptions}
            value={parentRoleId}
            onChange={setParentRoleId}
            fullWidth
          />
        </label>

        <div className="role-inspector-modal-section-label">Permissions</div>
        <div className="role-inspector-grant-grid">
          {CAPABILITY_CATALOG.map((grant) => {
            const checked = grants.includes(grant.id);
            return (
              <label
                key={grant.id}
                className={
                  checked
                    ? "role-inspector-grant-option role-inspector-grant-option--checked"
                    : "role-inspector-grant-option"
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => toggleGrant(grant.id, event.target.checked)}
                />
                <span>
                  <strong>{grant.label}</strong>
                  <small>{grant.desc}</small>
                </span>
              </label>
            );
          })}
        </div>
      </form>
    </Modal>
  );
}
