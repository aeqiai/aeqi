import { type Dispatch, type FormEvent, type SetStateAction } from "react";
import { Input, Modal } from "@/components/ui";
import { CAPABILITY_CATALOG } from "@/lib/grants";
import type { Agent, Idea, OccupantKind, RoleType, Trust } from "@/lib/types";
import {
  AssignmentOption,
  ModalActions,
  ModalError,
  compactAddress,
} from "./RoleInspectorPrimitives";
import { ROLE_TYPE_OPTIONS } from "./roleOptions";

interface ModalBaseProps {
  error: string | null;
  submitting: boolean;
  onClose: () => void;
}

export function RoleNameModal({
  open,
  titleDraft,
  setTitleDraft,
  onSubmit,
  error,
  submitting,
  onClose,
}: ModalBaseProps & {
  open: boolean;
  titleDraft: string;
  setTitleDraft: (next: string) => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title="Name" className="role-inspector-modal">
      <form className="role-inspector-modal-form" onSubmit={onSubmit}>
        <label className="role-inspector-modal-field" htmlFor="role-inspector-name">
          <span>Role name</span>
          <Input
            id="role-inspector-name"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
          />
        </label>
        <ModalError error={error} />
        <ModalActions submitting={submitting} onCancel={onClose} />
      </form>
    </Modal>
  );
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
  trustId,
  assignmentDraft,
  setAssignmentDraft,
  onSubmit,
  error,
  submitting,
  onClose,
}: ModalBaseProps & {
  open: boolean;
  agents: Agent[];
  entities: Trust[];
  trustId: string;
  assignmentDraft: { kind: OccupantKind; id: string };
  setAssignmentDraft: Dispatch<SetStateAction<{ kind: OccupantKind; id: string }>>;
  onSubmit: (event: FormEvent) => void;
}) {
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
          {agents.map((agent) => (
            <AssignmentOption
              name="role-inspector-assignment"
              key={agent.id}
              label={agent.name}
              detail="Agent"
              checked={assignmentDraft.kind === "agent" && assignmentDraft.id === agent.id}
              onChange={() => setAssignmentDraft({ kind: "agent", id: agent.id })}
            />
          ))}
          {entities
            .filter((entity) => entity.id !== trustId)
            .map((entity) => (
              <AssignmentOption
                name="role-inspector-assignment"
                key={entity.id}
                label={entity.name}
                detail="TRUST"
                checked={assignmentDraft.kind === "trust" && assignmentDraft.id === entity.id}
                onChange={() => setAssignmentDraft({ kind: "trust", id: entity.id })}
              />
            ))}
        </div>
        <ModalError error={error} />
        <ModalActions submitting={submitting} onCancel={onClose} />
      </form>
    </Modal>
  );
}

export function RoleMandateModal({
  open,
  ideaQuery,
  setIdeaQuery,
  mandateDraft,
  setMandateDraft,
  ideaOptions,
  onSubmit,
  error,
  submitting,
  onClose,
}: ModalBaseProps & {
  open: boolean;
  ideaQuery: string;
  setIdeaQuery: (next: string) => void;
  mandateDraft: string;
  setMandateDraft: (next: string) => void;
  ideaOptions: Idea[];
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mandate"
      className="role-inspector-modal role-inspector-modal--wide"
    >
      <form className="role-inspector-modal-form" onSubmit={onSubmit}>
        <label className="role-inspector-modal-field" htmlFor="role-inspector-idea-search">
          <span>Find idea</span>
          <Input
            id="role-inspector-idea-search"
            value={ideaQuery}
            onChange={(event) => setIdeaQuery(event.target.value)}
            placeholder="Search ideas"
          />
        </label>
        <div className="role-inspector-option-grid">
          <AssignmentOption
            name="role-inspector-mandate"
            label="No mandate"
            detail="Clear linked idea"
            checked={mandateDraft === ""}
            onChange={() => setMandateDraft("")}
          />
          {ideaOptions.map((idea) => (
            <AssignmentOption
              name="role-inspector-mandate"
              key={idea.id}
              label={idea.name || "Untitled idea"}
              detail={idea.tags?.slice(0, 2).join(" · ") || compactAddress(idea.id)}
              checked={mandateDraft === idea.id}
              onChange={() => setMandateDraft(idea.id)}
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
