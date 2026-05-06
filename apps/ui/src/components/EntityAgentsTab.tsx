import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Agent, Role, RoleEdge } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { Button, EmptyState, Popover, Tooltip } from "./ui";
import AgentAvatar from "./AgentAvatar";
import { BlueprintPickerModal } from "@/components/blueprints/BlueprintPickerModal";
import { relativeTime } from "./ideas/types";
import { layoutDepts, NODE_W, NODE_H } from "@/components/roles/layout";

type ViewMode = "list" | "chart";
type SortMode = "recent" | "alpha-asc" | "alpha-desc" | "active";
type StatusFilter = "all" | "active" | "stopped" | "inactive";

const VIEW_LABELS: Record<ViewMode, string> = {
  list: "List",
  chart: "Chart",
};
const VIEW_ORDER: ViewMode[] = ["list", "chart"];
const VIEW_VALUES = new Set<ViewMode>(VIEW_ORDER);

const SORT_LABELS: Record<SortMode, string> = {
  recent: "Recently created",
  "alpha-asc": "Name (A→Z)",
  "alpha-desc": "Name (Z→A)",
  active: "Activity",
};
const SORT_ORDER: SortMode[] = ["recent", "alpha-asc", "alpha-desc", "active"];
const SORT_VALUES = new Set<SortMode>(SORT_ORDER);

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  active: "Active",
  stopped: "Stopped",
  inactive: "Inactive",
};
const STATUS_ORDER: StatusFilter[] = ["all", "active", "stopped", "inactive"];
const STATUS_VALUES = new Set<StatusFilter>(STATUS_ORDER);

/**
 * Agents tab. Lists every agent inside the active entity — root and seeds —
 * with the canonical search · sort · filter · view toolbar shipped on Ideas
 * and Blueprints. State (q, sort, filter, view) persists in the URL via the
 * same `patchParams` idiom Ideas / Quests / Positions adopted.
 *
 * List view groups agents by department (the parent role's title for each
 * C-suite head in the DAG). Agents whose role has no parent are grouped
 * under the C-suite label directly; agents with no role at all fall into
 * "Unassigned".
 *
 * Chart view mirrors EntityPositionsTab's layered-DAG renderer so both
 * tabs answer the same shape from different lenses — Positions reads
 * "what slots exist", Agents-chart reads "who fills those slots".
 */
export default function EntityAgentsTab({ entityId }: { entityId: string }) {
  const navigate = useNavigate();
  const openAgent = useCallback(
    (agentId: string) =>
      navigate(`/c/${encodeURIComponent(entityId)}/agents/${encodeURIComponent(agentId)}`),
    [navigate, entityId],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  const search = searchParams.get("q") ?? "";
  const sortRaw = searchParams.get("sort");
  const sort: SortMode = SORT_VALUES.has(sortRaw as SortMode) ? (sortRaw as SortMode) : "recent";
  const viewRaw = searchParams.get("view");
  const view: ViewMode = VIEW_VALUES.has(viewRaw as ViewMode) ? (viewRaw as ViewMode) : "list";
  const statusRaw = searchParams.get("status");
  const status: StatusFilter = STATUS_VALUES.has(statusRaw as StatusFilter)
    ? (statusRaw as StatusFilter)
    : "all";

  // `s.agents` is a directory union (every company-root from
  // /api/entities + the active scope's /api/agents subtree); without
  // this filter the tab renders the sidebar entity switcher.
  const allAgents = useDaemonStore((s) => s.agents);
  const entityAgents = useMemo(
    () => allAgents.filter((a) => a.entity_id === entityId),
    [allAgents, entityId],
  );

  // Roles + edges are used by both the list view (grouping) and the chart
  // view. Load once for the entity and share across both views.
  const [positions, setPositions] = useState<Role[]>([]);
  const [edges, setEdges] = useState<RoleEdge[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRolesLoading(true);
    setChartError(null);
    api
      .getRoles(entityId)
      .then((resp) => {
        if (cancelled) return;
        setPositions(resp.roles ?? []);
        setEdges(resp.edges ?? []);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setChartError(e.message || "Could not load roles.");
      })
      .finally(() => {
        if (!cancelled) setRolesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  const patchParams = useCallback(
    (mut: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(searchParams);
      mut(next);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const setSearchParam = useCallback(
    (key: string, value: string | null) => {
      patchParams((p) => {
        if (value === null || value === "") p.delete(key);
        else p.set(key, value);
      });
    },
    [patchParams],
  );

  // "+ New agent" — listen for the global aeqi:create event so the
  // composer key path (`+`) and the toolbar button share a single entry
  // point. Mirrors AgentsTab's prior wiring.
  const openPicker = useCallback(() => setPickerOpen(true), []);
  useEffect(() => {
    window.addEventListener("aeqi:create", openPicker);
    return () => window.removeEventListener("aeqi:create", openPicker);
  }, [openPicker]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = entityAgents.slice();
    if (status !== "all") {
      rows = rows.filter((a) => bucketStatus(a.status) === status);
    }
    if (q) {
      rows = rows.filter((a) => {
        if (a.name.toLowerCase().includes(q)) return true;
        if (a.id.toLowerCase().includes(q)) return true;
        return false;
      });
    }
    rows.sort((a, b) => compareAgents(a, b, sort));
    return rows;
  }, [entityAgents, search, sort, status]);

  // Build agent → department label mapping from the role DAG.
  // Department = the title of the direct child of the root role (C-suite head).
  // Agents in the root role itself get their own role title as the label.
  // Agents with no role → "Unassigned".
  const agentDeptLabel = useMemo(
    () => buildDeptMap(entityAgents, positions, edges),
    [entityAgents, positions, edges],
  );

  // Active-filter chip strip mirrors IdeasListView — only renders when
  // a non-resting filter is in play.
  const activeChips: { key: string; label: string; onRemove: () => void }[] = [];
  if (status !== "all") {
    activeChips.push({
      key: "status",
      label: STATUS_LABELS[status],
      onRemove: () => setSearchParam("status", null),
    });
  }

  // "/" focuses search; Esc clears or blurs.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tgt = e.target as HTMLElement | null;
      const inInput =
        tgt?.tagName === "INPUT" || tgt?.tagName === "TEXTAREA" || tgt?.isContentEditable;
      if (inInput) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
  }, []);

  return (
    <div className="ideas-list">
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
              ref={searchRef}
              className="ideas-list-search"
              type="text"
              placeholder="Search agents"
              value={search}
              onChange={(e) => setSearchParam("q", e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  if (search) setSearchParam("q", "");
                  else (e.target as HTMLInputElement).blur();
                }
              }}
            />
            {!search && (
              <kbd className="ideas-list-search-kbd" aria-hidden>
                /
              </kbd>
            )}
            {search && (
              <button
                type="button"
                className="ideas-list-search-clear"
                onClick={() => setSearchParam("q", "")}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </span>

          <ToolbarRadioPopover
            label="Sort"
            current={SORT_LABELS[sort]}
            glyph={GLYPHS.sort}
            options={SORT_ORDER.map((s) => ({ id: s, label: SORT_LABELS[s] }))}
            value={sort}
            onChange={(next) => setSearchParam("sort", next === "recent" ? null : next)}
          />

          <ToolbarRadioPopover
            label="Filter"
            current={STATUS_LABELS[status]}
            glyph={GLYPHS.filter}
            options={STATUS_ORDER.map((s) => ({ id: s, label: STATUS_LABELS[s] }))}
            value={status}
            onChange={(next) => setSearchParam("status", next === "all" ? null : next)}
            indicator={status !== "all"}
          />

          <ToolbarRadioPopover
            label="View"
            current={VIEW_LABELS[view]}
            glyph={GLYPHS.view}
            options={VIEW_ORDER.map((v) => ({ id: v, label: VIEW_LABELS[v] }))}
            value={view}
            onChange={(next) => setSearchParam("view", next === "list" ? null : next)}
          />

          <Tooltip content="New agent">
            <Button variant="primary" size="sm" onClick={openPicker}>
              <svg
                width="11"
                height="11"
                viewBox="0 0 13 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                aria-hidden
              >
                <path d="M6.5 2.5v8M2.5 6.5h8" />
              </svg>
              New
            </Button>
          </Tooltip>
        </div>
      </div>

      {activeChips.length > 0 && (
        <div className="ideas-tags-strip">
          <div className="ideas-list-chips" role="list" aria-label="Active filters">
            {activeChips.map((c) => (
              <button
                key={c.key}
                type="button"
                role="listitem"
                className="ideas-list-chip"
                onClick={c.onRemove}
                title={`Remove ${c.label}`}
              >
                <span className="ideas-list-chip-label">{c.label}</span>
                <span className="ideas-list-chip-x" aria-hidden>
                  ×
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {entityAgents.length === 0 ? (
        <div className="ideas-list-body">
          <AgentsEmptyState onNew={openPicker} />
        </div>
      ) : view === "list" ? (
        <AgentsList agents={filtered} deptLabel={agentDeptLabel} onSelect={openAgent} />
      ) : (
        <AgentsChart
          positions={positions}
          edges={edges}
          entityAgents={entityAgents}
          loading={rolesLoading}
          error={chartError}
          onSelect={openAgent}
        />
      )}

      <BlueprintPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        entityId={entityId}
      />
    </div>
  );
}

// Map raw agent.status string into the three buckets the filter exposes.
// Anything other than "active" / "stopped" reads as "inactive" (idle,
// paused, archived, unknown — every quiet state collapses into one).
function bucketStatus(raw: string | undefined): StatusFilter {
  if (raw === "active") return "active";
  if (raw === "stopped") return "stopped";
  return "inactive";
}

function compareAgents(a: Agent, b: Agent, mode: SortMode): number {
  switch (mode) {
    case "alpha-asc":
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    case "alpha-desc":
      return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
    case "active": {
      const ta = a.last_active ? Date.parse(a.last_active) : 0;
      const tb = b.last_active ? Date.parse(b.last_active) : 0;
      return tb - ta;
    }
    case "recent":
    default: {
      const ta = a.created_at ? Date.parse(a.created_at) : 0;
      const tb = b.created_at ? Date.parse(b.created_at) : 0;
      return tb - ta;
    }
  }
}

/**
 * Build a map of agentId → department label.
 *
 * Department = the title of the role that is a direct child of the DAG
 * root (i.e. the C-suite head). For example:
 *   CEO → CTO → Backend Engineer  →  label "CTO"
 *   CEO → CMO → Content Writer    →  label "CMO"
 *   CEO (root) directly            →  label "C-suite" / root title
 *   No role found                  →  "Unassigned"
 */
function buildDeptMap(agents: Agent[], roles: Role[], edges: RoleEdge[]): Map<string, string> {
  const result = new Map<string, string>();
  if (roles.length === 0) return result;

  const roleById = new Map(roles.map((r) => [r.id, r]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const r of roles) {
    incoming.set(r.id, []);
    outgoing.set(r.id, []);
  }
  for (const e of edges) {
    if (!roleById.has(e.parent_role_id) || !roleById.has(e.child_role_id)) continue;
    incoming.get(e.child_role_id)!.push(e.parent_role_id);
    outgoing.get(e.parent_role_id)!.push(e.child_role_id);
  }

  // Identify the root role(s) — no incoming edges in this entity.
  const rootIds = new Set(
    roles.filter((r) => (incoming.get(r.id) ?? []).length === 0).map((r) => r.id),
  );

  // Walk up from a role to find the department head (direct child of root).
  // Returns the role id of the dept head, or null if the role IS the root.
  function deptHead(roleId: string, visited: Set<string>): string | null {
    if (visited.has(roleId)) return null;
    visited.add(roleId);
    const parents = incoming.get(roleId) ?? [];
    if (parents.length === 0) return null; // this role is a root
    for (const parentId of parents) {
      if (rootIds.has(parentId)) return roleId; // direct child of root = dept head
      const ancestor = deptHead(parentId, visited);
      if (ancestor) return ancestor;
    }
    return null;
  }

  // Map: roleId → dept label
  const roleDeptLabel = new Map<string, string>();
  for (const role of roles) {
    if (rootIds.has(role.id)) {
      roleDeptLabel.set(role.id, role.title);
      continue;
    }
    const head = deptHead(role.id, new Set());
    if (head) {
      roleDeptLabel.set(role.id, roleById.get(head)?.title ?? "Other");
    } else {
      roleDeptLabel.set(role.id, "Other");
    }
  }

  // Build occupant → role map.
  const occupantRole = new Map<string, Role>();
  for (const r of roles) {
    if (r.occupant_kind === "agent" && r.occupant_id) {
      occupantRole.set(r.occupant_id, r);
    }
  }

  for (const agent of agents) {
    const role = occupantRole.get(agent.id);
    if (!role) {
      result.set(agent.id, "Unassigned");
    } else {
      result.set(agent.id, roleDeptLabel.get(role.id) ?? "Other");
    }
  }

  return result;
}

function AgentsEmptyState({ onNew }: { onNew: () => void }) {
  return (
    <EmptyState
      eyebrow="Agents"
      title="No agents in this company yet."
      description="Pick a Blueprint and its agents join the tree."
      action={
        <Button variant="primary" onClick={onNew}>
          New agent
        </Button>
      }
    />
  );
}

function AgentsList({
  agents,
  deptLabel,
  onSelect,
}: {
  agents: Agent[];
  deptLabel: Map<string, string>;
  onSelect: (id: string) => void;
}) {
  if (agents.length === 0) {
    return (
      <div className="ideas-list-body">
        <EmptyState
          title="No agents match these filters."
          description="Drop a chip or clear the search to bring rows back."
        />
      </div>
    );
  }

  // Group agents by department label, preserving relative sort order within
  // each group. Department order: root title first, then alphabetical dept
  // names, then "Unassigned" last.
  const groups = new Map<string, Agent[]>();
  for (const agent of agents) {
    const label = deptLabel.get(agent.id) ?? "Unassigned";
    const bucket = groups.get(label) ?? [];
    bucket.push(agent);
    groups.set(label, bucket);
  }

  const sortedLabels = Array.from(groups.keys()).sort((a, b) => {
    if (a === "Unassigned") return 1;
    if (b === "Unassigned") return -1;
    return a.localeCompare(b);
  });

  // If every agent belongs to one label (no real grouping), render flat.
  if (sortedLabels.length <= 1) {
    return (
      <div className="ideas-list-body">
        {agents.map((a) => (
          <AgentRow key={a.id} agent={a} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <div className="ideas-list-body">
      {sortedLabels.map((label) => (
        <div key={label}>
          <div className="agents-group-label">{label}</div>
          {(groups.get(label) ?? []).map((a) => (
            <AgentRow key={a.id} agent={a} onSelect={onSelect} />
          ))}
        </div>
      ))}
    </div>
  );
}

function AgentRow({ agent: a, onSelect }: { agent: Agent; onSelect: (id: string) => void }) {
  return (
    <button type="button" className="ideas-list-row" onClick={() => onSelect(a.id)}>
      <div className="ideas-list-row-head">
        <span aria-hidden style={{ display: "inline-flex", alignItems: "center" }}>
          <AgentAvatar name={a.name} />
        </span>
        <span className="ideas-list-row-name">{a.name}</span>
        {a.model && <span className="ideas-list-row-more">{a.model}</span>}
        <span
          className="ideas-list-row-more"
          style={{ display: "inline-flex", alignItems: "center" }}
        >
          <span
            className={`agent-settings-status-dot${a.status === "active" ? " live" : ""}`}
            aria-hidden
          />
          {a.status || "unknown"}
        </span>
        <span className="ideas-list-row-time">{relativeTime(a.last_active) || "—"}</span>
      </div>
    </button>
  );
}

/**
 * Department-clustered chart over agent-occupied roles.
 *
 * Uses the same `layoutDepts` algorithm as the Roles chart so both
 * tabs share one mental model. CEO sits above a row of department
 * cluster columns. Each cluster shows cards for every role in that
 * subtree, resolved to their agent occupant where one exists.
 *
 * Unoccupied roles render as muted vacant placeholders so the shape
 * of the org is visible even when agents haven't been assigned yet.
 */
function AgentsChart({
  positions,
  edges,
  entityAgents,
  loading,
  error,
  onSelect,
}: {
  positions: Role[];
  edges: RoleEdge[];
  entityAgents: Agent[];
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
}) {
  const agentById = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of entityAgents) m.set(a.id, a);
    return m;
  }, [entityAgents]);

  if (loading) {
    return (
      <div className="ideas-list-body" style={{ color: "var(--color-text-muted)" }}>
        Loading org chart…
      </div>
    );
  }
  if (error) {
    return (
      <div className="ideas-list-body" style={{ color: "var(--color-error)" }}>
        {error}
      </div>
    );
  }

  // Only operational roles feed the dept-cluster layout (directors/advisors
  // are governance tiers, not org-chart nodes).
  const opPositions = positions.filter((r) => r.role_type === "operational");
  const opIds = new Set(opPositions.map((r) => r.id));
  const opEdges = edges.filter((e) => opIds.has(e.parent_role_id) && opIds.has(e.child_role_id));
  const deptLayout = layoutDepts(opPositions, opEdges);

  if (opPositions.length === 0) {
    return (
      <div className="ideas-list-body">
        <EmptyState
          title="No org chart yet."
          description="Roles appear once a Blueprint finishes seeding."
        />
      </div>
    );
  }

  return (
    <div className="ideas-list-body" style={{ padding: "24px 28px 48px", overflowX: "auto" }}>
      <div className="roles-chart-dept-root" role="figure" aria-label="Agents org chart">
        {deptLayout.ceo && (
          <div className="roles-chart-ceo-row">
            <AgentCard
              role={deptLayout.ceo}
              agent={
                deptLayout.ceo.occupant_id ? agentById.get(deptLayout.ceo.occupant_id) : undefined
              }
              apex
              onSelect={onSelect}
              style={{ width: NODE_W, minHeight: NODE_H }}
            />
          </div>
        )}
        {deptLayout.clusters.length > 0 && (
          <div className="roles-chart-dept-row">
            {deptLayout.clusters.map((cluster) => (
              <div
                key={cluster.head.id}
                className="roles-chart-dept-cluster"
                aria-label={cluster.head.title}
              >
                <div className="roles-chart-dept-label">{cluster.head.title}</div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                    alignItems: "stretch",
                  }}
                >
                  {cluster.layout.nodes.map((n) => (
                    <AgentCard
                      key={n.role.id}
                      role={n.role}
                      agent={n.role.occupant_id ? agentById.get(n.role.occupant_id) : undefined}
                      onSelect={onSelect}
                      style={{ width: NODE_W, minHeight: NODE_H }}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  role,
  agent,
  apex = false,
  onSelect,
  style,
}: {
  role: Role;
  agent: Agent | undefined;
  apex?: boolean;
  onSelect: (id: string) => void;
  style?: React.CSSProperties;
}) {
  const clickable = !!agent;
  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => agent && onSelect(agent.id)}
      style={{
        ...style,
        padding: apex ? "12px 16px" : "10px 14px",
        background: "var(--color-card-elevated)",
        border: 0,
        borderRadius: "var(--radius-md)",
        textAlign: "left",
        font: "inherit",
        color: "inherit",
        cursor: clickable ? "pointer" : "default",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      {agent ? (
        <span aria-hidden style={{ display: "inline-flex", flexShrink: 0 }}>
          <AgentAvatar name={agent.name} />
        </span>
      ) : (
        <span
          aria-hidden
          style={{
            display: "inline-flex",
            flexShrink: 0,
            width: 28,
            height: 28,
            borderRadius: "999px",
            background: "var(--bg-row)",
          }}
        />
      )}
      <span style={{ display: "inline-flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13,
            fontWeight: apex ? 600 : 500,
            color: agent ? "var(--color-text-primary)" : "var(--color-text-secondary)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {agent?.name ?? "(vacant)"}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--color-text-muted)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {role.title}
        </span>
        {agent && (
          <span
            style={{
              fontSize: 11,
              color: "var(--color-text-muted)",
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <span
              className={`agent-settings-status-dot${agent.status === "active" ? " live" : ""}`}
              aria-hidden
            />
            {agent.status || "unknown"}
          </span>
        )}
      </span>
    </button>
  );
}

interface ToolbarRadioPopoverProps<T extends string> {
  label: string;
  current: string;
  glyph: ReactElement;
  options: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  indicator?: boolean;
}

function ToolbarRadioPopover<T extends string>({
  label,
  current,
  glyph,
  options,
  value,
  onChange,
  indicator,
}: ToolbarRadioPopoverProps<T>) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={`ideas-toolbar-btn${indicator ? " active" : ""}${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          title={`${label}: ${current}`}
        >
          {glyph}
          {indicator && <span className="ideas-toolbar-btn-dot" aria-hidden />}
        </button>
      }
    >
      <div className="ideas-filter-popover" role="dialog" aria-label={label}>
        <header className="ideas-filter-popover-head">
          <span className="ideas-filter-popover-label">{label.toLowerCase()}</span>
        </header>
        <div className="ideas-filter-popover-list" role="radiogroup" aria-label={label}>
          {options.map((opt) => {
            const isActive = value === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                className={`ideas-filter-row${isActive ? " active" : ""}`}
                onClick={() => {
                  onChange(opt.id);
                  setOpen(false);
                }}
              >
                <span className="ideas-filter-row-label">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </Popover>
  );
}

const GLYPHS = {
  sort: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path d="M3 3.5h7M3 6.5h5M3 9.5h3" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  filter: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path d="M2 3.25h9M3.5 6.5h6M5 9.75h3" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  ),
  view: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <rect x="2" y="2" width="3.5" height="3.5" strokeWidth="1.2" rx="0.4" />
      <rect x="7.5" y="2" width="3.5" height="3.5" strokeWidth="1.2" rx="0.4" />
      <rect x="2" y="7.5" width="3.5" height="3.5" strokeWidth="1.2" rx="0.4" />
      <rect x="7.5" y="7.5" width="3.5" height="3.5" strokeWidth="1.2" rx="0.4" />
    </svg>
  ),
} as const;
