import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Role, RoleEdge } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
import "@/styles/roles.css";
import { Button, EmptyState, Tooltip } from "./ui";
import RolesChart from "./roles/RolesChart";
import RolesCards from "./roles/RolesCards";
import RolesList from "./roles/RolesList";
import RolesSortPopover from "./roles/RolesSortPopover";
import RolesFilterPopover from "./roles/RolesFilterPopover";
import RolesViewPopover from "./roles/RolesViewPopover";
import {
  type OccupantFilter,
  type RolesFilterState,
  parseOccupantFilter,
  parseSort,
  parseView,
} from "./roles/types";

const OCCUPANT_RANK: Record<string, number> = { agent: 0, human: 1, vacant: 2 };

/**
 * Roles — the company org-chart surface.
 *
 * Hero is the layered DAG (`view=chart`, default). `view=cards` and
 * `view=list` are alternates for dense overviews. Toolbar grammar
 * mirrors Ideas: search · sort · filter · view · + new. State persists
 * in URL search params so a tab switch round-trip preserves the frame.
 *
 * Roles are seeded automatically when an entity is spawned from a
 * Blueprint — every seeded agent gets a fresh role, and every
 * delegation edge becomes a role edge. The "+ New role" affordance
 * appends additional slots (vacant or occupied) inside the entity's
 * DAG.
 */
export default function EntityRolesTab({ entityId }: { entityId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const view = parseView(searchParams.get("view"));
  const sort = parseSort(searchParams.get("sort"));
  const occupantFilter = parseOccupantFilter(searchParams.get("occupant"));
  const search = searchParams.get("q") ?? "";

  const [roles, setRoles] = useState<Role[]>([]);
  const [edges, setEdges] = useState<RoleEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const agents = useDaemonStore((s) => s.agents);
  const entities = useDaemonStore((s) => s.entities);
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getRoles(entityId)
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
  }, [entityId]);

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

  const handleSelectRole = useCallback(
    (role: Role) => {
      navigate(entityPathFromId(entities, entityId, "roles", encodeURIComponent(role.id)));
    },
    [navigate, entityId, entities],
  );

  const showEmpty = !loading && !error && roles.length === 0;
  const showNoMatch = !loading && !error && roles.length > 0 && filtered.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
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
          <Tooltip content="New role">
            <Button
              variant="primary"
              size="sm"
              onClick={() => navigate(entityPathFromId(entities, entityId, "roles", "new"))}
              leadingIcon={
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 13 13"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  aria-hidden
                >
                  <path d="M6.5 2.5v8M2.5 6.5h8" />
                </svg>
              }
            >
              New
            </Button>
          </Tooltip>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {loading && <RolesLoading />}
        {error && <RolesError message={error} />}
        {showEmpty && <RolesEmptyState />}
        {showNoMatch && <RolesNoMatch onReset={() => setFilter({ search: "", occupant: "all" })} />}
        {!loading && !error && filtered.length > 0 && view === "chart" && (
          <RolesChart
            roles={filtered}
            edges={filteredEdges}
            agentNames={agentNames}
            agentAvatars={agentAvatars}
            onSelectRole={handleSelectRole}
          />
        )}
        {!loading && !error && filtered.length > 0 && view === "cards" && (
          <div style={{ flex: 1, overflow: "auto" }}>
            <RolesCards
              roles={filtered}
              agentNames={agentNames}
              agentAvatars={agentAvatars}
              onSelectRole={handleSelectRole}
            />
          </div>
        )}
        {!loading && !error && filtered.length > 0 && view === "list" && (
          <div style={{ flex: 1, overflow: "auto" }}>
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
    </div>
  );
}

function RolesLoading() {
  return (
    <div style={{ padding: "24px 28px", color: "var(--color-text-muted)" }}>Loading roles…</div>
  );
}

function RolesError({ message }: { message: string }) {
  return <div style={{ padding: "24px 28px", color: "var(--color-error)" }}>{message}</div>;
}

function RolesEmptyState() {
  return (
    <div style={{ padding: "48px 28px" }}>
      <EmptyState
        title="No roles yet"
        description="Roles appear automatically when this entity has agents. They'll show up here as soon as the Blueprint finishes seeding."
      />
    </div>
  );
}

function RolesNoMatch({ onReset }: { onReset: () => void }) {
  return (
    <div style={{ padding: "48px 28px" }}>
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
