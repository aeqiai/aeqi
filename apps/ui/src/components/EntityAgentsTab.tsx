import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Agent, Role, RoleEdge } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { Button, EmptyState, Popover, Tooltip } from "./ui";
import AgentAvatar from "./AgentAvatar";
import { BlueprintPickerModal } from "@/components/blueprints/BlueprintPickerModal";
import { relativeTime } from "./ideas/types";
import { layoutChart, NODE_W, NODE_H } from "@/components/roles/layout";

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

  // Build pre-order tree traversal + depth map for the indented list view.
  // Each agent gets a depth (0 = root, 1 = direct report, 2 = grandchild, …).
  // Agents with no role entry land at the end with depth 0.
  const agentTreeData = useMemo(
    () => buildAgentTreeData(entityAgents, positions, edges),
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
        <AgentsList agents={filtered} treeData={agentTreeData} onSelect={openAgent} />
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

export interface AgentTreeEntry {
  agent: Agent;
  depth: number;
}

/**
 * Build a pre-order traversal of agents keyed by their position in the role DAG.
 *
 * Returns an ordered array where each entry carries the agent and its tree depth
 * (0 = root / C-suite, 1 = direct report, 2 = grandchild, …). Agents with no
 * role assignment are appended at the end with depth 0.
 *
 * Pre-order guarantees: parent always appears before its children; siblings are
 * ordered alphabetically by role title (stable, deterministic).
 */
function buildAgentTreeData(agents: Agent[], roles: Role[], edges: RoleEdge[]): AgentTreeEntry[] {
  if (roles.length === 0) {
    return agents.map((a) => ({ agent: a, depth: 0 }));
  }

  const roleById = new Map(roles.map((r) => [r.id, r]));
  const children = new Map<string, string[]>();
  const parentCount = new Map<string, number>();

  for (const r of roles) {
    children.set(r.id, []);
    parentCount.set(r.id, 0);
  }
  for (const e of edges) {
    if (!roleById.has(e.parent_role_id) || !roleById.has(e.child_role_id)) continue;
    children.get(e.parent_role_id)!.push(e.child_role_id);
    parentCount.set(e.child_role_id, (parentCount.get(e.child_role_id) ?? 0) + 1);
  }

  // Sort children alphabetically by role title for deterministic ordering.
  for (const [, kids] of children) {
    kids.sort((a, b) => {
      const ra = roleById.get(a);
      const rb = roleById.get(b);
      if (!ra || !rb) return 0;
      return ra.title.localeCompare(rb.title) || a.localeCompare(b);
    });
  }

  // Roots = roles with no parents in the valid edge set.
  const roots = roles
    .filter((r) => (parentCount.get(r.id) ?? 0) === 0)
    .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));

  // Build occupant → role map.
  const occupantRole = new Map<string, Role>();
  for (const r of roles) {
    if (r.occupant_kind === "agent" && r.occupant_id) {
      occupantRole.set(r.occupant_id, r);
    }
  }

  // Build agent lookup for fast access.
  const agentById = new Map(agents.map((a) => [a.id, a]));

  // Pre-order DFS: emit agent for each role node (if occupied by an agent in our list).
  const result: AgentTreeEntry[] = [];
  const emitted = new Set<string>();

  const visit = (roleId: string, depth: number): void => {
    const role = roleById.get(roleId);
    if (!role) return;
    if (role.occupant_kind === "agent" && role.occupant_id) {
      const agent = agentById.get(role.occupant_id);
      if (agent && !emitted.has(agent.id)) {
        result.push({ agent, depth });
        emitted.add(agent.id);
      }
    }
    for (const childId of children.get(roleId) ?? []) {
      visit(childId, depth + 1);
    }
  };

  for (const root of roots) {
    visit(root.id, 0);
  }

  // Append any agents not reached via the role DAG (unassigned).
  for (const agent of agents) {
    if (!emitted.has(agent.id)) {
      result.push({ agent, depth: 0 });
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
  treeData,
  onSelect,
}: {
  agents: Agent[];
  treeData: AgentTreeEntry[];
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

  // When a search/filter is active the `agents` array is a subset of the full
  // tree. Build a set of visible agent IDs and filter treeData to match,
  // preserving tree order (pre-order traversal) while honouring the filter.
  const visibleIds = new Set(agents.map((a) => a.id));
  const rows = treeData.filter((entry) => visibleIds.has(entry.agent.id));

  // Fallback: if treeData is not yet populated (roles still loading) but agents
  // are present, render them flat without indentation.
  if (rows.length === 0) {
    return (
      <div className="ideas-list-body">
        {agents.map((a) => (
          <AgentRow key={a.id} agent={a} depth={0} onSelect={onSelect} />
        ))}
      </div>
    );
  }

  return (
    <div className="ideas-list-body">
      {rows.map(({ agent, depth }) => (
        <AgentRow key={agent.id} agent={agent} depth={depth} onSelect={onSelect} />
      ))}
    </div>
  );
}

const INDENT_PX = 24;

function AgentRow({
  agent: a,
  depth,
  onSelect,
}: {
  agent: Agent;
  depth: number;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="ideas-list-row"
      onClick={() => onSelect(a.id)}
      style={depth > 0 ? { paddingLeft: depth * INDENT_PX + 16 } : undefined}
    >
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
 * Pure layered-DAG chart over agent-occupied roles.
 *
 * Uses `layoutChart` (Sugiyama-lite) directly over the operational
 * role DAG. CEO at layer 0; direct reports at layer 1; grandchildren
 * at layer 2; etc. No painted department-cluster envelopes — hierarchy
 * is expressed by vertical position and connecting bezier edges.
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

  // Only operational roles feed the tree layout (directors/advisors
  // are governance tiers, not org-chart nodes).
  const opPositions = positions.filter((r) => r.role_type === "operational");
  const opIds = new Set(opPositions.map((r) => r.id));
  const opEdges = edges.filter((e) => opIds.has(e.parent_role_id) && opIds.has(e.child_role_id));
  const treeLayout = layoutChart(opPositions, opEdges);

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
      <div
        className="roles-chart-canvas"
        style={{ position: "relative", width: treeLayout.width, height: treeLayout.height }}
        role="figure"
        aria-label="Agents org chart"
      >
        <svg
          className="roles-chart-edges"
          width={treeLayout.width}
          height={treeLayout.height}
          viewBox={`0 0 ${treeLayout.width} ${treeLayout.height}`}
          aria-hidden
        >
          {treeLayout.edges.map((e, i) => {
            const x1 = e.from.x + NODE_W / 2;
            const y1 = e.from.y + NODE_H;
            const x2 = e.to.x + NODE_W / 2;
            const y2 = e.to.y;
            const midY = (y1 + y2) / 2;
            const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
            return <path key={i} d={d} className="roles-chart-edge-path" />;
          })}
        </svg>
        {treeLayout.nodes.map((n) => (
          <AgentCard
            key={n.role.id}
            role={n.role}
            agent={n.role.occupant_id ? agentById.get(n.role.occupant_id) : undefined}
            apex={n.layer === 0}
            onSelect={onSelect}
            style={{
              position: "absolute",
              left: n.x,
              top: n.y,
              width: NODE_W,
              minHeight: NODE_H,
            }}
          />
        ))}
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
