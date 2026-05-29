import { type FormEvent, type ReactNode } from "react";
import { Check, ChevronRight, Copy } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import type { Role, RoleType } from "@/lib/types";

export function PropertyGroup({
  title,
  defaultOpen = false,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="role-inspector-group" open={defaultOpen}>
      <summary className="role-inspector-group-title">
        <span className="role-inspector-group-title-label">{title}</span>
        <ChevronRight
          className="role-inspector-group-chevron"
          size={14}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </summary>
      <div className="role-inspector-group-fields">{children}</div>
    </details>
  );
}

export function PropertyRow({
  label,
  title,
  children,
  onClick,
}: {
  label: string;
  title: string;
  children?: ReactNode;
  onClick?: () => void;
}) {
  const value = (
    <>
      {title && <span className="role-inspector-row-title">{title}</span>}
      {children}
    </>
  );

  const content = (
    <>
      <span className="role-inspector-row-label">{label}</span>
      <span className="role-inspector-row-control">{value}</span>
    </>
  );

  if (!onClick) return <div className="role-inspector-row">{content}</div>;
  return (
    <button
      type="button"
      className="role-inspector-row role-inspector-row--editable"
      onClick={onClick}
    >
      {content}
    </button>
  );
}

export function ReadOnlyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="role-inspector-row role-inspector-row--readonly">
      <span className="role-inspector-row-label">{label}</span>
      <div className="role-inspector-row-value">{children}</div>
    </div>
  );
}

export function CopyableRow({
  label,
  title,
  children,
  copied,
  onCopy,
}: {
  label: string;
  title?: string;
  children?: ReactNode;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <button
      type="button"
      className="role-inspector-row role-inspector-row--copyable"
      onClick={onCopy}
      title={copied ? "Copied" : "Copy"}
      data-pill-allowed=""
    >
      <span className="role-inspector-row-label">{label}</span>
      <span className="role-inspector-row-control role-inspector-row-control--recessed">
        <span className="role-inspector-row-title">
          {title}
          {children}
        </span>
        <span className="role-inspector-row-icon" aria-hidden="true">
          {copied ? <Check size={12} strokeWidth={1.8} /> : <Copy size={12} strokeWidth={1.6} />}
        </span>
      </span>
    </button>
  );
}

export function AssignmentOption({
  label,
  detail,
  checked,
  onChange,
  name,
}: {
  label: string;
  detail: string;
  checked: boolean;
  onChange: () => void;
  name: string;
}) {
  return (
    <label
      className={
        checked ? "role-inspector-option role-inspector-option--selected" : "role-inspector-option"
      }
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>
        <strong>{label}</strong>
        <small>{detail}</small>
      </span>
    </label>
  );
}

export function RoleEdgesModal({
  open,
  title,
  roles,
  selected,
  onSelected,
  onClose,
  onSubmit,
  submitting,
  error,
}: {
  open: boolean;
  title: string;
  roles: Role[];
  selected: string[];
  onSelected: (ids: string[]) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
  submitting: boolean;
  error: string | null;
}) {
  const roleOptions = roles.filter(Boolean);

  return (
    <Modal open={open} onClose={onClose} title={title} className="role-inspector-modal">
      <form className="role-inspector-modal-form" onSubmit={onSubmit}>
        <div className="role-inspector-grant-grid">
          {roleOptions.map((role) => {
            const checked = selected.includes(role.id);
            return (
              <label
                key={role.id}
                className={
                  checked
                    ? "role-inspector-grant-option role-inspector-grant-option--checked"
                    : "role-inspector-grant-option"
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) =>
                    onSelected(
                      event.target.checked
                        ? Array.from(new Set([...selected, role.id]))
                        : selected.filter((id) => id !== role.id),
                    )
                  }
                />
                <span>
                  <strong>{role.title}</strong>
                  <small>{labelRoleType(role.role_type)}</small>
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

export function ModalError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="role-inspector-modal-error" role="alert">
      {error}
    </p>
  );
}

export function ModalActions({
  submitting,
  onCancel,
}: {
  submitting: boolean;
  onCancel: () => void;
}) {
  return (
    <footer className="role-inspector-modal-actions">
      <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={submitting}>
        Cancel
      </Button>
      <Button type="submit" variant="primary" size="sm" loading={submitting}>
        Save
      </Button>
    </footer>
  );
}

export function labelRoleType(roleType: RoleType): string {
  if (roleType === "director") return "Director";
  if (roleType === "advisor") return "Advisor";
  if (roleType === "owner") return "Owner";
  return "Operator";
}

export function compactAddress(value: string): string {
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}
