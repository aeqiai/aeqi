import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { api } from "@/lib/api";
import { GRANT_CATALOG } from "@/lib/grants";
import type { Role, RoleType } from "@/lib/types";
import { Button, Input } from "@/components/ui";

const ROLE_TYPE_OPTIONS: { value: RoleType; label: string; desc: string }[] = [
  { value: "director", label: "Director", desc: "Full authority by default" },
  { value: "operational", label: "Operator", desc: "Day-to-day execution role" },
  { value: "advisor", label: "Advisor", desc: "Read-only advisory access" },
];

export interface RoleEditorPaneProps {
  role: Role;
  onBack: () => void;
  onSaved: (role: Role) => void;
}

export default function RoleEditorPane({ role, onBack, onSaved }: RoleEditorPaneProps) {
  const [title, setTitle] = useState(role.title);
  const [roleType, setRoleType] = useState<RoleType>(role.role_type);
  const [grants, setGrants] = useState<string[]>(role.grants ?? []);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTitle(role.title);
    setRoleType(role.role_type);
    setGrants(role.grants ?? []);
    setError(null);
    setSubmitting(false);
  }, [role]);

  const toggleGrant = (grantId: string, checked: boolean) => {
    setGrants((prev) => (checked ? [...prev, grantId] : prev.filter((g) => g !== grantId)));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }

    const patch: { title?: string; role_type?: RoleType; grants?: string[] } = {};
    if (trimmedTitle !== role.title) patch.title = trimmedTitle;
    if (roleType !== role.role_type) patch.role_type = roleType;
    if (JSON.stringify(grants) !== JSON.stringify(role.grants ?? [])) patch.grants = grants;

    setSubmitting(true);
    setError(null);
    try {
      await api.updateRole(role.id, patch);
      onSaved({
        ...role,
        title: trimmedTitle,
        role_type: roleType,
        grants,
        updated_at: new Date().toISOString(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update role.");
      setSubmitting(false);
    }
  };

  return (
    <section className="role-editor-pane" aria-label="Edit selected role">
      <header className="role-editor-head">
        <div className="role-editor-breadcrumb">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="role-editor-back"
            onClick={onBack}
            leadingIcon={<ArrowLeft size={14} strokeWidth={1.8} />}
          >
            Roles
          </Button>
          <span>/</span>
          <span>{role.title || "(untitled)"}</span>
          <span>/</span>
          <span>Edit</span>
        </div>
        <div className="role-editor-title-row">
          <div>
            <p className="role-editor-eyebrow">Selected role</p>
            <h2 className="role-editor-title">Edit role</h2>
          </div>
          <Button
            type="submit"
            form="role-editor-form"
            variant="primary"
            size="sm"
            loading={submitting}
            leadingIcon={<Save size={13} strokeWidth={1.8} />}
          >
            Save
          </Button>
        </div>
      </header>

      <form id="role-editor-form" className="role-editor-form" onSubmit={handleSubmit}>
        <section className="role-editor-section">
          <div className="role-editor-section-head">
            <h3>Identity</h3>
            <p>Rename the authority seat and choose the tier it belongs to.</p>
          </div>
          <label className="role-editor-field" htmlFor="role-editor-title">
            <span>
              Title <em>*</em>
            </span>
            <Input
              id="role-editor-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
            />
          </label>
          <div className="role-editor-radio-grid" role="radiogroup" aria-label="Role type">
            {ROLE_TYPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className={
                  roleType === option.value
                    ? "role-editor-radio role-editor-radio--selected"
                    : "role-editor-radio"
                }
              >
                <input
                  type="radio"
                  name="role-editor-type"
                  value={option.value}
                  checked={roleType === option.value}
                  onChange={() => setRoleType(option.value)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.desc}</small>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="role-editor-section role-editor-section--grants">
          <div className="role-editor-section-head">
            <h3>Authority grants</h3>
            <p>{grants.length} grants selected for this role.</p>
          </div>
          <div className="role-editor-grants">
            {GRANT_CATALOG.map((grant) => {
              const checked = grants.includes(grant.id);
              return (
                <label
                  key={grant.id}
                  className={
                    checked ? "role-editor-grant role-editor-grant--checked" : "role-editor-grant"
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
        </section>

        {error && (
          <div className="role-editor-error" role="alert">
            {error}
          </div>
        )}

        <footer className="role-editor-footer">
          <Button type="button" variant="secondary" onClick={onBack} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={submitting}>
            Save changes
          </Button>
        </footer>
      </form>
    </section>
  );
}
