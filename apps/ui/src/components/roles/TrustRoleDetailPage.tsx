import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { entityBasePath } from "@/lib/entityPath";
import type { Role, RoleEdge } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { Button, EmptyState, Loading, PrimitivePageHeader } from "../ui";
import RoleInspector from "./RoleInspector";

export default function TrustRoleDetailPage({
  trustId,
  roleId,
}: {
  trustId: string;
  roleId: string;
}) {
  const navigate = useNavigate();
  const entities = useDaemonStore((s) => s.entities);
  const entity = entities.find((e) => e.id === trustId);
  const basePath = entity ? entityBasePath(entity) : "/launch";
  const rolesPath = `${basePath}/roles`;

  const [roles, setRoles] = useState<Role[]>([]);
  const [edges, setEdges] = useState<RoleEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getRoles(trustId)
      .then((resp) => {
        if (cancelled) return;
        setRoles(resp.roles ?? []);
        setEdges(resp.edges ?? []);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || "Could not load role.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trustId]);

  const rolesById = useMemo(() => {
    const m = new Map<string, Role>();
    for (const role of roles) m.set(role.id, role);
    return m;
  }, [roles]);

  const role = rolesById.get(roleId) ?? null;

  const handleRoleUpdated = useCallback((updated: Role) => {
    setRoles((prev) => prev.map((role) => (role.id === updated.id ? updated : role)));
  }, []);

  return (
    <div className="trust-roles trust-role-detail-page">
      <PrimitivePageHeader
        className="trust-roles-page-header trust-role-detail-page-header"
        title={
          <span className="trust-role-detail-title">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="trust-role-detail-back"
              leadingIcon={<ArrowLeft size={14} strokeWidth={1.8} />}
              onClick={() => navigate(rolesPath)}
            >
              Roles
            </Button>
            <span className="trust-primitive-page-title-text">Role</span>
          </span>
        }
        aria-label="Role detail controls"
      />

      <div className="trust-roles-main trust-roles-main--detail-collapsed">
        <div className="trust-roles-workspace trust-role-detail-workspace">
          <section className="trust-roles-content" aria-label="Role detail workspace">
            <div className="trust-role-detail-canvas">
              {loading && (
                <div className="trust-roles-state">
                  <Loading size="sm" /> Loading role…
                </div>
              )}
              {error && <div className="trust-roles-state trust-roles-state--error">{error}</div>}
              {!loading && !error && !role && (
                <div className="trust-roles-state">
                  <EmptyState
                    title="Role not found"
                    description="This role is no longer available in the trust authority graph."
                    action={
                      <Button variant="ghost" size="sm" onClick={() => navigate(rolesPath)}>
                        Back to roles
                      </Button>
                    }
                  />
                </div>
              )}
              {!loading && !error && role && (
                <RoleInspector
                  role={role}
                  edges={edges}
                  rolesById={rolesById}
                  trustId={trustId}
                  basePath={basePath}
                  variant="page"
                  onRoleUpdated={handleRoleUpdated}
                  onEdgesUpdated={setEdges}
                />
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
