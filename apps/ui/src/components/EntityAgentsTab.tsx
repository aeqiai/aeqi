import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useSearchParams } from "react-router-dom";
import { useNav } from "@/hooks/useNav";
import { api } from "@/lib/api";
import type { Agent, Position, PositionEdge } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { Button, EmptyState, Popover, Tooltip } from "./ui";
import AgentAvatar from "./AgentAvatar";
import { BlueprintPickerModal } from "@/components/blueprints/BlueprintPickerModal";
import { relativeTime } from "./ideas/types";

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
 * "+ New agent" opens the shared BlueprintPickerModal, which spawns the
 * picked blueprint into this entity. Same modal as `/start`; only the
 * destination differs.
 *
 * Chart view mirrors EntityPositionsTab's layered-DAG renderer so both
 * tabs answer the same shape from different lenses — Positions reads
 * "what slots exist", Agents-chart reads "who fills those slots".
 */
export default function EntityAgentsTab({ entityId }: { entityId: string }) {
  const { goAgent } = useNav();
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

  // Show ALL agents — no entity filter. Agents are global assets; an
  // agent may be owned by entity X and hold a position in entity Y, or
  // hold no position at all. The Agents tab lists every agent the user
  // has visibility on; sort / filter / search narrow from there.
  const allAgents = useDaemonStore((s) => s.agents);
  const entityAgents = allAgents;

  // Positions + edges drive the chart view. Loaded lazily so the list
  // view doesn't pay the round-trip when chart isn't requested.
  const [positions, setPositions] = useState<Position[]>([]);
  const [edges, setEdges] = useState<PositionEdge[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (view !== "chart") return;
    let cancelled = false;
    setChartLoading(true);
    setChartError(null);
    api
      .getPositions(entityId)
      .then((resp) => {
        if (cancelled) return;
        setPositions(resp.positions ?? []);
        setEdges(resp.edges ?? []);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setChartError(e.message || "Could not load org chart.");
      })
      .finally(() => {
        if (!cancelled) setChartLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view, entityId]);

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
        <AgentsList agents={filtered} onSelect={(id) => goAgent(id, "sessions")} />
      ) : (
        <AgentsChart
          positions={positions}
          edges={edges}
          entityAgents={entityAgents}
          loading={chartLoading}
          error={chartError}
          onSelect={(id) => goAgent(id, "sessions")}
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

function AgentsList({ agents, onSelect }: { agents: Agent[]; onSelect: (id: string) => void }) {
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
  return (
    <div className="ideas-list-body">
      {agents.map((a) => (
        <button key={a.id} type="button" className="ideas-list-row" onClick={() => onSelect(a.id)}>
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
      ))}
    </div>
  );
}

/**
 * Layered DAG over positions + edges, with each card resolving its
 * agent occupant to an avatar + status dot. Lifted from
 * EntityPositionsTab — same algorithm, different cell content.
 */
function AgentsChart({
  positions,
  edges,
  entityAgents,
  loading,
  error,
  onSelect,
}: {
  positions: Position[];
  edges: PositionEdge[];
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
      <div className="ideas-list-body" style={{ color: "var(--text-muted)" }}>
        Loading org chart…
      </div>
    );
  }
  if (error) {
    return (
      <div className="ideas-list-body" style={{ color: "var(--color-error, #c2410c)" }}>
        {error}
      </div>
    );
  }
  const layers = layoutPositions(positions, edges);
  if (layers.length === 0) {
    return (
      <div className="ideas-list-body">
        <EmptyState
          title="No org chart yet."
          description="Positions appear once a Blueprint finishes seeding."
        />
      </div>
    );
  }
  return (
    <div className="ideas-list-body" style={{ padding: "24px 28px 48px" }}>
      {layers.map((layer, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 16,
            marginBottom: i === layers.length - 1 ? 0 : 32,
            flexWrap: "wrap",
          }}
        >
          {layer.map((p) => {
            const occupant = p.occupant_id ? agentById.get(p.occupant_id) : undefined;
            const clickable = !!occupant;
            return (
              <button
                key={p.id}
                type="button"
                disabled={!clickable}
                onClick={() => occupant && onSelect(occupant.id)}
                style={{
                  minWidth: 200,
                  padding: "12px 16px",
                  background: "var(--color-card)",
                  border: 0,
                  borderRadius: "var(--radius-md)",
                  textAlign: "left",
                  font: "inherit",
                  color: "inherit",
                  cursor: clickable ? "pointer" : "default",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  {occupant && (
                    <span aria-hidden style={{ display: "inline-flex" }}>
                      <AgentAvatar name={occupant.name} />
                    </span>
                  )}
                  <span style={{ fontWeight: 500 }}>{occupant?.name || p.title || "(vacant)"}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{p.title}</div>
                {occupant && (
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      marginTop: 4,
                    }}
                  >
                    <span
                      className={`agent-settings-status-dot${
                        occupant.status === "active" ? " live" : ""
                      }`}
                      aria-hidden
                    />
                    {occupant.status || "unknown"}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function layoutPositions(positions: Position[], edges: PositionEdge[]): Position[][] {
  if (positions.length === 0) return [];
  const byId = new Map(positions.map((p) => [p.id, p]));
  const incoming = new Map<string, string[]>();
  for (const p of positions) incoming.set(p.id, []);
  for (const e of edges) {
    if (!byId.has(e.parent_position_id) || !byId.has(e.child_position_id)) continue;
    incoming.get(e.child_position_id)!.push(e.parent_position_id);
  }
  const depth = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = incoming.get(id) ?? [];
    if (parents.length === 0) {
      depth.set(id, 0);
      return 0;
    }
    let d = 0;
    for (const parent of parents) {
      d = Math.max(d, visit(parent, seen) + 1);
    }
    depth.set(id, d);
    return d;
  };
  for (const p of positions) visit(p.id, new Set());
  const maxDepth = Math.max(...Array.from(depth.values()));
  const layers: Position[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const p of positions) layers[depth.get(p.id) ?? 0].push(p);
  for (const layer of layers) layer.sort((a, b) => a.title.localeCompare(b.title));
  return layers;
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
