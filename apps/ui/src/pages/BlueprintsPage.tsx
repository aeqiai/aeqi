import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "@/lib/api";
import { countBlueprintStructures } from "@/lib/blueprintStructures";
import type { AgentTemplate, Blueprint, BlueprintCategory, SingleBlueprint } from "@/lib/types";
import { isSingleBlueprint } from "@/lib/types";
import {
  Button,
  Card,
  Loading,
  MetricCard,
  MetricGrid,
  PrimitivePageHeader,
  PrimitiveSearchField,
} from "@/components/ui";
import { EmptyState } from "@/components/ui/EmptyState";
import PageRail from "@/components/PageRail";
import { parseTags, serializeTags } from "@/components/ideas/types";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";
import {
  CATEGORY_ORDER,
  CATEGORY_VALUES,
  KIND_IDS,
  KIND_TABS,
  SORT_LABELS,
  SORT_ORDER,
  SORT_VALUES,
  V1_SHIPPED_COMPANY_PACKAGE_COUNT,
  VIEW_LABELS,
  VIEW_ORDER,
  VIEW_VALUES,
  type Kind,
  type Sort,
  type View,
} from "./blueprints/constants";
import BlueprintCategorySection from "./blueprints/BlueprintCategorySection";
import { ToolbarRadioPopover } from "@/components/ui";
import BlueprintsFilterPopover from "./blueprints/BlueprintsFilterPopover";

const KIND_DESCRIPTIONS: Record<Kind, string> = {
  companies:
    "Canonical company templates launch a new TRUST. v1 ships the first company package; draft Foundation and Fund packages stay hidden until audited.",
  agents:
    "Primitive bundles import into an existing TRUST. Agent bundles are reusable operating roles, not standalone launch packages.",
  events:
    "Event bundles are importable runtime triggers for an existing TRUST. Standalone event bundles are not shipped in v1.",
  quests:
    "Quest bundles import work into an existing TRUST. Standalone quest bundles are not shipped in v1.",
  ideas:
    "Idea bundles import reusable memory into an existing TRUST. Standalone idea bundles are not shipped in v1.",
};

/**
 * `/blueprints` — top-level catalog with a vertical PageRail (Companies /
 * Agents / Events / Quests / Ideas) on the left. Companies is the
 * canonical landing route at `/blueprints`; the other kinds live at
 * `/blueprints/:kind` and render empty-state placeholders until v2.
 *
 * Blueprints is its own root destination — the supply layer of the system
 * (the catalog of recipes that everything else gets instantiated from).
 *
 * Layout: 3 stacked category sections (Company / Foundation / Fund).
 * Foundation renders as a "coming soon" placeholder if empty.
 * URL params: q, sort, tags, view, category.
 * `?category=<x>` scrolls + filters to that section.
 */
export default function BlueprintsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  const importIntoId = searchParams.get("import_into") || null;
  const isImportMode = !!importIntoId;

  // Resolve the active kind from the URL path.
  const activeKind: Kind = useMemo(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    const second = segments[1];
    return second && KIND_IDS.includes(second as Kind) ? (second as Kind) : "companies";
  }, [location.pathname]);

  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [agentTemplates, setAgentTemplates] = useState<AgentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = searchParams.get("q") || "";
  const sortRaw = searchParams.get("sort");
  const sort: Sort = SORT_VALUES.has(sortRaw as Sort) ? (sortRaw as Sort) : "recent";
  const viewRaw = searchParams.get("view");
  const view: View = VIEW_VALUES.has(viewRaw as View) ? (viewRaw as View) : "grid";
  const selectedTags = useMemo(() => parseTags(searchParams.get("tags")), [searchParams]);
  const categoryRaw = searchParams.get("category");
  const activeCategory: BlueprintCategory | null =
    categoryRaw && CATEGORY_VALUES.has(categoryRaw as BlueprintCategory)
      ? (categoryRaw as BlueprintCategory)
      : null;

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

  const setTags = useCallback(
    (tags: string[]) => {
      patchParams((p) => {
        if (tags.length === 0) p.delete("tags");
        else p.set("tags", serializeTags(tags));
      });
    },
    [patchParams],
  );

  const resetFilters = useCallback(() => {
    patchParams((p) => {
      p.delete("q");
      p.delete("tags");
      p.delete("category");
    });
  }, [patchParams]);

  useEffect(() => {
    document.title = "aeqi";
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getBlueprints()
      .then((resp) => {
        if (cancelled) return;
        const incoming = resp.blueprints ?? [];
        setBlueprints(incoming);
        setAgentTemplates(resp.agent_templates ?? []);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Could not reach the template store.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const matches = useCallback(
    (h: string | undefined | null) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (h || "").toLowerCase().includes(q);
    },
    [query],
  );

  const matchesTagText = useCallback(
    (tags: string[] | undefined | null) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (tags ?? []).some((t) => t.toLowerCase().includes(q));
    },
    [query],
  );

  const singleBlueprints = useMemo(
    () =>
      (blueprints.filter(isSingleBlueprint) as SingleBlueprint[]).filter(
        (blueprint) => (blueprint.category ?? "company") === "company",
      ),
    [blueprints],
  );

  // Tag universe — all unique tags ordered by frequency.
  const tagCounts = useMemo<[string, number][]>(() => {
    if (activeKind !== "companies") return [];
    const counts: Record<string, number> = {};
    for (const t of singleBlueprints) {
      for (const tag of t.tags ?? []) counts[tag] = (counts[tag] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [singleBlueprints, activeKind]);

  const complexity = useCallback(
    (t: SingleBlueprint) =>
      1 +
      (t.seed_agents?.length ?? 0) +
      (t.seed_events?.length ?? 0) +
      (t.seed_ideas?.length ?? 0) +
      (t.seed_quests?.length ?? 0) +
      (t.seed_views?.length ?? 0),
    [],
  );

  // Global filtered list respecting search + tag + optional category filter.
  const filtered = useMemo(() => {
    if (activeKind !== "companies") return [] as SingleBlueprint[];
    let out = singleBlueprints.filter(
      (t) => matches(t.name) || matches(t.tagline) || matchesTagText(t.tags),
    );
    if (selectedTags.length > 0) {
      const wanted = new Set(selectedTags);
      out = out.filter((t) => (t.tags ?? []).some((tag) => wanted.has(tag)));
    }
    if (activeCategory) {
      out = out.filter((t) => t.category === activeCategory);
    }
    if (sort === "alpha-asc") {
      out = [...out].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    } else if (sort === "alpha-desc") {
      out = [...out].sort((a, b) =>
        b.name.localeCompare(a.name, undefined, { sensitivity: "base" }),
      );
    } else if (sort === "complexity") {
      out = [...out].sort((a, b) => complexity(b) - complexity(a));
    }
    return out;
  }, [
    singleBlueprints,
    activeKind,
    matches,
    matchesTagText,
    selectedTags,
    activeCategory,
    sort,
    complexity,
  ]);

  // Group the filtered single list into category buckets in canonical order.
  const grouped = useMemo(() => {
    const map = new Map<BlueprintCategory, SingleBlueprint[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const bp of filtered) {
      const cat = bp.category ?? "company";
      const bucket = map.get(cat);
      if (bucket) bucket.push(bp);
      // Blueprints with unknown categories fall into company silently.
      else map.get("company")!.push(bp);
    }
    return map;
  }, [filtered]);

  const filteredAgentTemplates = useMemo(() => {
    if (activeKind !== "agents") return [] as AgentTemplate[];
    const q = query.trim().toLowerCase();
    let out = agentTemplates.filter((template) => {
      if (!q) return true;
      return (
        template.name.toLowerCase().includes(q) ||
        (template.tagline ?? "").toLowerCase().includes(q) ||
        (template.role ?? "").toLowerCase().includes(q)
      );
    });
    if (sort === "alpha-asc") {
      out = [...out].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    } else if (sort === "alpha-desc") {
      out = [...out].sort((a, b) =>
        b.name.localeCompare(a.name, undefined, { sensitivity: "base" }),
      );
    } else if (sort === "complexity") {
      out = [...out].sort((a, b) => agentTemplateComplexity(b) - agentTemplateComplexity(a));
    }
    return out;
  }, [activeKind, agentTemplates, query, sort]);

  const importTargetSuffix = isImportMode ? `?import_into=${importIntoId}` : "";
  const filtersActive = query.trim() !== "" || selectedTags.length > 0 || !!activeCategory;
  const totalFiltered = filtered.length;
  const primitiveBundleCount = agentTemplates.length;
  const totalRuntimeSeeds = useMemo(
    () =>
      singleBlueprints.reduce(
        (sum, t) =>
          sum +
          1 +
          (t.seed_agents?.length ?? 0) +
          (t.seed_events?.length ?? 0) +
          (t.seed_ideas?.length ?? 0) +
          (t.seed_quests?.length ?? 0) +
          (t.seed_views?.length ?? 0),
        0,
      ),
    [singleBlueprints],
  );
  const totalStructures = useMemo(
    () => singleBlueprints.reduce((sum, t) => sum + countBlueprintStructures(t), 0),
    [singleBlueprints],
  );
  const shippedCompanyPackageCount = Math.min(
    V1_SHIPPED_COMPANY_PACKAGE_COUNT,
    singleBlueprints.length,
  );

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

  const searchPlaceholder = `Search ${activeKind === "companies" ? "Templates" : KIND_TABS.find((t) => t.id === activeKind)?.label}`;

  return (
    <div className="page-rail-shell">
      <PageRail tabs={KIND_TABS} defaultTab="companies" title="Templates" basePath="/templates" />
      <main className="page-rail-content page-rail-content--full">
        <div className="bp-page-head">
          <PrimitivePageHeader
            title="Templates"
            padding="none"
            children={
              <div className="ideas-toolbar" aria-label="Template controls">
                <PrimitiveSearchField
                  inputRef={searchRef}
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={(next) => setSearchParam("q", next)}
                  showKbdHint
                  onEscapeEmpty={(event) => event.currentTarget.blur()}
                />

                <ToolbarRadioPopover
                  label="Sort"
                  current={SORT_LABELS[sort]}
                  glyph={GLYPHS.sort}
                  options={SORT_ORDER.map((s) => ({ id: s, label: SORT_LABELS[s] }))}
                  value={sort}
                  onChange={(next) => setSearchParam("sort", next === "recent" ? null : next)}
                />

                <BlueprintsFilterPopover
                  tagCounts={tagCounts}
                  selected={selectedTags}
                  onChange={setTags}
                  activeCategory={activeCategory}
                  onCategoryChange={(cat) => setSearchParam("category", cat)}
                />

                <ToolbarRadioPopover
                  label="View"
                  current={VIEW_LABELS[view]}
                  glyph={GLYPHS.view}
                  options={VIEW_ORDER.map((v) => ({ id: v, label: VIEW_LABELS[v] }))}
                  value={view}
                  onChange={(next) => setSearchParam("view", next === "grid" ? null : next)}
                />
              </div>
            }
            actions={
              activeKind === "companies" && !isImportMode ? (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => navigate("/launch")}
                  leadingIcon={<Plus size={14} strokeWidth={1.5} />}
                >
                  Launch TRUST
                </Button>
              ) : undefined
            }
          />
          <p className="bp-page-description">{KIND_DESCRIPTIONS[activeKind]}</p>
        </div>

        <div className="bp-catalog-body">
          {isImportMode && (
            <div className="bp-import-banner" role="status">
              <span className="bp-import-banner-eyebrow">Import mode</span>
              <p className="bp-import-banner-line">
                Import mode is for primitive bundles. Company templates stay launch-only in v1; use
                Agents for reusable role bundles, with Events, Quests, and Ideas landing later.
              </p>
            </div>
          )}

          {error && (
            <div className="bp-error" role="alert">
              {error} — showing default templates.
            </div>
          )}

          {activeKind === "companies" && (
            <MetricGrid columns={3} className="bp-supply-metrics">
              <MetricCard
                label="Company packages"
                value={singleBlueprints.length}
                detail={`${shippedCompanyPackageCount} shipped in v1`}
              />
              <MetricCard
                label="Launch action"
                value={totalRuntimeSeeds}
                detail="seeded roles, agents, memory"
              />
              <MetricCard
                label="Primitive bundles"
                value={primitiveBundleCount}
                detail={`${totalStructures} company structures stay launch-scoped`}
              />
            </MetricGrid>
          )}

          {loading && (activeKind === "companies" || activeKind === "agents") ? (
            <div className="bp-status">
              <Loading size="sm" /> Loading templates…
            </div>
          ) : activeKind === "agents" ? (
            filteredAgentTemplates.length === 0 ? (
              <EmptyState
                title={query ? `No match for "${query}".` : "No agent bundles yet."}
                description="Agent bundles import roles and seed context into an existing TRUST. v1 exposes the bundled Steward template as part of the shipped company package."
              />
            ) : view === "list" ? (
              <ul className="bp-list" role="list">
                {filteredAgentTemplates.map((template) => (
                  <li key={template.id} className="bp-list-row">
                    <AgentTemplateRow template={template} />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="bp-grid" role="list">
                {filteredAgentTemplates.map((template) => (
                  <AgentTemplateCard key={template.id} template={template} />
                ))}
              </div>
            )
          ) : activeKind !== "companies" ? (
            <EmptyState
              title={`No importable ${KIND_TABS.find((t) => t.id === activeKind)?.label.toLowerCase()} bundles yet.`}
              description="v1 ships the first company package for launch. Standalone primitive bundles import into existing TRUSTs once they are audited and exposed."
              action={<Link to="/templates/companies">Open Companies</Link>}
            />
          ) : totalFiltered === 0 && filtersActive ? (
            <div className="ideas-list-filter-indicator">
              <span>
                <strong>0</strong> of {singleBlueprints.length} templates match.
              </span>
              <button type="button" className="ideas-list-filter-reset" onClick={resetFilters}>
                Reset filters
              </button>
            </div>
          ) : (
            <div className="bp-catalog-sections">
              {CATEGORY_ORDER.map((cat) => {
                const bucket = grouped.get(cat) ?? [];
                const isActiveFilter = activeCategory === cat;
                return (
                  <BlueprintCategorySection
                    key={cat}
                    category={cat}
                    blueprints={bucket}
                    view={view}
                    importTargetSuffix={importTargetSuffix}
                    isActiveFilter={isActiveFilter}
                    onCategoryFilter={() => setSearchParam("category", isActiveFilter ? null : cat)}
                    onNavigate={navigate}
                  />
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/* ── Category section ─────────────────────────────────── */

function agentTemplateComplexity(template: AgentTemplate): number {
  return (
    (template.seed_events?.length ?? 0) +
    (template.seed_ideas?.length ?? 0) +
    (template.seed_quests?.length ?? 0)
  );
}

function agentTemplateRuntimeLine(template: AgentTemplate): string {
  const parts = ["Import bundle"];
  const events = template.seed_events?.length ?? 0;
  const ideas = template.seed_ideas?.length ?? 0;
  const quests = template.seed_quests?.length ?? 0;
  if (events > 0) parts.push(`${events} ${events === 1 ? "event" : "events"}`);
  if (ideas > 0) parts.push(`${ideas} ${ideas === 1 ? "idea" : "ideas"}`);
  if (quests > 0) parts.push(`${quests} ${quests === 1 ? "quest" : "quests"}`);
  return parts.join(" · ");
}

function AgentTemplateRow({ template }: { template: AgentTemplate }) {
  return (
    <Link to="/templates/aeqi/agents" className="bp-list-row-btn">
      <span className="bp-list-row-name">{template.name}</span>
      {template.tagline && <span className="bp-list-row-tagline">{template.tagline}</span>}
      <span className="bp-list-row-counts">{agentTemplateRuntimeLine(template)}</span>
    </Link>
  );
}

function AgentTemplateCard({ template }: { template: AgentTemplate }) {
  return (
    <Link
      to="/templates/aeqi/agents"
      className="bp-card-link"
      role="listitem"
      aria-label={`${template.name} agent template`}
    >
      <Card variant="default" padding="md" interactive className="bp-card">
        <div className="bp-card-kind-row">
          <span className="bp-card-kind">Primitive bundle</span>
          <span className="bp-card-shipped">imports</span>
        </div>
        <h3 className="bp-card-name">{template.name}</h3>
        {template.tagline && <p className="bp-card-tagline">{template.tagline}</p>}
        <div className="bp-card-inclusions">
          {template.role && (
            <div className="bp-card-inclusion-row">
              <span className="bp-card-inclusion-label">Role</span>
              <span className="bp-card-inclusion-value">{template.role}</span>
            </div>
          )}
          <div className="bp-card-inclusion-row">
            <span className="bp-card-inclusion-label">Imports</span>
            <span className="bp-card-inclusion-value">{agentTemplateRuntimeLine(template)}</span>
          </div>
        </div>
      </Card>
    </Link>
  );
}

const GLYPHS = {
  sort: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path d="M3 3.5h7M3 6.5h5M3 9.5h3" strokeWidth="1.2" strokeLinecap="round" />
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
