import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { GRANT_CATALOG } from "@/lib/grants";
import type { Role, RoleType } from "@/lib/types";
import { Button, Input, Spinner } from "@/components/ui";

const ROLE_TYPE_OPTIONS: { value: RoleType; label: string; desc: string }[] = [
  { value: "director", label: "Director", desc: "Full authority — all grants by default" },
  { value: "operational", label: "Operational", desc: "Day-to-day execution role" },
  { value: "advisor", label: "Advisor", desc: "Read-only advisory access" },
];

export default function RoleEditPage() {
  const { entityId = "", roleId = "" } = useParams<{ entityId: string; roleId: string }>();
  const navigate = useNavigate();

  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [roleType, setRoleType] = useState<RoleType>("operational");
  const [grants, setGrants] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!roleId) return;
    document.title = "Edit role · æqi";
    api
      .getRole(roleId)
      .then((r) => {
        setRole(r.role);
        setTitle(r.role.title);
        setRoleType(r.role.role_type);
        setGrants(r.role.grants ?? []);
        document.title = `Edit ${r.role.title || "role"} · æqi`;
      })
      .catch((e: Error) => setLoadError(e.message || "Could not load role."))
      .finally(() => setLoading(false));
  }, [roleId]);

  const toggleGrant = (grantId: string, checked: boolean) => {
    setGrants((prev) => (checked ? [...prev, grantId] : prev.filter((g) => g !== grantId)));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError("Title is required.");
      return;
    }
    setSubmitting(true);
    setError(null);

    const patch: { title?: string; role_type?: string; grants?: string[] } = {};
    if (trimmedTitle !== role?.title) patch.title = trimmedTitle;
    if (roleType !== role?.role_type) patch.role_type = roleType;
    if (JSON.stringify(grants) !== JSON.stringify(role?.grants ?? [])) patch.grants = grants;

    try {
      await api.updateRole(roleId, patch);
      navigate(`/c/${encodeURIComponent(entityId)}/roles/${encodeURIComponent(roleId)}`, {
        replace: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update role.");
      setSubmitting(false);
    }
  };

  const backHref = `/c/${encodeURIComponent(entityId)}/roles/${encodeURIComponent(roleId)}`;

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "28px 32px",
          color: "var(--text-muted)",
          fontSize: 13,
        }}
      >
        <Spinner size="sm" /> Loading…
      </div>
    );
  }

  if (loadError || !role) {
    return (
      <div className="asv-main" style={{ padding: "28px 32px" }}>
        <div style={{ color: "var(--color-error, #c2410c)", fontSize: 13 }}>
          {loadError || "Role not found."}
        </div>
        <Link to={backHref} style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="asv-main" style={{ padding: "28px 32px", maxWidth: 680 }}>
      <div className="page-header">
        <div className="page-header-breadcrumbs">
          <Link to={`/c/${encodeURIComponent(entityId)}/roles`}>Roles</Link>
          <span>/</span>
          <Link to={backHref}>{role.title || "(untitled)"}</Link>
          <span>/</span>
          <span>Edit</span>
        </div>
        <div className="page-header-row">
          <h1 className="page-title">Edit role</h1>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 520 }}
      >
        {/* Title */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <label
            htmlFor="edit-role-title"
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Title <span style={{ color: "var(--color-error, #c2410c)" }}>*</span>
          </label>
          <Input
            id="edit-role-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        {/* Role type */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Role type
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            {ROLE_TYPE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "var(--space-3)",
                  padding: "10px 12px",
                  borderRadius: "var(--radius-md)",
                  background:
                    roleType === opt.value
                      ? "var(--color-card-elevated, #fff)"
                      : "var(--color-card)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="edit-role-type"
                  value={opt.value}
                  checked={roleType === opt.value}
                  onChange={() => setRoleType(opt.value)}
                  style={{ marginTop: 2, accentColor: "var(--accent)" }}
                />
                <span>
                  <span
                    style={{ display: "block", fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}
                  >
                    {opt.label}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Grants */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Authority grants
          </span>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {GRANT_CATALOG.map((g) => {
              const checked = grants.includes(g.id);
              return (
                <label
                  key={g.id}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "var(--space-3)",
                    padding: "8px 0",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleGrant(g.id, e.target.checked)}
                    style={{ marginTop: 2, accentColor: "var(--accent)" }}
                  />
                  <span>
                    <span
                      style={{ display: "block", fontSize: 13, fontWeight: 500, lineHeight: 1.4 }}
                    >
                      {g.label}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{g.desc}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {error && (
          <div style={{ fontSize: 13, color: "var(--color-error, #c2410c)" }} role="alert">
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <Button
            variant="secondary"
            type="button"
            onClick={() => navigate(backHref)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button variant="primary" type="submit" loading={submitting}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}
