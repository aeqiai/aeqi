import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Plus, Share2 } from "lucide-react";
import { api } from "@/lib/api";
import { blueprintId } from "@/lib/blueprintId";
import { describeBlueprintStructures } from "@/lib/blueprintStructures";
import type { Blueprint, Role, RoleEdge, SingleBlueprint } from "@/lib/types";
import { isSingleBlueprint } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
import { useClipboardToast } from "@/hooks/useClipboardToast";
import "@/styles/roles.css";
import {
  Button,
  ClipboardToast,
  EmptyState,
  IconButton,
  Loading,
  PrimitivePageHeader,
  PrimitiveSearchField,
  Tooltip,
} from "./ui";
import RolesChart from "./roles/RolesChart";
import RolesCards from "./roles/RolesCards";
import RolesList from "./roles/RolesList";
import RolesSortPopover from "./roles/RolesSortPopover";
import RolesFilterPopover from "./roles/RolesFilterPopover";
import RolesViewPopover from "./roles/RolesViewPopover";
import NewRoleModal from "./roles/NewRoleModal";
import {
  type OccupantFilter,
  type RolesFilterState,
  parseOccupantFilter,
  parseSort,
  parseView,
} from "./roles/types";

const OCCUPANT_RANK: Record<string, number> = { agent: 0, human: 1, vacant: 2 };

function isRole(role: Role | null | undefined): role is Role {
  return Boolean(role?.id);
}

function normalizeRole(role: Role): Role {
  return { ...role, title: role.title ?? "(untitled)", grants: role.grants ?? [] };
}

function isRoleEdge(edge: RoleEdge | null | undefined): edge is RoleEdge {
  return Boolean(edge?.parent_role_id && edge.child_role_id);
}

/**
 * Roles — the trust's authority graph.
 *
 * Canvas composition:
 *   1. Page chrome — title + search + sort/filter/view + CTAs in one row
 *   2. One elevated workspace card — graph/list content directly on the canvas
 *   3. Dedicated role detail routes — chart/cards/list all navigate to
 *      `/roles/:id`, keeping the explore workspace free of active side panels.
 */
export default function TrustRolesTab({ trustId }: { trustId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const sort = parseSort(searchParams.get("sort"));
  const occupantFilter = parseOccupantFilter(searchParams.get("occupant"));
  const search = searchParams.get("q") ?? "";
  const legacySelectedRoleId = searchParams.get("role");
  const createRoleOpen = searchParams.get("new") === "1";

  const [roles, setRoles] = useState<Role[]>([]);
  const [edges, setEdges] = useState<RoleEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roleTemplates, setRoleTemplates] = useState<SingleBlueprint[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const { copy, toastLabel } = useClipboardToast();

  const agents = useDaemonStore((s) => s.agents);
  const entities = useDaemonStore((s) => s.entities);

  const agentNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents.filter(Boolean)) m.set(a.id, a.name);
    return m;
  }, [agents]);
  const agentAvatars = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents.filter(Boolean)) {
      if (a.avatar) m.set(a.id, a.avatar);
    }
    return m;
  }, [agents]);
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
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Could not load roles.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [trustId]);

  useEffect(() => {
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError(null);
    api
      .getBlueprints()
      .then((resp) => {
        if (cancelled) return;
        setRoleTemplates((resp.blueprints ?? []).filter(isRoleTemplateBlueprint));
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setRoleTemplates([]);
        setTemplatesError(e.message || "Could not load role templates.");
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!legacySelectedRoleId) return;
    const params = new URLSearchParams(searchParams);
    params.delete("role");
    navigate(entityPathFromId(entities, trustId, "roles", legacySelectedRoleId), {
      replace: true,
      state: {
        rolesReturnTo: `${location.pathname}${params.toString() ? `?${params.toString()}` : ""}`,
      },
    });
  }, [entities, legacySelectedRoleId, location.pathname, navigate, searchParams, trustId]);

  const patchParams = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams);
      mut(params);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const filter: RolesFilterState = useMemo(
    () => ({ search, sort, occupant: occupantFilter }),
    [search, sort, occupantFilter],
  );

  const setFilter = useCallback(
    (patch: Partial<RolesFilterState>) =>
      patchParams((p) => {
        if ("search" in patch) {
          if (patch.search) p.set("q", patch.search);
          else p.delete("q");
        }
        if ("sort" in patch) {
          if (patch.sort && patch.sort !== "title") p.set("sort", patch.sort);
          else p.delete("sort");
        }
        if ("occupant" in patch) {
          if (patch.occupant && patch.occupant !== "all") p.set("occupant", patch.occupant);
          else p.delete("occupant");
        }
      }),
    [patchParams],
  );

  const setView = useCallback(
    (next: typeof view) =>
      patchParams((p) => {
        if (next === "chart") p.delete("view");
        else p.set("view", next);
      }),
    [patchParams],
  );

  const openCreateRole = useCallback(
    () =>
      patchParams((p) => {
        p.set("new", "1");
      }),
    [patchParams],
  );

  const closeCreateRole = useCallback(
    () =>
      patchParams((p) => {
        p.delete("new");
      }),
    [patchParams],
  );

  const copyCurrentRoute = useCallback(() => {
    void copy(`${window.location.origin}${location.pathname}${location.search}`);
  }, [copy, location.pathname, location.search]);

  const browseRoleTemplates = useCallback(() => {
    navigate(`/templates?import_into=${encodeURIComponent(trustId)}`);
  }, [navigate, trustId]);

  const openRoleTemplate = useCallback(
    (template: SingleBlueprint) => {
      const id = blueprintId(template);
      if (!id) {
        browseRoleTemplates();
        return;
      }
      navigate(`/templates/${encodeURIComponent(id)}?import_into=${encodeURIComponent(trustId)}`);
    },
    [browseRoleTemplates, navigate, trustId],
  );

  const roleCount = roles.length;

  const occupantCounts = useMemo(() => {
    const counts: Record<OccupantFilter, number> = {
      all: 0,
      agent: 0,
      human: 0,
      trust: 0,
      vacant: 0,
    };
    for (const r of roles) {
      counts.all += 1;
      counts[r.occupant_kind] += 1;
    }
    return counts;
  }, [roles]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = roles.slice();
    if (occupantFilter !== "all") {
      rows = rows.filter((r) => r.occupant_kind === occupantFilter);
    }
    if (q) {
      rows = rows.filter((r) => {
        if (r.title.toLowerCase().includes(q)) return true;
        if (r.occupant_id) {
          const name = agentNames.get(r.occupant_id);
          if (name && name.toLowerCase().includes(q)) return true;
          if (r.occupant_id.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }
    rows.sort((a, b) => {
      switch (sort) {
        case "kind":
          return (
            (OCCUPANT_RANK[a.occupant_kind] ?? 9) - (OCCUPANT_RANK[b.occupant_kind] ?? 9) ||
            a.title.localeCompare(b.title)
          );
        case "recent":
          return b.created_at.localeCompare(a.created_at);
        case "title":
        default:
          return a.title.localeCompare(b.title);
      }
    });
    return rows;
  }, [roles, search, sort, occupantFilter, agentNames]);

  const filteredIds = useMemo(() => new Set(filtered.map((r) => r.id)), [filtered]);
  const filteredEdges = useMemo(
    () =>
      edges.filter((e) => filteredIds.has(e.parent_role_id) && filteredIds.has(e.child_role_id)),
    [edges, filteredIds],
  );

  const handleSelectRole = useCallback(
    (role: Role) => {
      navigate(entityPathFromId(entities, trustId, "roles", role.id), {
        state: { rolesReturnTo: `${location.pathname}${location.search}` },
      });
    },
    [entities, location.pathname, location.search, navigate, trustId],
  );

  const handleRoleCreated = useCallback(
    async (role: Role) => {
      const refreshed = await api.getRoles(trustId);
      setRoles((refreshed.roles ?? []).filter(isRole).map(normalizeRole));
      setEdges((refreshed.edges ?? []).filter(isRoleEdge));
      const params = new URLSearchParams(searchParams);
      params.delete("new");
      navigate(entityPathFromId(entities, trustId, "roles", role.id), {
        state: {
          rolesReturnTo: `${location.pathname}${params.toString() ? `?${params.toString()}` : ""}`,
        },
      });
    },
    [entities, location.pathname, navigate, searchParams, trustId],
  );

  const showEmpty = !loading && !error && roles.length === 0;
  const showNoMatch = !loading && !error && roles.length > 0 && filtered.length === 0;

  return (
    <div className="trust-roles trust-primitive-shell">
      <PrimitivePageHeader
        className="trust-roles-page-header trust-primitive-shell-header"
        title={
          <span className="trust-primitive-page-title">
            <span className="trust-primitive-page-title-text">Roles</span>
            <span className="trust-primitive-page-count" aria-hidden="true">
              {roleCount}
            </span>
          </span>
        }
        aria-label="Role controls"
        actions={
          <div className="trust-roles-header-actions">
            <Tooltip content="Copy route" portal>
              <IconButton
                variant="bordered"
                size="md"
                className="trust-roles-header-icon"
                aria-label="Copy roles route"
                onClick={copyCurrentRoute}
              >
                <Share2 size={14} strokeWidth={1.8} />
              </IconButton>
            </Tooltip>
            <Button
              className="trust-top-rail-cta"
              variant="primary"
              size="md"
              onClick={openCreateRole}
              leadingIcon={<Plus size={14} strokeWidth={1.8} />}
            >
              Role
            </Button>
          </div>
        }
      >
        <div className="ideas-toolbar trust-roles-toolbar">
          <PrimitiveSearchField
            placeholder="Search roles"
            value={search}
            onChange={(next) => setFilter({ search: next })}
            onEscapeEmpty={(e) => e.currentTarget.blur()}
          />
          <RolesSortPopover sort={sort} onChange={(next) => setFilter({ sort: next })} />
          <RolesFilterPopover
            filter={filter}
            occupantCounts={occupantCounts}
            onChange={setFilter}
          />
          <RolesViewPopover view={view} onChange={setView} />
        </div>
      </PrimitivePageHeader>

      <div className="trust-roles-main trust-roles-main--detail-collapsed trust-primitive-shell-surface">
        <div className="trust-roles-workspace">
          <section className="trust-roles-content" aria-label="Role workspace">
            <div className="trust-roles-canvas">
              {loading && <RolesLoading />}
              {error && <RolesError message={error} />}
              {showEmpty && <RolesEmptyState />}
              {showNoMatch && (
                <RolesNoMatch onReset={() => setFilter({ search: "", occupant: "all" })} />
              )}
              {!loading && !error && filtered.length > 0 && view === "chart" && (
                <RolesChart
                  roles={filtered}
                  edges={filteredEdges}
                  agentNames={agentNames}
                  agentAvatars={agentAvatars}
                  onSelectRole={handleSelectRole}
                  selectedRoleId={null}
                  newRolePath={`${entityPathFromId(entities, trustId, "roles")}?new=1`}
                />
              )}
              {!loading && !error && filtered.length > 0 && view === "cards" && (
                <div className="trust-roles-scroll trust-roles-scroll--cards">
                  <RolesCards
                    roles={filtered}
                    agentNames={agentNames}
                    agentAvatars={agentAvatars}
                    onSelectRole={handleSelectRole}
                    selectedRoleId={null}
                  />
                </div>
              )}
              {!loading && !error && filtered.length > 0 && view === "list" && (
                <div className="trust-roles-scroll trust-roles-scroll--list">
                  <RolesList
                    roles={filtered}
                    edges={filteredEdges}
                    agentNames={agentNames}
                    agentAvatars={agentAvatars}
                    onSelectRole={handleSelectRole}
                  />
                </div>
              )}
            </div>
          </section>
        </div>
        <SuggestedRoleTemplates
          templates={roleTemplates}
          loading={templatesLoading}
          error={templatesError}
          onOpenTemplate={openRoleTemplate}
          onBrowse={browseRoleTemplates}
        />
      </div>
      <NewRoleModal
        open={createRoleOpen}
        onClose={closeCreateRole}
        trustId={trustId}
        roles={roles}
        agents={agents}
        onCreated={handleRoleCreated}
      />
      <ClipboardToast label={toastLabel} />
    </div>
  );
}

function isRoleTemplateBlueprint(template: Blueprint): template is SingleBlueprint {
  if (!isSingleBlueprint(template)) return false;
  const roleCount = template.seed_roles?.length ?? 0;
  const agentCount = template.seed_agents?.length ?? 0;
  return roleCount > 0 || agentCount > 0 || Boolean(template.root);
}

/**
 * Role templates — real role structures from the template catalog.
 * This is a recessed sibling floor: current roles stay in the chart,
 * possible next structures stay below it.
 */
function SuggestedRoleTemplates({
  templates,
  loading,
  error,
  onOpenTemplate,
  onBrowse,
}: {
  templates: SingleBlueprint[];
  loading: boolean;
  error: string | null;
  onOpenTemplate: (template: SingleBlueprint) => void;
  onBrowse: () => void;
}) {
  const visible = templates.slice(0, 3);

  return (
    <section className="trust-roles-suggest" aria-label="Role templates">
      <header className="trust-roles-suggest-head">
        <div className="trust-roles-suggest-titles">
          <div className="trust-roles-suggest-title-row">
            <h2 className="trust-roles-suggest-title">Role templates</h2>
            <span className="trust-roles-suggest-count" aria-hidden>
              {templates.length}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="trust-roles-suggest-all"
          onClick={onBrowse}
          aria-label="Browse role templates"
        >
          Browse templates
        </Button>
      </header>

      {loading ? (
        <div className="trust-roles-suggest-state">
          <Loading size="sm" /> Loading role templates…
        </div>
      ) : error ? (
        <div className="trust-roles-suggest-state" role="status">
          Role templates are unavailable right now.
        </div>
      ) : visible.length === 0 ? (
        <div className="trust-roles-suggest-state" role="status">
          No role templates are published yet.
        </div>
      ) : (
        <div className="trust-roles-suggest-grid">
          {visible.map((template) => (
            <button
              key={blueprintId(template)}
              type="button"
              className="trust-roles-suggest-card"
              onClick={() => onOpenTemplate(template)}
              aria-label={`View ${template.name} role template`}
            >
              <h3 className="trust-roles-suggest-card-title">{template.name}</h3>
              <p className="trust-roles-suggest-card-desc">
                {template.tagline || roleTemplateStructureLine(template)}
              </p>
              <p className="trust-roles-suggest-card-meta">{roleTemplateRuntimeLine(template)}</p>
              <span className="trust-roles-suggest-card-cta" aria-hidden>
                View template
                <ArrowRight size={12} strokeWidth={1.8} />
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function roleTemplateStructureLine(template: SingleBlueprint): string {
  const structure = describeBlueprintStructures(template)[0];
  return structure?.title ? `${structure.title} structure` : "Reusable role structure.";
}

function roleTemplateRuntimeLine(template: SingleBlueprint): string {
  const structures = describeBlueprintStructures(template);
  const roles =
    template.seed_roles?.length ?? structures.reduce((sum, item) => sum + item.roles.length, 0);
  const agents = template.seed_agents?.length ?? 0;
  const parts = [
    `${roles} ${roles === 1 ? "role" : "roles"}`,
    `${structures.length} ${structures.length === 1 ? "structure" : "structures"}`,
  ];
  if (agents > 0) parts.push(`${agents} ${agents === 1 ? "agent" : "agents"}`);
  return parts.join(" · ");
}

function RolesLoading() {
  return (
    <div className="trust-roles-state">
      <Loading size="sm" /> Loading roles…
    </div>
  );
}

function RolesError({ message }: { message: string }) {
  return <div className="trust-roles-state trust-roles-state--error">{message}</div>;
}

function RolesEmptyState() {
  return (
    <div className="trust-roles-state">
      <EmptyState
        title="No roles yet"
        description="Roles appear automatically when this entity has agents. They'll show up here as soon as the template finishes seeding."
      />
    </div>
  );
}

function RolesNoMatch({ onReset }: { onReset: () => void }) {
  return (
    <div className="trust-roles-state">
      <EmptyState
        title="No roles match these filters."
        description="Widen the search or clear the occupant filter to bring rows back."
        action={
          <Button variant="ghost" size="sm" onClick={onReset}>
            Reset filters
          </Button>
        }
      />
    </div>
  );
}
