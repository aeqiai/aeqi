import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { PanelRightOpen, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Role, RoleEdge } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { entityPathFromId, entityBasePath } from "@/lib/entityPath";
import "@/styles/roles.css";
import {
  Button,
  EmptyState,
  IconButton,
  Loading,
  PrimitivePageHeader,
  PrimitiveSearchField,
} from "./ui";
import RolesChart from "./roles/RolesChart";
import RolesCards from "./roles/RolesCards";
import RolesList from "./roles/RolesList";
import RolesSortPopover from "./roles/RolesSortPopover";
import RolesFilterPopover from "./roles/RolesFilterPopover";
import RolesViewPopover from "./roles/RolesViewPopover";
import RoleInspector from "./roles/RoleInspector";
import NewRoleModal from "./roles/NewRoleModal";
import {
  type OccupantFilter,
  type RolesFilterState,
  parseOccupantFilter,
  parseSort,
  parseView,
} from "./roles/types";

const OCCUPANT_RANK: Record<string, number> = { agent: 0, human: 1, vacant: 2 };

/**
 * Roles — the trust's authority graph.
 *
 * Canvas composition:
 *   1. Page chrome — title + search + sort/filter/view + CTAs in one row
 *   2. One elevated workspace card — graph/list content directly on the canvas
 *   3. Integrated RoleInspector — collapsible internal detail column
 *
 * Selection state lives in the URL (`?role=<id>`) so a tab-switch
 * round-trip preserves the focused role.
 */
export default function TrustRolesTab({ trustId }: { trustId: string }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const sort = parseSort(searchParams.get("sort"));
  const occupantFilter = parseOccupantFilter(searchParams.get("occupant"));
  const search = searchParams.get("q") ?? "";
  const selectedRoleId = searchParams.get("role");
  const createRoleOpen = searchParams.get("new") === "1";

  const [roles, setRoles] = useState<Role[]>([]);
  const [edges, setEdges] = useState<RoleEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(true);

  const agents = useDaemonStore((s) => s.agents);
  const entities = useDaemonStore((s) => s.entities);
  const user = useAuthStore((s) => s.user);
  const entity = entities.find((e) => e.id === trustId);
  const basePath = entity ? entityBasePath(entity) : "/launch";

  const agentNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.name);
    return m;
  }, [agents]);
  const agentAvatars = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) {
      if (a.avatar) m.set(a.id, a.avatar);
    }
    return m;
  }, [agents]);
  const rolesById = useMemo(() => {
    const m = new Map<string, Role>();
    for (const r of roles) m.set(r.id, r);
    return m;
  }, [roles]);

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

  const setSelectedRole = useCallback(
    (id: string) =>
      patchParams((p) => {
        p.set("role", id);
        p.delete("mode");
      }),
    [patchParams],
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

  // Default selection: the viewer's own role (occupant_kind=human +
  // occupant_id matches user.id) — if none, a founder — if none,
  // the first role. Encoded in the URL so refresh preserves the
  // selection across loads.
  const defaultSelectedRole = useMemo(() => {
    if (roles.length === 0) return null;
    const userId = user?.id;
    if (userId) {
      const own = roles.find((r) => r.occupant_kind === "human" && r.occupant_id === userId);
      if (own) return own;
    }
    const founder = roles.find((r) => r.founder);
    if (founder) return founder;
    return roles[0];
  }, [roles, user?.id]);

  const selectedRole = useMemo(() => {
    if (view === "list") return null;
    if (selectedRoleId) {
      const found = rolesById.get(selectedRoleId);
      if (found) return found;
    }
    return defaultSelectedRole;
  }, [view, selectedRoleId, rolesById, defaultSelectedRole]);
  const handleRoleUpdated = useCallback((updated: Role) => {
    setRoles((prev) => prev.map((role) => (role.id === updated.id ? updated : role)));
  }, []);

  const handleSelectRole = useCallback(
    (role: Role) => {
      if (view === "list") {
        navigate(entityPathFromId(entities, trustId, "roles", role.id));
        return;
      }
      setSelectedRole(role.id);
    },
    [entities, navigate, setSelectedRole, trustId, view],
  );

  const handleRoleCreated = useCallback(
    async (role: Role) => {
      const refreshed = await api.getRoles(trustId);
      setRoles(refreshed.roles ?? []);
      setEdges(refreshed.edges ?? []);
      patchParams((p) => {
        p.delete("new");
        p.set("role", role.id);
      });
      setDetailsOpen(true);
    },
    [patchParams, trustId],
  );

  const showEmpty = !loading && !error && roles.length === 0;
  const showNoMatch = !loading && !error && roles.length > 0 && filtered.length === 0;
  const showDetailPanel = view !== "list" && selectedRole && detailsOpen;
  const showDetailToggle = view !== "list" && selectedRole && !detailsOpen;

  return (
    <div className="trust-roles">
      <PrimitivePageHeader
        className="trust-roles-page-header"
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
          <Button
            className="trust-top-rail-cta"
            variant="primary"
            size="md"
            onClick={openCreateRole}
            leadingIcon={<Plus size={14} strokeWidth={1.8} />}
          >
            Role
          </Button>
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

      <div
        className={
          showDetailPanel
            ? "trust-roles-main"
            : "trust-roles-main trust-roles-main--detail-collapsed"
        }
      >
        <div className="trust-roles-workspace">
          {showDetailToggle && (
            <IconButton
              type="button"
              variant="bordered"
              size="sm"
              className="trust-roles-detail-toggle"
              aria-label="Expand role detail"
              onClick={() => setDetailsOpen((open) => !open)}
            >
              <PanelRightOpen aria-hidden size={14} strokeWidth={1.7} />
            </IconButton>
          )}
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
                  selectedRoleId={selectedRole?.id ?? null}
                  newRolePath={`${entityPathFromId(entities, trustId, "roles")}?new=1`}
                />
              )}
              {!loading && !error && filtered.length > 0 && view === "cards" && (
                <div className="trust-roles-scroll">
                  <RolesCards
                    roles={filtered}
                    agentNames={agentNames}
                    agentAvatars={agentAvatars}
                    onSelectRole={handleSelectRole}
                    selectedRoleId={selectedRole?.id ?? null}
                  />
                </div>
              )}
              {!loading && !error && filtered.length > 0 && view === "list" && (
                <div className="trust-roles-scroll">
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
          {showDetailPanel && (
            <aside className="trust-roles-detail" aria-label="Selected role detail">
              <RoleInspector
                role={selectedRole}
                edges={edges}
                rolesById={rolesById}
                trustId={trustId}
                basePath={basePath}
                onCollapse={() => setDetailsOpen(false)}
                onRoleUpdated={handleRoleUpdated}
                onEdgesUpdated={setEdges}
              />
            </aside>
          )}
        </div>
      </div>
      <NewRoleModal
        open={createRoleOpen}
        onClose={closeCreateRole}
        trustId={trustId}
        roles={roles}
        agents={agents}
        onCreated={handleRoleCreated}
      />
    </div>
  );
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
        description="Roles appear automatically when this entity has agents. They'll show up here as soon as the Blueprint finishes seeding."
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
