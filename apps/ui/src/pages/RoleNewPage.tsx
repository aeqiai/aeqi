import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "@/lib/api";
import { GRANT_CATALOG, DEFAULT_GRANTS } from "@/lib/grants";
import { logError } from "@/lib/logging";
import type { OccupantKind, RoleType } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
import { Button, Input, Select } from "@/components/ui";

const ROLE_TYPE_OPTIONS: { value: RoleType; label: string; desc: string }[] = [
  { value: "director", label: "Director", desc: "Full authority — all grants by default" },
  { value: "operational", label: "Operator", desc: "Day-to-day execution role" },
  { value: "advisor", label: "Advisor", desc: "Read-only advisory access" },
];

const OCCUPANT_OPTIONS = [
  { value: "vacant", label: "Vacant" },
  { value: "human", label: "Human user" },
  { value: "agent", label: "Existing agent" },
];

export default function RoleNewPage() {
  const { trustId = "" } = useParams<{ trustId: string }>();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [roleType, setRoleType] = useState<RoleType>("operational");
  const [occupantKind, setOccupantKind] = useState<OccupantKind>("vacant");
  const [agentId, setAgentId] = useState("");
  const [humanId, setHumanId] = useState("");
  const [parentRoleId, setParentRoleId] = useState("");
  const [grants, setGrants] = useState<string[]>(() => DEFAULT_GRANTS["operational"]);
  const [parentOptions, setParentOptions] = useState<{ value: string; label: string }[]>([
    { value: "", label: "None" },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agents = useDaemonStore((s) => s.agents);
  const entitiesList = useDaemonStore((s) => s.entities);
  const scopedAgents = useMemo(
    () => agents.filter((a) => a.trust_id === trustId || a.id === trustId),
    [agents, trustId],
  );
  const agentOptions = useMemo(
    () => scopedAgents.map((a) => ({ value: a.id, label: a.name })),
    [scopedAgents],
  );

  useEffect(() => {
    document.title = "aeqi";
    api
      .getRoles(trustId)
      .then((r) => {
        const opts = r.roles.map((ro) => ({ value: ro.id, label: ro.title || "(untitled)" }));
        setParentOptions([{ value: "", label: "None" }, ...opts]);
      })
      .catch((e) => logError("role-new.load-parent-options", e));
  }, [trustId]);

  const handleRoleTypeChange = (val: string) => {
    const t = val as RoleType;
    setRoleType(t);
    setGrants(DEFAULT_GRANTS[t]);
  };

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

    let occupantId: string | undefined;
    if (occupantKind === "agent") {
      if (!agentId) {
        setError("Select an agent.");
        return;
      }
      occupantId = agentId;
    } else if (occupantKind === "human") {
      const t = humanId.trim();
      if (!t) {
        setError("Enter a user id or email.");
        return;
      }
      occupantId = t;
    }

    setSubmitting(true);
    setError(null);
    try {
      const resp = await api.createRole({
        trust_id: trustId,
        title: trimmedTitle,
        occupant_kind: occupantKind,
        ...(occupantId ? { occupant_id: occupantId } : {}),
        ...(roleType === "operational" && parentRoleId ? { parent_role_id: parentRoleId } : {}),
        role_type: roleType,
        grants,
      });
      navigate(entityPathFromId(entitiesList, trustId, "roles", resp.role.id), {
        replace: true,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create role.");
      setSubmitting(false);
    }
  };

  const backHref = entityPathFromId(entitiesList, trustId, "roles");

  return (
    <div className="asv-main" style={{ padding: "var(--space-6) var(--space-8)", maxWidth: 680 }}>
      <div className="page-header">
        <div className="page-header-breadcrumbs">
          <Link to={backHref}>Roles</Link>
          <span>/</span>
          <span>New role</span>
        </div>
        <div className="page-header-row">
          <h1 className="page-title">New role</h1>
        </div>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "var(--space-6)", maxWidth: 520 }}
      >
        {/* Title */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <label
            htmlFor="role-title"
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Title <span style={{ color: "var(--color-error)" }}>*</span>
          </label>
          <Input
            id="role-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Head of Engineering"
            autoFocus
          />
        </div>

        {/* Role type */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              color: "var(--color-text-muted)",
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
                  padding: "var(--space-2) var(--space-3)",
                  borderRadius: "var(--radius-md)",
                  background:
                    roleType === opt.value ? "var(--color-card-elevated)" : "var(--color-card)",
                  cursor: "pointer",
                }}
              >
                <input
                  type="radio"
                  name="role-type"
                  value={opt.value}
                  checked={roleType === opt.value}
                  onChange={() => handleRoleTypeChange(opt.value)}
                  style={{ marginTop: "var(--space-0)", accentColor: "var(--accent)" }}
                />
                <span>
                  <span
                    style={{
                      display: "block",
                      fontSize: "var(--font-size-sm)",
                      fontWeight: 500,
                      lineHeight: 1.4,
                    }}
                  >
                    {opt.label}
                  </span>
                  <span
                    style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}
                  >
                    {opt.desc}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>

        {/* Parent role — operational only */}
        {roleType === "operational" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <label
              htmlFor="role-parent"
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 500,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Parent role
            </label>
            <Select
              id="role-parent"
              options={parentOptions}
              value={parentRoleId}
              onChange={setParentRoleId}
              fullWidth
            />
          </div>
        )}

        {/* Occupant */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <label
            htmlFor="role-occupant"
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            Initial occupant
          </label>
          <Select
            id="role-occupant"
            options={OCCUPANT_OPTIONS}
            value={occupantKind}
            onChange={(v) => setOccupantKind(v as OccupantKind)}
            fullWidth
          />
        </div>

        {occupantKind === "agent" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <label
              htmlFor="role-agent"
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 500,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Agent
            </label>
            <Select
              id="role-agent"
              options={agentOptions}
              value={agentId}
              onChange={setAgentId}
              placeholder={agentOptions.length === 0 ? "No agents in this entity" : "Select agent"}
              disabled={agentOptions.length === 0}
              fullWidth
            />
          </div>
        )}

        {occupantKind === "human" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <label
              htmlFor="role-human"
              style={{
                fontSize: "var(--font-size-xs)",
                fontWeight: 500,
                color: "var(--color-text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              User id or email
            </label>
            <Input
              id="role-human"
              value={humanId}
              onChange={(e) => setHumanId(e.target.value)}
              placeholder="user id or email"
            />
          </div>
        )}

        {/* Grants */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
          <span
            style={{
              fontSize: "var(--font-size-xs)",
              fontWeight: 500,
              color: "var(--color-text-muted)",
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
                    padding: "var(--space-2) 0",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => toggleGrant(g.id, e.target.checked)}
                    style={{ marginTop: "var(--space-0)", accentColor: "var(--accent)" }}
                  />
                  <span>
                    <span
                      style={{
                        display: "block",
                        fontSize: "var(--font-size-sm)",
                        fontWeight: 500,
                        lineHeight: 1.4,
                      }}
                    >
                      {g.label}
                    </span>
                    <span
                      style={{ fontSize: "var(--font-size-xs)", color: "var(--color-text-muted)" }}
                    >
                      {g.desc}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        {error && (
          <div
            style={{ fontSize: "var(--font-size-sm)", color: "var(--color-error)" }}
            role="alert"
          >
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
            Create role
          </Button>
        </div>
      </form>
    </div>
  );
}
