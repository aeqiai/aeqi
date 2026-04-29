import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import type { CompanyTemplate } from "@/lib/types";
import { Button, Popover, Spinner, Tooltip } from "@/components/ui";
import { EmptyState } from "@/components/ui/EmptyState";
import PageRail from "@/components/PageRail";
import { BlueprintCard } from "@/components/blueprints/BlueprintCard";
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

/**
 * `/economy/blueprints` — catalog with a vertical PageRail (Companies /
 * Agents / Events / Quests / Ideas) on the left. Companies is the
 * canonical landing route at `/economy/blueprints`; the other kinds
 * live at `/economy/blueprints/:kind` and render empty-state
 * placeholders until v2.
 *
 * Toolbar grammar mirrors AgentIdeasTab — search · sort · filter · view ·
 * action — with chrome-zone (search + sort/filter/view popovers) and
 * action-zone (+ New company) tier rule. State is URL-persisted: q, sort,
 * tags (comma-separated), view.
 */
export default function BlueprintsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);

  const importIntoId = searchParams.get("import_into") || null;
  const isImportMode = !!importIntoId;

  // Resolve the active kind from the URL path. /economy/blueprints →
  // companies (default); /economy/blueprints/agents → agents, etc.
  // Anything that doesn't match a known kind falls back to companies —
  // this also covers the detail page (which uses a different route, but
  // defensively).
  const activeKind: Kind = useMemo(() => {
    const segments = location.pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1];
    return KIND_IDS.includes(last as Kind) ? (last as Kind) : "companies";
  }, [location.pathname]);

  const [blueprints, setBlueprints] = useState<CompanyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = searchParams.get("q") || "";
  const sortRaw = searchParams.get("sort");
  const sort: Sort = SORT_VALUES.has(sortRaw as Sort) ? (sortRaw as Sort) : "recent";
  const viewRaw = searchParams.get("view");
  const view: View = VIEW_VALUES.has(viewRaw as View) ? (viewRaw as View) : "grid";
  const selectedTags = useMemo(() => parseTags(searchParams.get("tags")), [searchParams]);

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

  // Tag universe — all unique tags across the catalog, ordered by
  // frequency so the most-shared tags surface first in the filter
  // popover (mirrors `tagCounts` in IdeasListView).
  const tagCounts = useMemo<[string, number][]>(() => {
    if (activeKind !== "companies") return [];
    const counts: Record<string, number> = {};
    for (const t of blueprints) {
      for (const tag of t.tags ?? []) counts[tag] = (counts[tag] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [blueprints, activeKind]);

  const complexity = useCallback(
    (t: CompanyTemplate) =>
      (t.seed_agents?.length ?? 0) +
      (t.seed_events?.length ?? 0) +
      (t.seed_ideas?.length ?? 0) +
      (t.seed_quests?.length ?? 0),
    [],
  );

  const filtered = useMemo(() => {
    if (activeKind !== "companies") return [] as CompanyTemplate[];
    let out = blueprints.filter(
      (t) => matches(t.name) || matches(t.tagline) || matchesTagText(t.tags),
    );
    if (selectedTags.length > 0) {
      const wanted = new Set(selectedTags);
      out = out.filter((t) => (t.tags ?? []).some((tag) => wanted.has(tag)));
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
    // sort === "recent" — preserve catalog order from the API.
    return out;
  }, [blueprints, activeKind, matches, matchesTagText, selectedTags, sort, complexity]);

  const importTargetSuffix = isImportMode ? `?import_into=${importIntoId}` : "";
  const filtersActive = query.trim() !== "" || selectedTags.length > 0;

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
      <PageRail
        tabs={KIND_TABS}
        defaultTab="companies"
        title="Blueprints"
        basePath="/economy/blueprints"
      />
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

            <FilterPopover tagCounts={tagCounts} selected={selectedTags} onChange={setTags} />

            <ToolbarRadioPopover
              label="View"
              current={VIEW_LABELS[view]}
              glyph={GLYPHS.view}
              options={VIEW_ORDER.map((v) => ({ id: v, label: VIEW_LABELS[v] }))}
              value={view}
              onChange={(next) => setSearchParam("view", next === "grid" ? null : next)}
            />

            {activeKind === "companies" && !isImportMode && (
              <Tooltip content="New company">
                <Button variant="primary" size="sm" onClick={() => navigate("/start")}>
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
                  New company
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
              action={<Link to="/economy/blueprints/companies">Open Companies →</Link>}
            />
          ) : filtered.length === 0 && filtersActive ? (
            <div className="ideas-list-filter-indicator">
              <span>
                <strong>0</strong> of {blueprints.length} blueprints match.
              </span>
              <button type="button" className="ideas-list-filter-reset" onClick={resetFilters}>
                Reset filters
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No Blueprints match."
              description="Try a shorter search."
              action={
                <button type="button" onClick={() => setSearchParam("q", "")}>
                  Show everything
                </button>
              }
            />
          ) : view === "list" ? (
            <ul className="bp-list" role="list">
              {filtered.map((t) => (
                <li key={t.slug} className="bp-list-row">
                  <button
                    type="button"
                    className="bp-list-row-btn"
                    onClick={() =>
                      navigate(
                        `/economy/blueprints/${encodeURIComponent(t.slug)}${importTargetSuffix}`,
                      )
                    }
                  >
                    <span className="bp-list-row-name">{t.name}</span>
                    {t.tagline && <span className="bp-list-row-tagline">{t.tagline}</span>}
                    <span className="bp-list-row-counts">
                      a{t.seed_agents?.length ?? 0} · i{t.seed_ideas?.length ?? 0} · e
                      {t.seed_events?.length ?? 0} · q{t.seed_quests?.length ?? 0}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="bp-grid" role="list">
              {filtered.map((t) => (
                <BlueprintCard key={t.slug} template={t} />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

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
}

/**
 * Tag-chip filter popover. Multi-select with OR semantics — picking
 * #founder and #product shows blueprints tagged with EITHER, mirroring
 * the additive idiom from `IdeasListView` (more chips → more rows).
 */
function FilterPopover({ tagCounts, selected, onChange }: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const active = selected.length;
  const hasTags = tagCounts.length > 0;

  const toggle = (tag: string) => {
    if (selected.includes(tag)) onChange(selected.filter((t) => t !== tag));
    else onChange([...selected, tag]);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(o) => hasTags && setOpen(o)}
      placement="bottom-end"
      trigger={
        <button
          type="button"
          className={`ideas-toolbar-btn${active > 0 ? " active" : ""}${open ? " open" : ""}${
            !hasTags ? " disabled" : ""
          }`}
          disabled={!hasTags}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={popoverId}
          title={
            !hasTags ? "No tags to filter on" : active > 0 ? `Filter — ${active} active` : "Filter"
          }
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
          {active > 0 && <span className="ideas-toolbar-btn-dot" aria-hidden />}
        </button>
      }
    >
      <div
        id={popoverId}
        className="ideas-filter-popover"
        role="dialog"
        aria-label="Filter blueprints"
      >
        <section className="ideas-filter-popover-section">
          <header className="ideas-filter-popover-head">
            <span className="ideas-filter-popover-label">tags</span>
            {active > 0 && (
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
                  onClick={() => toggle(tag)}
                >
                  #{tag}
                  <span className="ideas-tag-chip-count">{count}</span>
                </button>
              );
            })}
          </div>
        </section>
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
