import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Modal } from "@/components/ui";
import { CAPABILITY_CATALOG } from "@/lib/grants";
import type { Agent, OccupantKind, RoleType, Company } from "@/lib/types";
import { AssignmentOption, ModalActions, ModalError } from "./RoleInspectorPrimitives";
import { ROLE_TYPE_OPTIONS } from "./roleOptions";

interface ModalBaseProps {
  error: string | null;
  submitting: boolean;
  onClose: () => void;
}

export function RoleTypeModal({
  open,
  typeDraft,
  setTypeDraft,
  onSubmit,
  error,
  submitting,
  onClose,
}: ModalBaseProps & {
  open: boolean;
  typeDraft: RoleType;
  setTypeDraft: (next: RoleType) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Type" className="role-inspector-modal">
      <form className="role-inspector-modal-form" onSubmit={onSubmit}>
        <div className="role-inspector-option-grid" role="radiogroup" aria-label="Role type">
          {ROLE_TYPE_OPTIONS.map((option) => (
            <label
              key={option.value}
              className={
                typeDraft === option.value
                  ? "role-inspector-option role-inspector-option--selected"
                  : "role-inspector-option"
              }
            >
              <input
                type="radio"
                name="role-inspector-type"
                checked={typeDraft === option.value}
                onChange={() => setTypeDraft(option.value)}
              />
              <span>
                <strong>{option.label}</strong>
                <small>{option.desc}</small>
              </span>
            </label>
          ))}
        </div>
        <ModalError error={error} />
        <ModalActions submitting={submitting} onCancel={onClose} />
      </form>
    </Modal>
  );
}

export function RoleAssignmentModal({
  open,
  agents,
  entities,
  companyId,
  assignmentDraft,
  setAssignmentDraft,
  onSubmit,
  error,
  submitting,
  onClose,
}: ModalBaseProps & {
  open: boolean;
  agents: Agent[];
  entities: Company[];
  companyId: string;
  assignmentDraft: { kind: OccupantKind; id: string };
  setAssignmentDraft: Dispatch<SetStateAction<{ kind: OccupantKind; id: string }>>;
  onSubmit: (event: FormEvent) => void;
}) {
  const agentOptions = agents.filter(Boolean);
  const entityOptions = entities.filter(Boolean);

  return (
    <Modal open={open} onClose={onClose} title="Assigned to" className="role-inspector-modal">
      <form className="role-inspector-modal-form" onSubmit={onSubmit}>
        <div className="role-inspector-option-grid" role="radiogroup" aria-label="Assigned to">
          <AssignmentOption
            name="role-inspector-assignment"
            label="Vacant"
            detail="No active holder"
            checked={assignmentDraft.kind === "vacant"}
            onChange={() => setAssignmentDraft({ kind: "vacant", id: "" })}
          />
          {agentOptions.map((agent) => (
            <AssignmentOption
              name="role-inspector-assignment"
              key={agent.id}
              label={agent.name}
              detail="Agent"
              checked={assignmentDraft.kind === "agent" && assignmentDraft.id === agent.id}
              onChange={() => setAssignmentDraft({ kind: "agent", id: agent.id })}
            />
          ))}
          {entityOptions
            .filter((entity) => entity.id !== companyId)
            .map((entity) => (
              <AssignmentOption
                name="role-inspector-assignment"
                key={entity.id}
                label={entity.name}
                detail="COMPANY"
                checked={assignmentDraft.kind === "company" && assignmentDraft.id === entity.id}
                onChange={() => setAssignmentDraft({ kind: "company", id: entity.id })}
              />
            ))}
        </div>
        <ModalError error={error} />
        <ModalActions submitting={submitting} onCancel={onClose} />
      </form>
    </Modal>
  );
}

export function RoleGrantsModal({
  open,
  grantsDraft,
  toggleGrant,
  onSubmit,
  error,
  submitting,
  onClose,
}: ModalBaseProps & {
  open: boolean;
  grantsDraft: string[];
  toggleGrant: (grantId: string, checked: boolean) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Capabilities"
      className="role-inspector-modal role-inspector-modal--wide"
    >
      <form className="role-inspector-modal-form" onSubmit={onSubmit}>
        <div className="role-inspector-grant-grid">
          {CAPABILITY_CATALOG.map((grant) => {
            const checked = grantsDraft.includes(grant.id);
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
        <ModalError error={error} />
        <ModalActions submitting={submitting} onCancel={onClose} />
      </form>
    </Modal>
  );
}
