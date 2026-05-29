import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, PanelRightClose, PanelRightOpen, Share2 } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import * as ideasApi from "@/api/ideas";
import { api } from "@/lib/api";
import { entityBasePath } from "@/lib/entityPath";
import type { Idea, Role, RoleEdge } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { useClipboardToast } from "@/hooks/useClipboardToast";
import {
  Button,
  ClipboardToast,
  EmptyState,
  IconButton,
  Loading,
  PrimitivePageHeader,
  Tooltip,
} from "../ui";
import IdeaCanvas, { type IdeaCanvasHandle } from "../IdeaCanvas";
import RoleInspector from "./RoleInspector";
import "@/styles/roles.css";

function isRole(role: Role | null | undefined): role is Role {
  return Boolean(role?.id);
}

function normalizeRole(role: Role): Role {
  return { ...role, title: role.title ?? "(untitled)", grants: role.grants ?? [] };
}

function isRoleEdge(edge: RoleEdge | null | undefined): edge is RoleEdge {
  return Boolean(edge?.parent_role_id && edge.child_role_id);
}

function isIdea(idea: Idea | null | undefined): idea is Idea {
  return Boolean(idea?.id);
}

export default function TrustRoleDetailPage({
  trustId,
  roleId,
}: {
  trustId: string;
  roleId: string;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const entities = useDaemonStore((s) => s.entities);
  const entity = entities.find((e) => e?.id === trustId);
  const basePath = entity ? entityBasePath(entity) : "/launch";
  const fallbackRolesPath = `${basePath}/roles`;
  const rolesReturnTo =
    location.state && typeof location.state === "object" && "rolesReturnTo" in location.state
      ? (location.state as { rolesReturnTo?: unknown }).rolesReturnTo
      : null;
  const rolesPath =
    typeof rolesReturnTo === "string" &&
    (rolesReturnTo === fallbackRolesPath || rolesReturnTo.startsWith(`${fallbackRolesPath}?`))
      ? rolesReturnTo
      : fallbackRolesPath;

  const [roles, setRoles] = useState<Role[]>([]);
  const [edges, setEdges] = useState<RoleEdge[]>([]);
  const [roleIdea, setRoleIdea] = useState<Idea | null>(null);
  const [ideaLoading, setIdeaLoading] = useState(false);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [bodyDirty, setBodyDirty] = useState(false);
  const [savingBody, setSavingBody] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const canvasRef = useRef<IdeaCanvasHandle | null>(null);
  const { copy, toastLabel } = useClipboardToast();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getRoles(trustId)
      .then((resp) => {
        if (cancelled) return;
        setRoles((resp.roles ?? []).filter(isRole).map(normalizeRole));
        setEdges((resp.edges ?? []).filter(isRoleEdge));
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

  const handleRoleUpdated = useCallback((updated: Role | null | undefined) => {
    if (!isRole(updated)) return;
    const nextRole = normalizeRole(updated);
    setRoles((prev) =>
      prev.filter(isRole).map((role) => (role.id === nextRole.id ? nextRole : role)),
    );
  }, []);

  useEffect(() => {
    setRoleIdea(null);
    setIdeaError(null);
    setBodyDirty(false);
    if (!role) return;

    let cancelled = false;
    const loadOrCreateIdea = async () => {
      setIdeaLoading(true);
      try {
        let ideaId = role.description_idea_id ?? null;
        if (!ideaId) {
          const created = await ideasApi.storeIdea(
            {
              name: role.title,
              content: "",
              tags: ["role"],
              agent_id: trustId,
              scope: "global",
            },
            trustId,
          );
          ideaId = created.id;
          const updated = await api.updateRole(role.id, { description_idea_id: ideaId });
          if (!cancelled) handleRoleUpdated(updated.role);
        }

        const resp = await api.getIdeasByIds([ideaId]);
        const idea = (resp.ideas ?? []).filter(isIdea).find((item) => item.id === ideaId) ?? null;
        if (!cancelled) setRoleIdea(idea);
      } catch (err) {
        if (!cancelled) {
          setIdeaError(err instanceof Error ? err.message : "Could not load role idea.");
          setRoleIdea(null);
        }
      } finally {
        if (!cancelled) setIdeaLoading(false);
      }
    };

    void loadOrCreateIdea();
    return () => {
      cancelled = true;
    };
  }, [handleRoleUpdated, role, role?.description_idea_id, role?.id, role?.title, trustId]);

  const handleSaveIdea = useCallback(async () => {
    if (!canvasRef.current || !role) return;
    setSavingBody(true);
    setIdeaError(null);
    try {
      const ideaId = await canvasRef.current.commit();
      const resp = await api.getIdeasByIds([ideaId]);
      const nextIdea = (resp.ideas ?? []).filter(isIdea).find((item) => item.id === ideaId) ?? null;
      if (nextIdea) {
        setRoleIdea(nextIdea);
        if (nextIdea.name && nextIdea.name !== role.title) {
          const updated = await api.updateRole(role.id, { title: nextIdea.name });
          handleRoleUpdated(updated.role);
        }
      }
      setBodyDirty(false);
    } catch (err) {
      setIdeaError(err instanceof Error ? err.message : "Could not save role idea.");
    } finally {
      setSavingBody(false);
    }
  }, [handleRoleUpdated, role]);

  const handleRevertIdea = useCallback(() => {
    canvasRef.current?.revert();
    setBodyDirty(false);
  }, []);

  const ideaTagSuggestions = useMemo(() => roleIdea?.tags ?? [], [roleIdea?.tags]);

  const copyRoleRoute = useCallback(() => {
    if (!role) return;
    void copy(`${window.location.origin}${basePath}/roles/${encodeURIComponent(role.id)}`);
  }, [basePath, copy, role]);

  return (
    <div
      className={`trust-roles trust-role-detail-page${
        detailsCollapsed ? " trust-role-detail-page--details-collapsed" : ""
      }`}
    >
      <PrimitivePageHeader
        className="trust-roles-page-header trust-role-detail-page-header"
        title={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="trust-role-detail-back"
            leadingIcon={<ArrowLeft size={14} strokeWidth={1.8} />}
            onClick={() => navigate(rolesPath)}
          >
            Roles
          </Button>
        }
        aria-label="Role detail controls"
        actions={
          <div className="trust-roles-header-actions">
            {role && (
              <Tooltip content="Copy role route" portal>
                <IconButton
                  variant="bordered"
                  size="md"
                  className="trust-roles-header-icon"
                  aria-label="Copy role route"
                  onClick={copyRoleRoute}
                >
                  <Share2 size={14} strokeWidth={1.8} />
                </IconButton>
              </Tooltip>
            )}
            {bodyDirty && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleRevertIdea}
                  disabled={savingBody}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleSaveIdea}
                  loading={savingBody}
                >
                  Save
                </Button>
              </>
            )}
          </div>
        }
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
                <>
                  <main className="trust-role-detail-document" aria-label="Role idea">
                    {ideaLoading && (
                      <div className="trust-roles-state">
                        <Loading size="sm" /> Loading role idea…
                      </div>
                    )}
                    {ideaError && (
                      <div className="trust-roles-state trust-roles-state--error">{ideaError}</div>
                    )}
                    {!ideaLoading && !ideaError && roleIdea && (
                      <IdeaCanvas
                        ref={canvasRef}
                        agentId={roleIdea.agent_id ?? trustId}
                        idea={roleIdea}
                        onBack={() => navigate(rolesPath)}
                        onNew={() => navigate(`${fallbackRolesPath}?new=1`)}
                        onDirtyChange={setBodyDirty}
                        embedded
                        hideMetaStrip
                        contentHeaderSlot={
                          <div className="trust-role-detail-surface-header">
                            <div className="trust-role-detail-surface-title">Role idea</div>
                            <Tooltip
                              content={detailsCollapsed ? "Show details" : "Hide details"}
                              portal
                            >
                              <button
                                type="button"
                                className="role-inspector-icon-action trust-role-detail-surface-action"
                                aria-label={
                                  detailsCollapsed ? "Show role details" : "Hide role details"
                                }
                                title={detailsCollapsed ? "Show details" : "Hide details"}
                                onClick={() => setDetailsCollapsed((collapsed) => !collapsed)}
                                data-pill-allowed=""
                              >
                                {detailsCollapsed ? (
                                  <PanelRightOpen size={13} strokeWidth={1.7} />
                                ) : (
                                  <PanelRightClose size={13} strokeWidth={1.7} />
                                )}
                              </button>
                            </Tooltip>
                          </div>
                        }
                        conversationActivity="tabs"
                      />
                    )}
                  </main>
                  {!detailsCollapsed && (
                    <aside className="trust-role-detail-inspector" aria-label="Role details">
                      <RoleInspector
                        role={role}
                        edges={edges}
                        rolesById={rolesById}
                        trustId={trustId}
                        basePath={basePath}
                        idea={roleIdea}
                        ideaTagSuggestions={ideaTagSuggestions}
                        variant="page"
                        onCopyValue={copy}
                        onIdeaUpdated={setRoleIdea}
                        onRoleUpdated={handleRoleUpdated}
                        onEdgesUpdated={(nextEdges) => setEdges(nextEdges.filter(isRoleEdge))}
                      />
                    </aside>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
      </div>
      <ClipboardToast label={toastLabel} />
    </div>
  );
}
