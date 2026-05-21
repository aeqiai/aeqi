import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MousePointer2, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Agent, Quest, Role, RoleEdge } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
import { formatCurrency } from "@/lib/i18n";
import "@/styles/roles.css"; // shared trust-snapshot card primitives
import { Button, Icon, Tooltip, ToolbarRadioPopover } from "./ui";
import { BlueprintPickerModal } from "@/components/blueprints/BlueprintPickerModal";
import AgentsEmptyState from "./agents/AgentsEmptyState";
import AgentsList from "./agents/AgentsList";
import AgentsChart from "./agents/AgentsChart";

type ViewMode = "list" | "chart";
type SortMode = "recent" | "alpha-asc" | "alpha-desc" | "active" | "spend";
// Filter vocabulary mirrors the liveness ladder painted on each row
// (online / idle / offline) so the toolbar and the row dots speak the
// same language. The wire field `agent.status` is unchanged — bucketing
// happens in `bucketLiveness`.
type LivenessFilter = "all" | "online" | "idle" | "offline";

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
  spend: "Spend (high → low)",
};
const SORT_ORDER: SortMode[] = ["recent", "alpha-asc", "alpha-desc", "active", "spend"];
const SORT_VALUES = new Set<SortMode>(SORT_ORDER);

const LIVENESS_FILTER_LABELS: Record<LivenessFilter, string> = {
  all: "All",
  online: "Online",
  idle: "Idle",
  offline: "Offline",
};
const LIVENESS_FILTER_ORDER: LivenessFilter[] = ["all", "online", "idle", "offline"];
const LIVENESS_FILTER_VALUES = new Set<LivenessFilter>(LIVENESS_FILTER_ORDER);

/**
 * Agents tab. Lists every agent inside the active entity — root and seeds —
 * with the canonical search · sort · filter · view toolbar shipped on Ideas
 * and Blueprints. State (q, sort, filter, view) persists in the URL via the
 * same `patchParams` idiom Ideas / Quests / Positions adopted.
 *
 * List view is a flat scannable register sorted by the toolbar selector
 * (recent / alpha / activity / spend). Hierarchy lives in the chart view —
 * the indented-tree shape was reverted 2026-05-07; nesting is a chart
 * concern, not a list concern.
 *
 * Chart view mirrors TrustRolesTab's layered-DAG renderer so both
 * tabs answer the same shape from different lenses — Positions reads
 * "what slots exist", Agents-chart reads "who fills those slots".
 */
export default function TrustAgentsTab({ trustId }: { trustId: string }) {
  const navigate = useNavigate();
  const entitiesList = useDaemonStore((s) => s.entities);
  const openAgent = useCallback(
    (agentId: string) =>
      navigate(entityPathFromId(entitiesList, trustId, "agents", encodeURIComponent(agentId))),
    [navigate, trustId, entitiesList],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  const search = searchParams.get("q") ?? "";
  const sortRaw = searchParams.get("sort");
  const sort: SortMode = SORT_VALUES.has(sortRaw as SortMode) ? (sortRaw as SortMode) : "recent";
  const viewRaw = searchParams.get("view");
  const view: ViewMode = VIEW_VALUES.has(viewRaw as ViewMode) ? (viewRaw as ViewMode) : "list";
  const statusRaw = searchParams.get("status");
  const status: LivenessFilter = LIVENESS_FILTER_VALUES.has(statusRaw as LivenessFilter)
    ? (statusRaw as LivenessFilter)
    : "all";

  // `s.agents` is a directory union (every company-root from
  // /api/entities + the active scope's /api/agents subtree); without
  // this filter the tab renders the sidebar entity switcher.
  const allAgents = useDaemonStore((s) => s.agents);
  const entityAgents = useMemo(
    () => allAgents.filter((a) => a.trust_id === trustId),
    [allAgents, trustId],
  );

  // Snapshot metrics — mirrors the Roles page snapshot grammar
  // (total / "alive" tier / running work / cost). Spend is lifetime,
  // not monthly, because the wire field is lifetime_cost_usd; the
  // sublabel calls that out honestly rather than inventing a window.
  const quests = useDaemonStore((s) => s.quests) as unknown as Quest[];
  const snapshot = useMemo(() => {
    let total = 0;
    let active = 0;
    let totalSpend = 0;
    const agentIds = new Set<string>();
    for (const a of entityAgents) {
      total += 1;
      if (a.status === "active") active += 1;
      totalSpend += a.lifetime_cost_usd ?? 0;
      agentIds.add(a.id);
    }
    let runningQuests = 0;
    for (const q of quests) {
      if (!q.agent_id || !agentIds.has(q.agent_id)) continue;
      if (
        q.status === "in_progress" ||
        q.status === "in_review" ||
        q.status === "todo" ||
        q.status === "backlog"
      ) {
        runningQuests += 1;
      }
    }
    return { total, active, totalSpend, runningQuests };
  }, [entityAgents, quests]);

  // Roles + edges power the chart view; the list view is flat. Load once
  // for the entity so a tab toggle doesn't refetch.
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
      .getRoles(trustId)
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
  }, [trustId]);

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
      rows = rows.filter((a) => bucketLiveness(a.status) === status);
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
  // a non-resting filter is in play. The liveness chip carries the same
  // dot vocabulary as the row paint (`.agent-liveness-dot--<state>`) so
  // the active filter reads in the same language as the rows it's
  // narrowing — violet for online, warmth for idle, ink-muted for
  // offline — instead of as a generic grey pill.
  const activeChips: {
    key: string;
    label: string;
    liveness?: "online" | "idle" | "offline";
    onRemove: () => void;
  }[] = [];
  if (status !== "all") {
    activeChips.push({
      key: "status",
      label: LIVENESS_FILTER_LABELS[status],
      liveness: status,
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
    <div className="trust-agents">
      <header className="trust-agents-header">
        <div className="trust-agents-header-titles">
          <div className="trust-agents-title-row">
            <h1 className="trust-agents-title">Agents</h1>
            {entityAgents.length > 0 && (
              <span
                className="trust-agents-title-count"
                aria-label={`${entityAgents.length} ${entityAgents.length === 1 ? "agent" : "agents"} in this TRUST`}
              >
                {entityAgents.length}
              </span>
            )}
          </div>
        </div>
        <div className="trust-agents-header-actions">
          <Tooltip content="New agent (N)">
            <Button
              variant="primary"
              size="md"
              onClick={openPicker}
              leadingIcon={<Icon icon={Plus} size="sm" />}
            >
              New
            </Button>
          </Tooltip>
        </div>
      </header>

      <div className="trust-agents-main">
        <section className="trust-agents-snapshot" aria-label="Snapshot">
          <AgentSnapshotCard
            label={snapshot.total === 1 ? "Agent" : "Agents"}
            value={snapshot.total}
            sublabel="Total in this TRUST"
          />
          <AgentSnapshotCard
            label="Active"
            value={snapshot.active}
            sublabel={
              snapshot.active === 0
                ? "None online"
                : snapshot.active === snapshot.total
                  ? "All online"
                  : "Currently online"
            }
          />
          <AgentSnapshotCard
            label={snapshot.runningQuests === 1 ? "Running quest" : "Running quests"}
            value={snapshot.runningQuests}
            sublabel="In progress now"
          />
          <AgentSnapshotCard
            label="Lifetime spend"
            value={formatCurrency(snapshot.totalSpend, "USD")}
            valueVariant="mono"
            sublabel="Across every inference call"
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
              current={LIVENESS_FILTER_LABELS[status]}
              glyph={GLYPHS.filter}
              options={LIVENESS_FILTER_ORDER.map((s) => ({
                id: s,
                label: LIVENESS_FILTER_LABELS[s],
              }))}
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
                  className={
                    c.liveness ? "ideas-list-chip agents-list-chip--liveness" : "ideas-list-chip"
                  }
                  onClick={c.onRemove}
                  title={`Remove ${c.label}`}
                >
                  {c.liveness && (
                    <span
                      className={`agent-liveness-dot agent-liveness-dot--${c.liveness}`}
                      aria-hidden
                    />
                  )}
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
          <AgentsList agents={filtered} onSelect={openAgent} />
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

        <SuggestedAgents onPick={openPicker} />
      </div>

      <aside className="trust-agents-side" aria-label="Selected agent">
        {/* Placeholder inspector — selection wiring + full Identity /
           Role & authority / Model & runtime / Capabilities / Activity
           / Budget / Meta sections land in a follow-up cycle. */}
        <div className="trust-agents-side-empty">
          <MousePointer2
            size={22}
            strokeWidth={1.5}
            className="trust-agents-side-empty-icon"
            aria-hidden
          />
          <p className="trust-agents-side-empty-title">Select an agent</p>
          <p className="trust-agents-side-empty-hint">
            Click a row to see model, role, runtime, and spend details.
          </p>
        </div>
      </aside>

      <BlueprintPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        trustId={trustId}
      />
    </div>
  );
}

interface SuggestedAgentSpec {
  title: string;
  desc: string;
}

const SUGGESTED_AGENTS: SuggestedAgentSpec[] = [
  {
    title: "Research Agent",
    desc: "Tracks markets, documents, and strategic context.",
  },
  {
    title: "Treasury Agent",
    desc: "Monitors budgets, wallets, and capital movement.",
  },
  {
    title: "Governance Agent",
    desc: "Prepares proposals, quorum updates, and decisions.",
  },
];

/**
 * Suggested agents — three template cards below the table. Tells the
 * reader "this TRUST can grow execution capacity along these axes" so
 * the page never reads as terminal at one agent. Each card opens the
 * blueprint picker; per-template prefill happens at the picker layer
 * (out of scope for this component).
 */
function SuggestedAgents({ onPick }: { onPick: () => void }) {
  return (
    <section className="trust-agents-suggest" aria-label="Suggested agents">
      <header className="trust-agents-suggest-head">
        <div className="trust-agents-suggest-titles">
          <div className="trust-agents-suggest-title-row">
            <h2 className="trust-agents-suggest-title">Suggested agents</h2>
            <span className="trust-agents-suggest-count" aria-hidden>
              {SUGGESTED_AGENTS.length}
            </span>
          </div>
          <p className="trust-agents-suggest-subtitle">
            Add specialized execution capacity to this TRUST.
          </p>
        </div>
        <button type="button" className="trust-agents-suggest-all" onClick={onPick}>
          View all templates
        </button>
      </header>
      <div className="trust-agents-suggest-grid">
        {SUGGESTED_AGENTS.map((s) => (
          <article key={s.title} className="trust-agents-suggest-card">
            <h3 className="trust-agents-suggest-card-title">{s.title}</h3>
            <p className="trust-agents-suggest-card-desc">{s.desc}</p>
            <button
              type="button"
              className="trust-agents-suggest-card-cta"
              onClick={onPick}
              aria-label={`Add ${s.title}`}
            >
              <Plus size={12} strokeWidth={1.8} />
              Add agent
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

interface AgentSnapshotCardProps {
  label: string;
  value: number | string;
  sublabel?: string;
  /**
   * Typography register for the headline value. `display` (default) uses
   * the brand display face for count headlines — the canonical KPI
   * treatment. `mono` switches to the monospace family + tabular-nums so
   * currency reads as data and the `$0.00` digit widths align with the
   * `.agents-list-spend` cell vocabulary inside the row table below.
   */
  valueVariant?: "display" | "mono";
}

/**
 * Snapshot card for the Agents page header strip. Same shape as the
 * Roles page (`trust-roles-snapshot-card`) — label + count, with a
 * one-line teaching sublabel. The two pages share the
 * `.trust-roles-snapshot-*` CSS primitives until a generic refactor
 * pulls them under a neutral name.
 */
function AgentSnapshotCard({
  label,
  value,
  sublabel,
  valueVariant = "display",
}: AgentSnapshotCardProps) {
  const valueClass =
    valueVariant === "mono"
      ? "trust-roles-snapshot-value trust-roles-snapshot-value--mono"
      : "trust-roles-snapshot-value";
  return (
    <article className="trust-roles-snapshot-card">
      <header className="trust-roles-snapshot-head">
        <span className="trust-roles-snapshot-label">{label}</span>
        <span className={valueClass}>{value}</span>
      </header>
      {sublabel && <p className="trust-roles-snapshot-sublabel">{sublabel}</p>}
    </article>
  );
}

// Map raw agent.status wire value into the three liveness buckets the
// filter exposes. Mirrors `livenessOf` in AgentsList — keep the two
// aligned so the toolbar pick matches the dot painted on each row.
// "active" → online, "stopped" → offline, everything else → idle.
function bucketLiveness(raw: string | undefined): LivenessFilter {
  if (raw === "active") return "online";
  if (raw === "stopped") return "offline";
  return "idle";
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
    case "spend": {
      const ca = a.lifetime_cost_usd ?? 0;
      const cb = b.lifetime_cost_usd ?? 0;
      return cb - ca;
    }
    case "recent":
    default: {
      const ta = a.created_at ? Date.parse(a.created_at) : 0;
      const tb = b.created_at ? Date.parse(b.created_at) : 0;
      return tb - ta;
    }
  }
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
