import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Mail, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Role, RoleEdge } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { useAuthStore } from "@/store/auth";
import { entityPathFromId, entityBasePath } from "@/lib/entityPath";
import "@/styles/roles.css";
import { Button, EmptyState, Loading } from "./ui";
import RolesChart from "./roles/RolesChart";
import RolesCards from "./roles/RolesCards";
import RolesList from "./roles/RolesList";
import RolesSortPopover from "./roles/RolesSortPopover";
import RolesFilterPopover from "./roles/RolesFilterPopover";
import RolesViewPopover from "./roles/RolesViewPopover";
import RoleInspector from "./roles/RoleInspector";
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
 * v2 composition (2026-05-20, "canonical" pass):
 *   1. Page header (h1 "Roles" + subtitle) + two CTAs (+ Invite, + Role)
 *   2. Snapshot strip — total / founders / operational / vacant
 *   3. Toolbar — search + sort + filter + view (chart | cards | list)
 *   4. Content row — graph on the left, RoleInspector on the right
 *      (always-rendered; default selection = viewer's own role, fallback
 *      to a founder if the viewer holds no role)
 *
 * Selection state lives in the URL (`?role=<id>`) so a tab-switch
 * round-trip preserves the focused role.
 */
export default function TrustRolesTab({ trustId }: { trustId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const view = parseView(searchParams.get("view"));
  const sort = parseSort(searchParams.get("sort"));
  const occupantFilter = parseOccupantFilter(searchParams.get("occupant"));
  const search = searchParams.get("q") ?? "";
  const selectedRoleId = searchParams.get("role");

  const [roles, setRoles] = useState<Role[]>([]);
  const [edges, setEdges] = useState<RoleEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  const setSelectedRole = useCallback(
    (id: string) =>
      patchParams((p) => {
        p.set("role", id);
      }),
    [patchParams],
  );

  // Snapshot counts. We surface tier counts the user-facing model
  // actually exposes: total, directors (board), operational (org
  // chart), vacant (open seats). The `founder` boolean in the data
  // model is intentionally not surfaced as a separate counter — see
  // RoleNode.pillLabel for why founders read as Directors here.
  const snapshot = useMemo(() => {
    let total = 0;
    let directors = 0;
    let operational = 0;
    let vacant = 0;
    for (const r of roles) {
      total += 1;
      if (r.role_type === "director") directors += 1;
      else if (r.role_type === "operational") operational += 1;
      if (r.occupant_kind === "vacant") vacant += 1;
    }
    return { total, directors, operational, vacant };
  }, [roles]);

  const occupantCounts = useMemo(() => {
    const counts: Record<OccupantFilter, number> = { all: 0, agent: 0, human: 0, vacant: 0 };
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
    if (selectedRoleId) {
      const found = rolesById.get(selectedRoleId);
      if (found) return found;
    }
    return defaultSelectedRole;
  }, [selectedRoleId, rolesById, defaultSelectedRole]);

  const handleSelectRole = useCallback(
    (role: Role) => {
      setSelectedRole(role.id);
    },
    [setSelectedRole],
  );

  const showEmpty = !loading && !error && roles.length === 0;
  const showNoMatch = !loading && !error && roles.length > 0 && filtered.length === 0;

  return (
    <div className="trust-roles">
      <header className="trust-roles-header">
        <div className="trust-roles-header-titles">
          <h1 className="trust-roles-title">Roles</h1>
          <p className="trust-roles-subtitle">Authority for this TRUST.</p>
        </div>
        <div className="trust-roles-header-actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate(entityPathFromId(entities, trustId, "roles", "invite"))}
            leadingIcon={<Mail size={13} strokeWidth={1.6} />}
          >
            Invite
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate(entityPathFromId(entities, trustId, "roles", "new"))}
            leadingIcon={<Plus size={13} strokeWidth={1.8} />}
          >
            Role
          </Button>
        </div>
      </header>

      <section className="trust-roles-snapshot" aria-label="Snapshot">
        <SnapshotStat
          singular="Role"
          plural="Roles"
          value={snapshot.total}
          sublabel="Across this TRUST"
        />
        <SnapshotStat
          singular="Director"
          plural="Directors"
          value={snapshot.directors}
          sublabel="Stewardship authority"
        />
        <SnapshotStat
          singular="Operator"
          plural="Operators"
          value={snapshot.operational}
          sublabel="Execution authority"
        />
        <SnapshotStat
          singular="Vacant seat"
          plural="Vacant seats"
          value={snapshot.vacant}
          sublabel={snapshot.vacant === 0 ? "All seats filled" : "Awaiting an occupant"}
          tone={snapshot.vacant > 0 ? "warmth" : undefined}
        />
      </section>

      <div className="ideas-list-head">
        <div className="ideas-toolbar">
          <span className="ideas-list-search-field">
            <svg
              className="ideas-list-search-glyph"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              aria-hidden
            >
              <circle cx="5.2" cy="5.2" r="3.2" />
              <path d="M7.6 7.6 L10 10" />
            </svg>
            <input
              className="ideas-list-search"
              type="text"
              placeholder="Search roles"
              value={search}
              onChange={(e) => setFilter({ search: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === "Escape" && search) setFilter({ search: "" });
              }}
            />
            {search && (
              <button
                type="button"
                className="ideas-list-search-clear"
                onClick={() => setFilter({ search: "" })}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </span>
          <RolesSortPopover sort={sort} onChange={(next) => setFilter({ sort: next })} />
          <RolesFilterPopover
            filter={filter}
            occupantCounts={occupantCounts}
            onChange={setFilter}
          />
          <RolesViewPopover view={view} onChange={setView} />
        </div>
      </div>

      <div className="trust-roles-content">
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
              newRolePath={entityPathFromId(entities, trustId, "roles", "new")}
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
        {selectedRole && (
          <RoleInspector
            role={selectedRole}
            edges={edges}
            rolesById={rolesById}
            trustId={trustId}
            basePath={basePath}
          />
        )}
      </div>
    </div>
  );
}

interface SnapshotStatProps {
  /** Singular form — rendered when `value === 1`. */
  singular: string;
  /** Plural form — rendered for any value other than 1 (including 0). */
  plural: string;
  value: number;
  /** Optional one-line teaching text below the label — explains what
   * the stat means for new TRUST owners (e.g. "Stewardship authority"). */
  sublabel?: string;
  tone?: "warmth";
}

function SnapshotStat({ singular, plural, value, sublabel, tone }: SnapshotStatProps) {
  const label = value === 1 ? singular : plural;
  return (
    <div className="trust-roles-snapshot-stat">
      <span
        className={
          tone === "warmth"
            ? "trust-roles-snapshot-value trust-roles-snapshot-value--warmth"
            : "trust-roles-snapshot-value"
        }
      >
        {value}
      </span>
      <span className="trust-roles-snapshot-text">
        <span className="trust-roles-snapshot-label">{label}</span>
        {sublabel && <span className="trust-roles-snapshot-sublabel">{sublabel}</span>}
      </span>
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
