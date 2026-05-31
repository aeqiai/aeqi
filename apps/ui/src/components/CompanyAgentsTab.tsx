import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { ArrowDownWideNarrow, ArrowRight, ListFilter, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { Agent, AgentTemplate } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { entityPathFromId } from "@/lib/entityPath";
import { useAgentsQuery } from "@/queries/agents";
import { agentKeys } from "@/queries/keys";
import "@/styles/roles.css"; // shared company workspace primitives
import "@/styles/agents.css";
import {
  Button,
  Icon,
  Loading,
  PrimitivePageHeader,
  PrimitiveSearchField,
  Tooltip,
  ToolbarRadioPopover,
} from "./ui";
import AgentsEmptyState from "./agents/AgentsEmptyState";
import AgentsList from "./agents/AgentsList";
import NewAgentModal from "./agents/NewAgentModal";

type SortMode = "recent" | "alpha-asc" | "alpha-desc" | "active" | "spend";
// Filter vocabulary mirrors the liveness ladder painted on each row
// (online / idle / offline) so the toolbar and the row dots speak the
// same language. The wire field `agent.status` is unchanged — bucketing
// happens in `bucketLiveness`.
type LivenessFilter = "all" | "online" | "idle" | "offline";

const SORT_LABELS: Record<SortMode, string> = {
  recent: "Recently created",
  "alpha-asc": "Name (A→Z)",
  "alpha-desc": "Name (Z→A)",
  active: "Activity",
  spend: "Usage (high → low)",
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
 * with the canonical search · sort · filter toolbar shipped on Ideas
 * and Blueprints. State (q, sort, filter) persists in the URL via the
 * same `patchParams` idiom Ideas / Quests / Positions adopted.
 *
 * List view is a flat scannable register sorted by the toolbar selector
 * (recent / alpha / activity / usage). Hierarchy belongs to Roles/Positions;
 * Agents stays a register of operational workers.
 */
export default function CompanyAgentsTab({ companyId }: { companyId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const entitiesList = useDaemonStore((s) => s.entities);
  const openAgent = useCallback(
    (agentId: string) =>
      navigate(entityPathFromId(entitiesList, companyId, "agents", encodeURIComponent(agentId))),
    [navigate, companyId, entitiesList],
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  const search = searchParams.get("q") ?? "";
  const sortRaw = searchParams.get("sort");
  const sort: SortMode = SORT_VALUES.has(sortRaw as SortMode) ? (sortRaw as SortMode) : "recent";
  const statusRaw = searchParams.get("status");
  const status: LivenessFilter = LIVENESS_FILTER_VALUES.has(statusRaw as LivenessFilter)
    ? (statusRaw as LivenessFilter)
    : "all";

  const { data: entityAgents = [], isLoading: agentsLoading } = useAgentsQuery(companyId);

  const [createOpen, setCreateOpen] = useState(false);
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

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
  // point.
  const openCreateAgent = useCallback(() => setCreateOpen(true), []);
  const openAgentBlueprints = useCallback(() => {
    navigate(`/templates/agents?import_into=${encodeURIComponent(companyId)}`);
  }, [navigate, companyId]);
  const openAgentTemplateDetail = useCallback(() => {
    navigate(`/templates/aeqi/agents?import_into=${encodeURIComponent(companyId)}`);
  }, [navigate, companyId]);
  useEffect(() => {
    window.addEventListener("aeqi:create", openCreateAgent);
    return () => window.removeEventListener("aeqi:create", openCreateAgent);
  }, [openCreateAgent]);

  const handleAgentCreated = useCallback(
    async (agentId: string) => {
      await queryClient.invalidateQueries({ queryKey: agentKeys.directory(companyId) });
      openAgent(agentId);
    },
    [openAgent, queryClient, companyId],
  );

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
    <div className="company-agents company-primitive-shell">
      <PrimitivePageHeader
        className="company-roles-page-header company-primitive-shell-header"
        title={
          <span className="company-primitive-page-title">
            <span className="company-primitive-page-title-text">Agents</span>
            <span className="company-primitive-page-count" aria-hidden="true">
              {entityAgents.length}
            </span>
          </span>
        }
        aria-label="Agent controls"
        pinPlacement="utilities"
        actions={
          <Tooltip content="New agent">
            <Button
              className="company-top-rail-cta"
              variant="primary"
              size="md"
              onClick={openCreateAgent}
              aria-label="New agent"
              leadingIcon={<Icon icon={Plus} size="sm" />}
            >
              Agent
            </Button>
          </Tooltip>
        }
      >
        <div className="company-agents-toolbar ideas-toolbar">
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
        </div>
      </PrimitivePageHeader>

      <div className="company-agents-main company-agents-main--list">
        <section
          className="company-agents-register company-primitive-shell-surface"
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

          <div className="company-agents-register-body">
            {agentsLoading && entityAgents.length === 0 ? (
              <div className="ideas-list-body">
                <Loading size="sm" />
              </div>
            ) : entityAgents.length === 0 ? (
              <div className="ideas-list-body">
                <AgentsEmptyState onNew={openCreateAgent} />
              </div>
            ) : (
              <AgentsList agents={filtered} onSelect={openAgent} />
            )}
          </div>
        </section>

        <SuggestedAgents
          templates={agentTemplates}
          loading={templatesLoading}
          error={templatesError}
          onOpenTemplate={openAgentTemplateDetail}
          onBrowse={openAgentBlueprints}
        />
      </div>

      <NewAgentModal
        open={createOpen}
        companyId={companyId}
        agents={entityAgents}
        onClose={() => setCreateOpen(false)}
        onCreated={handleAgentCreated}
      />
    </div>
  );
}

/**
 * Agent templates — real reusable agent bundles from the template catalog.
 * The section is secondary capacity, so it sits on a recessed band;
 * each template remains an elevated navigation card inside it.
 */
function SuggestedAgents({
  templates,
  loading,
  error,
  onOpenTemplate,
  onBrowse,
}: {
  templates: AgentTemplate[];
  loading: boolean;
  error: string | null;
  onOpenTemplate: () => void;
  onBrowse: () => void;
}) {
  const visible = templates.slice(0, 3);

  return (
    <section className="company-agents-suggest" aria-label="Agent templates">
      <header className="company-agents-suggest-head">
        <div className="company-agents-suggest-titles">
          <div className="company-agents-suggest-title-row">
            <h2 className="company-agents-suggest-title">Agent templates</h2>
            <span className="company-agents-suggest-count" aria-hidden>
              {templates.length}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="company-agents-suggest-all"
          onClick={onBrowse}
          aria-label="Browse agent templates"
        >
          Browse templates
        </Button>
      </header>

      {loading ? (
        <div className="company-agents-suggest-state">
          <Loading size="sm" /> Loading agent templates…
        </div>
      ) : error ? (
        <div className="company-agents-suggest-state" role="status">
          Agent templates are unavailable right now.
        </div>
      ) : visible.length === 0 ? (
        <div className="company-agents-suggest-state" role="status">
          No agent templates are published yet.
        </div>
      ) : (
        <div className="company-agents-suggest-grid">
          {visible.map((template) => (
            <button
              key={template.id}
              type="button"
              className="company-agents-suggest-card"
              onClick={onOpenTemplate}
              aria-label={`View ${template.name} agent template`}
            >
              <h3 className="company-agents-suggest-card-title">{template.name}</h3>
              <p className="company-agents-suggest-card-desc">
                {template.tagline || template.role || "Reusable agent template."}
              </p>
              <p className="company-agents-suggest-card-meta">
                {agentTemplateRuntimeLine(template)}
              </p>
              <span className="company-agents-suggest-card-cta" aria-hidden>
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

function agentTemplateRuntimeLine(template: AgentTemplate): string {
  const parts = [sentenceCase(template.role || "Agent template")];
  const events = template.seed_events?.length ?? 0;
  const ideas = template.seed_ideas?.length ?? 0;
  const quests = template.seed_quests?.length ?? 0;
  if (events > 0) parts.push(`${events} ${events === 1 ? "event" : "events"}`);
  if (ideas > 0) parts.push(`${ideas} ${ideas === 1 ? "idea" : "ideas"}`);
  if (quests > 0) parts.push(`${quests} ${quests === 1 ? "quest" : "quests"}`);
  return parts.join(" · ");
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;
  const words = trimmed.split(/\s+/);
  return words
    .map((word, index) =>
      index === 0 || word === word.toUpperCase()
        ? word
        : word.charAt(0).toLowerCase() + word.slice(1),
    )
    .join(" ");
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
  sort: <Icon icon={ArrowDownWideNarrow} size="sm" />,
  filter: <Icon icon={ListFilter} size="sm" />,
} as const;
