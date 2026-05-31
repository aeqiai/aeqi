import { useState } from "react";
import { api } from "@/lib/api";
import * as ideasApi from "@/api/ideas";
import { DEFAULT_GRANTS } from "@/lib/grants";
import type { Role, RoleType } from "@/lib/types";
import { Button, Input, Modal } from "@/components/ui";
import { ROLE_TYPE_OPTIONS } from "./roleOptions";

interface NewRoleModalProps {
  open: boolean;
  onClose: () => void;
  companyId: string;
  onCreated: (role: Role) => void;
}

/**
 * Modal form for creating a new role inside an entity. Creation stays
 * intentionally small; assignment, reporting, and grants are follow-up
 * edits once the role exists in the chart.
 */
export default function NewRoleModal({ open, onClose, companyId, onCreated }: NewRoleModalProps) {
  const [title, setTitle] = useState("");
  const [roleType, setRoleType] = useState<RoleType>("operational");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setRoleType("operational");
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
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
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
        occupant_kind: "vacant",
        role_type: roleType,
        grants: DEFAULT_GRANTS[roleType],
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
      description="Create the role first. Owner, reporting line, and permissions can be set from the chart after it exists."
      className="role-inspector-modal"
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
      </form>
    </Modal>
  );
}
