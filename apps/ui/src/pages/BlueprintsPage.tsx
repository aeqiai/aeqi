import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { Blueprint, BlueprintCategory, SingleBlueprint, StackBlueprint } from "@/lib/types";
import { isSingleBlueprint, isStackBlueprint } from "@/lib/types";
import { Button, Card, Popover, Spinner, Tooltip } from "@/components/ui";
import { EmptyState } from "@/components/ui/EmptyState";
import PageRail from "@/components/PageRail";
import { BlueprintCard } from "@/components/blueprints/BlueprintCard";
import { StackWizard } from "@/components/StackWizard";
import { parseTags, serializeTags } from "@/components/ideas/types";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";

type Kind = "companies" | "agents" | "events" | "quests" | "ideas";
type Sort = "recent" | "alpha-asc" | "alpha-desc" | "complexity";
type View = "grid" | "list";

const KIND_TABS: { id: Kind; label: string }[] = [
  { id: "companies", label: "Companies" },
  { id: "agents", label: "Agents" },
  { id: "events", label: "Events" },
  { id: "quests", label: "Quests" },
  { id: "ideas", label: "Ideas" },
];
const KIND_IDS = KIND_TABS.map((t) => t.id);

const SORT_LABELS: Record<Sort, string> = {
  recent: "Recently added",
  "alpha-asc": "Name (A→Z)",
  "alpha-desc": "Name (Z→A)",
  complexity: "Complexity",
};
const SORT_ORDER: Sort[] = ["recent", "alpha-asc", "alpha-desc", "complexity"];
const SORT_VALUES = new Set<Sort>(SORT_ORDER);

const VIEW_LABELS: Record<View, string> = { grid: "Grid", list: "List" };
const VIEW_ORDER: View[] = ["grid", "list"];
const VIEW_VALUES = new Set<View>(VIEW_ORDER);

/** Display order for category sections. Foundation always shown (even empty). */
const CATEGORY_ORDER: BlueprintCategory[] = ["company", "foundation", "fund"];

const CATEGORY_LABELS: Record<BlueprintCategory, string> = {
  company: "Company",
  foundation: "Foundation",
  fund: "Fund",
};

const CATEGORY_DESCRIPTIONS: Record<BlueprintCategory, string> = {
  company: "Smart account with role-based governance",
  foundation: "Public-good org with grant flows",
  fund: "LP cap table for investment vehicles",
};

/** Set of valid category param values. */
const CATEGORY_VALUES = new Set<BlueprintCategory>(CATEGORY_ORDER);

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardStack, setWizardStack] = useState<StackBlueprint | null>(null);

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
    document.title = `${KIND_TABS.find((t) => t.id === activeKind)?.label ?? "Blueprints"} · Blueprints · aeqi`;
  }, [activeKind]);

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
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message || "Could not reach the Blueprint store.");
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

  // Separate stacks from singles up front.
  const stackBlueprints = useMemo(() => blueprints.filter(isStackBlueprint), [blueprints]);
  const singleBlueprints = useMemo(
    () => blueprints.filter(isSingleBlueprint) as SingleBlueprint[],
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
      (t.seed_agents?.length ?? 0) +
      (t.seed_events?.length ?? 0) +
      (t.seed_ideas?.length ?? 0) +
      (t.seed_quests?.length ?? 0),
    [],
  );

  // Global filtered list respecting search + tag + optional category filter.
  // Operates on single blueprints only; stacks have their own section.
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

  const importTargetSuffix = isImportMode ? `?import_into=${importIntoId}` : "";
  const filtersActive = query.trim() !== "" || selectedTags.length > 0 || !!activeCategory;
  const totalFiltered = filtered.length;

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

  const searchPlaceholder = `Search ${activeKind === "companies" ? "Blueprints" : KIND_TABS.find((t) => t.id === activeKind)?.label}`;

  return (
    <div className="page-rail-shell">
      <PageRail tabs={KIND_TABS} defaultTab="companies" title="Blueprints" basePath="/blueprints" />
      <main className="page-rail-content page-rail-content--full">
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
                type="search"
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                value={query}
                onChange={(e) => setSearchParam("q", e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    if (query) setSearchParam("q", "");
                    else (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              {!query && (
                <kbd className="ideas-list-search-kbd" aria-hidden>
                  /
                </kbd>
              )}
              {query && (
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

            <FilterPopover
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

            {activeKind === "companies" && !isImportMode && (
              <Tooltip content="New organization">
                <Button variant="primary" size="sm" onClick={() => navigate("/launch")}>
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
                  Launch organization
                </Button>
              </Tooltip>
            )}
          </div>
        </div>

        <div className="bp-catalog-body">
          {isImportMode && (
            <div className="bp-import-banner" role="status">
              <span className="bp-import-banner-eyebrow">Import mode</span>
              <p className="bp-import-banner-line">
                Browse the catalog. Picking a Blueprint here will merge its seed agents, ideas,
                events, and quests into the selected agent&rsquo;s tree once the server merge
                endpoint lands.
              </p>
            </div>
          )}

          {error && (
            <div className="bp-error" role="alert">
              {error} — showing default Blueprints.
            </div>
          )}

          {loading && activeKind === "companies" ? (
            <div className="bp-status">
              <Spinner size="sm" /> Loading Blueprints…
            </div>
          ) : activeKind !== "companies" ? (
            <EmptyState
              title={`No standalone ${KIND_TABS.find((t) => t.id === activeKind)?.label.toLowerCase()} yet.`}
              description="v1 ships Companies — full org bundles with agents, ideas, events, and quests pre-threaded. Standalone primitive bundles land next."
              action={<Link to="/blueprints/companies">Open Companies →</Link>}
            />
          ) : totalFiltered === 0 && filtersActive ? (
            <div className="ideas-list-filter-indicator">
              <span>
                <strong>0</strong> of {singleBlueprints.length} blueprints match.
              </span>
              <button type="button" className="ideas-list-filter-reset" onClick={resetFilters}>
                Reset filters
              </button>
            </div>
          ) : (
            <div className="bp-catalog-sections">
              {/* Stack templates section — shown above category sections when stacks exist */}
              {!isImportMode && stackBlueprints.length > 0 && (
                <StackSection stacks={stackBlueprints} onLaunch={setWizardStack} />
              )}
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

      {wizardStack && (
        <StackWizard
          stack={wizardStack}
          open={!!wizardStack}
          onClose={() => setWizardStack(null)}
        />
      )}
    </div>
  );
}

/* ── Category section ─────────────────────────────────── */

interface BlueprintCategorySectionProps {
  category: BlueprintCategory;
  blueprints: SingleBlueprint[];
  view: View;
  importTargetSuffix: string;
  isActiveFilter: boolean;
  onCategoryFilter: () => void;
  onNavigate: (path: string) => void;
}

function BlueprintCategorySection({
  category,
  blueprints,
  view,
  importTargetSuffix,
  isActiveFilter,
  onCategoryFilter,
  onNavigate,
}: BlueprintCategorySectionProps) {
  const label = CATEGORY_LABELS[category];
  const description = CATEGORY_DESCRIPTIONS[category];
  const count = blueprints.length;
  const isEmpty = count === 0;

  return (
    <section
      className={`bp-category-section${isActiveFilter ? " bp-category-section--active" : ""}`}
    >
      <header className="bp-category-header">
        <div className="bp-category-header-main">
          <button
            type="button"
            className={`bp-category-name${isActiveFilter ? " active" : ""}`}
            onClick={onCategoryFilter}
            title={isActiveFilter ? `Show all categories` : `Filter to ${label}`}
          >
            {label}
          </button>
          <span className="bp-category-count">{count}</span>
          <span className="bp-category-desc">{description}</span>
        </div>
      </header>

      {isEmpty ? (
        <div className="bp-category-empty">More archetypes coming soon.</div>
      ) : view === "list" ? (
        <ul className="bp-list" role="list">
          {blueprints.map((t) => (
            <li key={t.slug} className="bp-list-row">
              <button
                type="button"
                className="bp-list-row-btn"
                onClick={() =>
                  onNavigate(`/blueprints/${encodeURIComponent(t.slug)}${importTargetSuffix}`)
                }
              >
                <span className="bp-list-row-name">{t.name}</span>
                {t.tagline && <span className="bp-list-row-tagline">{t.tagline}</span>}
                <span className="bp-list-row-counts">
                  {t.template ?? "entity"} · {(t.seed_agents?.length ?? 0) + 1} agents
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="bp-grid" role="list">
          {blueprints.map((t) => (
            <BlueprintCard key={t.slug} template={t} importTargetSuffix={importTargetSuffix} />
          ))}
        </div>
      )}
    </section>
  );
}

/* ── Stack section ────────────────────────────────────── */

interface StackSectionProps {
  stacks: StackBlueprint[];
  onLaunch: (stack: StackBlueprint) => void;
}

function StackSection({ stacks, onLaunch }: StackSectionProps) {
  return (
    <section className="bp-category-section">
      <header className="bp-category-header">
        <div className="bp-category-header-main">
          <span className="bp-category-name" style={{ cursor: "default" }}>
            Multi-company stacks
          </span>
          <span className="bp-category-count">{stacks.length}</span>
          <span className="bp-category-desc">
            Deploy N companies + cross-company edges in one flow
          </span>
        </div>
      </header>
      <div className="bp-grid" role="list">
        {stacks.map((s) => (
          <StackCard key={s.id} stack={s} onLaunch={onLaunch} />
        ))}
      </div>
    </section>
  );
}

interface StackCardProps {
  stack: StackBlueprint;
  onLaunch: (stack: StackBlueprint) => void;
}

function StackCard({ stack, onLaunch }: StackCardProps) {
  const componentLabel = `${stack.component_count} ${stack.component_count === 1 ? "company" : "companies"}`;
  const edgeLabel =
    stack.edge_count > 0
      ? ` · ${stack.edge_count} ${stack.edge_count === 1 ? "edge" : "edges"}`
      : "";

  return (
    <button
      type="button"
      className="bp-card-link bp-stack-card-btn"
      role="listitem"
      aria-label={`${stack.name} stack — ${stack.tagline}`}
      onClick={() => onLaunch(stack)}
    >
      <Card variant="default" padding="md" interactive className="bp-card">
        <h3 className="bp-card-name">{stack.name}</h3>
        {stack.tagline && <p className="bp-card-tagline">{stack.tagline}</p>}
        <div className="bp-card-inclusions">
          <div className="bp-card-inclusion-row">
            <span className="bp-card-inclusion-label">Contains</span>
            <span className="bp-card-inclusion-value">
              {componentLabel}
              {edgeLabel}
            </span>
          </div>
          {stack.components.length > 0 && (
            <div className="bp-card-inclusion-row">
              <span className="bp-card-inclusion-label">Layout</span>
              <span className="bp-card-inclusion-value">
                {stack.umbrella_slot && `${stack.umbrella_slot} → `}
                {stack.components
                  .filter((c) => c.slot !== stack.umbrella_slot)
                  .map((c) => c.slot)
                  .join(", ")}
              </span>
            </div>
          )}
        </div>
      </Card>
    </button>
  );
}

/* ── Toolbar popovers ─────────────────────────────────── */

interface ToolbarRadioPopoverProps<T extends string> {
  label: string;
  current: string;
  glyph: ReactElement;
  options: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}

function ToolbarRadioPopover<T extends string>({
  label,
  current,
  glyph,
  options,
  value,
  onChange,
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
          className={`ideas-toolbar-btn${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${label}: ${current}`}
          title={`${label}: ${current}`}
        >
          {glyph}
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

interface FilterPopoverProps {
  tagCounts: [string, number][];
  selected: string[];
  onChange: (next: string[]) => void;
  activeCategory: BlueprintCategory | null;
  onCategoryChange: (cat: BlueprintCategory | null) => void;
}

/**
 * Combined tag + category filter popover. Tags: multi-select OR. Category: single
 * select (clicking again deselects). Both persist in URL.
 */
function FilterPopover({
  tagCounts,
  selected,
  onChange,
  activeCategory,
  onCategoryChange,
}: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const activeTagCount = selected.length;
  const hasFilters = tagCounts.length > 0 || true; // category filter always available

  const toggleTag = (tag: string) => {
    if (selected.includes(tag)) onChange(selected.filter((t) => t !== tag));
    else onChange([...selected, tag]);
  };

  const toggleCategory = (cat: BlueprintCategory) => {
    onCategoryChange(activeCategory === cat ? null : cat);
  };

  const totalActive = activeTagCount + (activeCategory ? 1 : 0);

  return (
    <Popover
      open={open}
      onOpenChange={(o) => hasFilters && setOpen(o)}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={`ideas-toolbar-btn${totalActive > 0 ? " active" : ""}${open ? " open" : ""}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          aria-label={totalActive > 0 ? `Filter — ${totalActive} active` : "Filter"}
          title={totalActive > 0 ? `Filter — ${totalActive} active` : "Filter"}
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            aria-hidden
          >
            <path d="M2 3.25h9M3.5 6.5h6M5 9.75h3" />
          </svg>
          {totalActive > 0 && <span className="ideas-toolbar-btn-dot" aria-hidden />}
        </button>
      }
    >
      <div
        id={popoverId}
        className="ideas-filter-popover"
        role="dialog"
        aria-label="Filter blueprints"
      >
        {/* Category filter */}
        <section className="ideas-filter-popover-section">
          <header className="ideas-filter-popover-head">
            <span className="ideas-filter-popover-label">category</span>
            {activeCategory && (
              <button
                type="button"
                className="ideas-filter-popover-reset"
                onClick={() => onCategoryChange(null)}
              >
                reset
              </button>
            )}
          </header>
          <div className="ideas-filter-popover-list" role="group" aria-label="Filter by category">
            {CATEGORY_ORDER.map((cat) => {
              const isActive = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  aria-pressed={isActive}
                  className={`ideas-filter-row${isActive ? " active" : ""}`}
                  onClick={() => toggleCategory(cat)}
                >
                  <span className="ideas-filter-row-label">{CATEGORY_LABELS[cat]}</span>
                </button>
              );
            })}
          </div>
        </section>

        {/* Tag filter — only when tags exist */}
        {tagCounts.length > 0 && (
          <section className="ideas-filter-popover-section">
            <header className="ideas-filter-popover-head">
              <span className="ideas-filter-popover-label">tags</span>
              {activeTagCount > 0 && (
                <button
                  type="button"
                  className="ideas-filter-popover-reset"
                  onClick={() => onChange([])}
                >
                  reset
                </button>
              )}
            </header>
            <div className="ideas-list-tags" role="group" aria-label="Filter by tag">
              {tagCounts.map(([tag, count]) => {
                const isActive = selected.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    aria-pressed={isActive}
                    className={`ideas-tag-chip${isActive ? " active" : ""}`}
                    onClick={() => toggleTag(tag)}
                  >
                    #{tag}
                    <span className="ideas-tag-chip-count">{count}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
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
  view: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <rect x="2" y="2" width="3.5" height="3.5" strokeWidth="1.2" rx="0.4" />
      <rect x="7.5" y="2" width="3.5" height="3.5" strokeWidth="1.2" rx="0.4" />
      <rect x="2" y="7.5" width="3.5" height="3.5" strokeWidth="1.2" rx="0.4" />
      <rect x="7.5" y="7.5" width="3.5" height="3.5" strokeWidth="1.2" rx="0.4" />
    </svg>
  ),
} as const;
