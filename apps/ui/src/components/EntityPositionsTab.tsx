import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Position, PositionEdge } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { Button, EmptyState, Input } from "./ui";
import NewPositionModal from "./positions/NewPositionModal";

type ViewMode = "list" | "chart";
type SortMode = "title" | "kind" | "created";

const VIEW_VALUES: ViewMode[] = ["list", "chart"];
const SORT_VALUES: SortMode[] = ["title", "kind", "created"];

const parseView = (raw: string | null): ViewMode =>
  raw && (VIEW_VALUES as string[]).includes(raw) ? (raw as ViewMode) : "list";

const parseSort = (raw: string | null): SortMode =>
  raw && (SORT_VALUES as string[]).includes(raw) ? (raw as SortMode) : "title";

/**
 * Positions tab. The org-chart of an entity. Two views: a flat list and a
 * layered DAG chart. Filter + sort + view live in the URL so switching
 * tabs and back preserves state.
 *
 * Positions are seeded automatically when an entity is spawned from a
 * Blueprint — every seeded agent gets a position whose `id == agent.id`,
 * and every parent_id link becomes a `position_edge`. The "+ New
 * position" affordance for vacant slots / human seats is intentionally
 * deferred until the spawn flow + DAG-edit primitives are richer.
 */
export default function EntityPositionsTab({ entityId }: { entityId: string }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseView(searchParams.get("view"));
  const sort = parseSort(searchParams.get("sort"));
  const search = searchParams.get("q") ?? "";

  const [positions, setPositions] = useState<Position[]>([]);
  const [edges, setEdges] = useState<PositionEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  // Map agent_id → agent for resolving occupant labels. The daemon store
  // already fetches the agent subtree; we just look up by id.
  const agents = useDaemonStore((s) => s.agents);
  const agentById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    for (const a of agents) m.set(a.id, { id: a.id, name: a.name });
    return m;
  }, [agents]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getPositions(entityId)
      .then((resp) => {
        if (cancelled) return;
        setPositions(resp.positions ?? []);
        setEdges(resp.edges ?? []);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Could not load positions.");
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let rows = positions.slice();
    if (q) {
      rows = rows.filter((p) => {
        if (p.title.toLowerCase().includes(q)) return true;
        if (p.occupant_id) {
          const occ = agentById.get(p.occupant_id);
          if (occ && occ.name.toLowerCase().includes(q)) return true;
        }
        return false;
      });
    }
    rows.sort((a, b) => {
      switch (sort) {
        case "kind":
          return a.occupant_kind.localeCompare(b.occupant_kind) || a.title.localeCompare(b.title);
        case "created":
          return a.created_at.localeCompare(b.created_at);
        case "title":
        default:
          return a.title.localeCompare(b.title);
      }
    });
    return rows;
  }, [positions, search, sort, agentById]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div className="ideas-list-head ideas-toolbar">
        <Input
          placeholder="Search positions"
          value={search}
          onChange={(e) =>
            patchParams((p) => {
              if (e.target.value) p.set("q", e.target.value);
              else p.delete("q");
            })
          }
          className="ideas-list-search-field"
        />
        <div className="ideas-toolbar-meta">
          <button
            type="button"
            className={`ideas-toolbar-btn ${sort !== "title" ? "active" : ""}`}
            onClick={() => {
              const next: Record<SortMode, SortMode> = {
                title: "kind",
                kind: "created",
                created: "title",
              };
              patchParams((p) => {
                const ns = next[sort];
                if (ns === "title") p.delete("sort");
                else p.set("sort", ns);
              });
            }}
            title={`Sort: ${sort}`}
          >
            sort · {sort}
          </button>
          <div role="tablist" aria-label="View" style={{ display: "inline-flex", gap: 0 }}>
            {VIEW_VALUES.map((v) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                type="button"
                className={`ideas-toolbar-btn ${view === v ? "active" : ""}`}
                onClick={() =>
                  patchParams((p) => {
                    if (v === "list") p.delete("view");
                    else p.set("view", v);
                  })
                }
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <div className="primitive-head-actions">
          <Button variant="primary" onClick={() => setComposing(true)}>
            + New position
          </Button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {loading && <PositionsLoading />}
        {error && <PositionsError message={error} />}
        {!loading && !error && positions.length === 0 && <PositionsEmptyState />}
        {!loading && !error && positions.length > 0 && view === "list" && (
          <PositionsList positions={filtered} agentById={agentById} />
        )}
        {!loading && !error && positions.length > 0 && view === "chart" && (
          <PositionsChart positions={filtered} edges={edges} agentById={agentById} />
        )}
      </div>
      <NewPositionModal
        open={composing}
        onClose={() => setComposing(false)}
        entityId={entityId}
        positions={positions}
        agents={agents}
        onCreated={(p) => {
          setComposing(false);
          setPositions((prev) => [...prev, p]);
        }}
      />
    </div>
  );
}

function PositionsLoading() {
  return <div style={{ padding: "24px 28px", color: "var(--text-muted)" }}>Loading positions…</div>;
}

function PositionsError({ message }: { message: string }) {
  return (
    <div style={{ padding: "24px 28px", color: "var(--color-error, #c2410c)" }}>{message}</div>
  );
}

function PositionsEmptyState() {
  return (
    <div style={{ padding: "48px 28px" }}>
      <EmptyState
        title="No positions yet"
        description="Positions appear automatically when this entity has agents. They'll show up here as soon as the Blueprint finishes seeding."
      />
    </div>
  );
}

function OccupantLabel({
  position,
  agentById,
}: {
  position: Position;
  agentById: Map<string, { id: string; name: string }>;
}) {
  if (position.occupant_kind === "vacant") {
    return <span style={{ color: "var(--text-muted)" }}>vacant</span>;
  }
  if (position.occupant_kind === "agent" && position.occupant_id) {
    const a = agentById.get(position.occupant_id);
    return (
      <span>
        agent · <strong>{a?.name ?? position.occupant_id.slice(0, 8)}</strong>
      </span>
    );
  }
  if (position.occupant_kind === "human" && position.occupant_id) {
    return (
      <span>
        human · <strong>{position.occupant_id.slice(0, 12)}</strong>
      </span>
    );
  }
  return <span style={{ color: "var(--text-muted)" }}>{position.occupant_kind}</span>;
}

function PositionsList({
  positions,
  agentById,
}: {
  positions: Position[];
  agentById: Map<string, { id: string; name: string }>;
}) {
  return (
    <div style={{ padding: "0 28px 32px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 160px",
          padding: "10px 0",
          borderBottom: "1px solid var(--border-faint)",
          fontSize: 11,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--text-muted)",
        }}
      >
        <div>Title</div>
        <div>Occupant</div>
        <div>Created</div>
      </div>
      {positions.map((p) => (
        <div
          key={p.id}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 160px",
            padding: "12px 0",
            borderBottom: "1px solid var(--border-faint)",
            alignItems: "baseline",
          }}
        >
          <div style={{ fontWeight: 500 }}>{p.title || <em>(untitled)</em>}</div>
          <div>
            <OccupantLabel position={p} agentById={agentById} />
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
            {p.created_at.slice(0, 10)}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Layered DAG render. We compute each position's depth as the longest
 * path from any root (a position with no incoming edges), then bucket
 * positions by depth and render rows top-to-bottom. Edges become SVG
 * lines connecting card centres. Sufficient for v1 — replace with a
 * proper layout engine (dagre / elk) when the chart grows past a few
 * dozen nodes.
 */
function PositionsChart({
  positions,
  edges,
  agentById,
}: {
  positions: Position[];
  edges: PositionEdge[];
  agentById: Map<string, { id: string; name: string }>;
}) {
  const layers = useMemo(() => layoutPositions(positions, edges), [positions, edges]);
  if (layers.length === 0) {
    return <PositionsEmptyState />;
  }
  return (
    <div style={{ padding: "24px 28px 48px" }}>
      {layers.map((layer, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 16,
            marginBottom: i === layers.length - 1 ? 0 : 32,
            position: "relative",
            flexWrap: "wrap",
          }}
        >
          {layer.map((p) => (
            <div
              key={p.id}
              style={{
                minWidth: 180,
                padding: "12px 16px",
                background: "var(--color-card)",
                border: "1px solid var(--border-faint)",
                borderRadius: 8,
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: 4 }}>{p.title || "(untitled)"}</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                <OccupantLabel position={p} agentById={agentById} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function layoutPositions(positions: Position[], edges: PositionEdge[]): Position[][] {
  if (positions.length === 0) return [];
  const byId = new Map(positions.map((p) => [p.id, p]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  for (const p of positions) {
    incoming.set(p.id, []);
    outgoing.set(p.id, []);
  }
  for (const e of edges) {
    if (!byId.has(e.parent_position_id) || !byId.has(e.child_position_id)) continue;
    incoming.get(e.child_position_id)!.push(e.parent_position_id);
    outgoing.get(e.parent_position_id)!.push(e.child_position_id);
  }
  // Longest-path depth from any root.
  const depth = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (seen.has(id)) return 0; // cycle guard — DAG should never trip this, but be safe
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
