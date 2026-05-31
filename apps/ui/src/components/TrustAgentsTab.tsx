import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Agent, AgentTemplate, Role, RoleEdge } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
import { useAgentsQuery } from "@/queries/agents";
import "@/styles/roles.css"; // shared trust workspace primitives
import {
  Button,
  Icon,
  Loading,
  PrimitivePageHeader,
  PrimitiveSearchField,
  Tooltip,
  ToolbarRadioPopover,
} from "./ui";
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

  const { data: entityAgents = [], isLoading: agentsLoading } = useAgentsQuery(trustId);

  // Roles + edges power the chart view; the list view is flat. Load once
  // for the entity so a tab toggle doesn't refetch.
  const [positions, setPositions] = useState<Role[]>([]);
  const [edges, setEdges] = useState<RoleEdge[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    setTemplatesLoading(true);
    setTemplatesError(null);
    api
      .getBlueprints()
      .then((resp) => {
        if (cancelled) return;
        setAgentTemplates(resp.agent_templates ?? []);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setAgentTemplates([]);
        setTemplatesError(e.message || "Could not load agent templates.");
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
  const openAgentBlueprints = useCallback(() => {
    navigate(`/templates/agents?import_into=${encodeURIComponent(trustId)}`);
  }, [navigate, trustId]);
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
  // narrowing — emerald for online, warmth for idle, ink-muted for
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
    <div className="trust-agents trust-primitive-shell">
      <PrimitivePageHeader
        className="trust-roles-page-header trust-primitive-shell-header"
        title={
          <span className="trust-primitive-page-title">
            <span className="trust-primitive-page-title-text">Agents</span>
            <span className="trust-primitive-page-count" aria-hidden="true">
              {entityAgents.length}
            </span>
          </span>
        }
        aria-label="Agent controls"
        actions={
          <Tooltip content="New agent (N)">
            <Button
              className="trust-top-rail-cta"
              variant="primary"
              size="md"
              onClick={openPicker}
              leadingIcon={<Icon icon={Plus} size="sm" />}
            >
              Agent
            </Button>
          </Tooltip>
        }
      >
        <div className="trust-agents-toolbar ideas-toolbar">
          <PrimitiveSearchField
            inputRef={searchRef}
            placeholder="Search agents"
            value={search}
            onChange={(next) => setSearchParam("q", next)}
            showKbdHint
            onEscapeEmpty={(e) => e.currentTarget.blur()}
          />

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
      </PrimitivePageHeader>

      <div className={`trust-agents-main trust-agents-main--${view}`}>
        <section
          className="trust-agents-register trust-primitive-shell-surface"
          aria-label="Agents register"
        >
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

          <div className="trust-agents-register-body">
            {agentsLoading && entityAgents.length === 0 ? (
              <div className="ideas-list-body">
                <Loading size="sm" />
              </div>
            ) : entityAgents.length === 0 ? (
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
          </div>
        </section>

        <SuggestedAgents
          templates={agentTemplates}
          loading={templatesLoading}
          error={templatesError}
          onPick={openPicker}
          onBrowse={openAgentBlueprints}
        />
      </div>

      <BlueprintPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        trustId={trustId}
      />
    </div>
  );
}

/**
 * Suggested agents — real agent templates from the template catalog.
 * The section is secondary capacity, so it sits on a recessed band;
 * each template remains an elevated action card inside it.
 */
function SuggestedAgents({
  templates,
  loading,
  error,
  onPick,
  onBrowse,
}: {
  templates: AgentTemplate[];
  loading: boolean;
  error: string | null;
  onPick: () => void;
  onBrowse: () => void;
}) {
  const visible = templates.slice(0, 3);

  return (
    <section className="trust-agents-suggest" aria-label="Suggested agents">
      <header className="trust-agents-suggest-head">
        <div className="trust-agents-suggest-titles">
          <div className="trust-agents-suggest-title-row">
            <h2 className="trust-agents-suggest-title">Suggested agents</h2>
            <span className="trust-agents-suggest-count" aria-hidden>
              {templates.length}
            </span>
          </div>
          <p className="trust-agents-suggest-subtitle">Agent templates available for this TRUST.</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="trust-agents-suggest-all"
          onClick={onBrowse}
        >
          View templates
        </Button>
      </header>

      {loading ? (
        <div className="trust-agents-suggest-state">
          <Loading size="sm" /> Loading agent templates…
        </div>
      ) : error ? (
        <div className="trust-agents-suggest-state" role="status">
          Agent templates are unavailable right now.
        </div>
      ) : visible.length === 0 ? (
        <div className="trust-agents-suggest-state" role="status">
          No agent templates are published yet.
        </div>
      ) : (
        <div className="trust-agents-suggest-grid">
          {visible.map((template) => (
            <button
              key={template.id}
              type="button"
              className="trust-agents-suggest-card"
              onClick={onPick}
              aria-label={`Add ${template.name} from template`}
            >
              <h3 className="trust-agents-suggest-card-title">{template.name}</h3>
              <p className="trust-agents-suggest-card-desc">
                {template.tagline || template.role || "Reusable agent template."}
              </p>
              <p className="trust-agents-suggest-card-meta">{agentTemplateRuntimeLine(template)}</p>
              <span className="trust-agents-suggest-card-cta" aria-hidden>
                <Plus size={12} strokeWidth={1.8} />
                Add from template
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function agentTemplateRuntimeLine(template: AgentTemplate): string {
  const parts = [template.role || "Agent template"];
  const events = template.seed_events?.length ?? 0;
  const ideas = template.seed_ideas?.length ?? 0;
  const quests = template.seed_quests?.length ?? 0;
  if (events > 0) parts.push(`${events} ${events === 1 ? "event" : "events"}`);
  if (ideas > 0) parts.push(`${ideas} ${ideas === 1 ? "idea" : "ideas"}`);
  if (quests > 0) parts.push(`${quests} ${quests === 1 ? "quest" : "quests"}`);
  return parts.join(" · ");
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
