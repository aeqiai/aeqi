import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import type { CompanyTemplate } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { Popover, Spinner } from "@/components/ui";
import { BlueprintCard } from "@/components/blueprints/BlueprintCard";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";

type Kind = "all" | "companies" | "agents" | "events" | "quests" | "ideas";
type Sort = "default" | "alpha" | "richness";
type View = "grid" | "list";

const KIND_LABELS: Record<Kind, string> = {
  all: "All",
  companies: "Companies",
  agents: "Agents",
  events: "Events",
  quests: "Quests",
  ideas: "Ideas",
};
const KIND_ORDER: Kind[] = ["all", "companies", "agents", "events", "quests", "ideas"];

const SORT_LABELS: Record<Sort, string> = {
  default: "Default order",
  alpha: "Name A→Z",
  richness: "Most seeds first",
};
const SORT_ORDER: Sort[] = ["default", "alpha", "richness"];

const VIEW_LABELS: Record<View, string> = { grid: "Grid", list: "List" };
const VIEW_ORDER: View[] = ["grid", "list"];

/**
 * `/blueprints` — catalog. Mirrors the Ideas page toolbar pattern:
 * search field + filter / sort / view popovers across the top, no add
 * button. Cards navigate to `/blueprints/:slug` for the inspect view;
 * launch happens on `/start?blueprint=:slug`.
 */
export default function BlueprintsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);
  const searchRef = useRef<HTMLInputElement>(null);

  const importIntoId = searchParams.get("import_into") || null;
  const isImportMode = !!importIntoId;
  const isAuthed = authMode === "none" || !!token;

  const [templates, setTemplates] = useState<CompanyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const query = searchParams.get("q") || "";
  const kind: Kind = (searchParams.get("kind") as Kind) || "all";
  const sort: Sort = (searchParams.get("sort") as Sort) || "default";
  const view: View = (searchParams.get("view") as View) || "grid";

  const setSearchParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(searchParams);
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  useEffect(() => {
    document.title = "Blueprints · aeqi";
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getTemplates()
      .then((resp) => {
        if (cancelled) return;
        const incoming = (resp as { templates?: CompanyTemplate[] })?.templates ?? [];
        setTemplates(incoming.length > 0 ? incoming : FALLBACK_TEMPLATES);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setTemplates(FALLBACK_TEMPLATES);
        setError(e.message || "Could not reach the Blueprint store.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // v1 only ships company-shaped Blueprints. The other filter kinds
  // (agents/events/quests/ideas) render an honest empty state until
  // the corresponding template.kind partitions land.
  const matches = useCallback(
    (h: string | undefined | null) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (h || "").toLowerCase().includes(q);
    },
    [query],
  );

  const filtered = useMemo(() => {
    if (kind !== "all" && kind !== "companies") return [] as CompanyTemplate[];
    const matched = templates.filter(
      (t) => matches(t.name) || matches(t.tagline) || matches(t.description),
    );
    if (sort === "alpha") {
      return [...matched].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    }
    if (sort === "richness") {
      const score = (t: CompanyTemplate) =>
        (t.seed_agents?.length ?? 0) +
        (t.seed_events?.length ?? 0) +
        (t.seed_ideas?.length ?? 0) +
        (t.seed_quests?.length ?? 0);
      return [...matched].sort((a, b) => score(b) - score(a));
    }
    return matched;
  }, [templates, kind, matches, sort]);

  const importTargetSuffix = isImportMode ? `?import_into=${importIntoId}` : "";

  const handleCustom = useCallback(() => {
    if (!isAuthed) {
      navigate("/signup?next=/new");
      return;
    }
    navigate(`/new${importTargetSuffix}`);
  }, [isAuthed, navigate, importTargetSuffix]);

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
    <div className="bp-page">
      <main className="bp-content">
        {isImportMode && (
          <div className="bp-import-banner" role="status">
            <span className="bp-import-banner-eyebrow">Import mode</span>
            <p className="bp-import-banner-line">
              Browse the catalog. Picking a Blueprint here will merge its seed agents, ideas,
              events, and quests into the selected agent&rsquo;s tree once the server merge endpoint
              lands.
            </p>
          </div>
        )}

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
              placeholder="Search Blueprints"
              aria-label="Search Blueprints"
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

          <ToolbarPopover
            label="Sort"
            current={SORT_LABELS[sort]}
            glyph={GLYPHS.sort}
            options={SORT_ORDER.map((s) => ({ id: s, label: SORT_LABELS[s] }))}
            value={sort}
            onChange={(next) => setSearchParam("sort", next === "default" ? null : next)}
          />

          <ToolbarPopover
            label="Filter"
            current={KIND_LABELS[kind]}
            glyph={GLYPHS.filter}
            options={KIND_ORDER.map((k) => ({ id: k, label: KIND_LABELS[k] }))}
            value={kind}
            onChange={(next) => setSearchParam("kind", next === "all" ? null : next)}
          />

          <ToolbarPopover
            label="View"
            current={VIEW_LABELS[view]}
            glyph={GLYPHS.view}
            options={VIEW_ORDER.map((v) => ({ id: v, label: VIEW_LABELS[v] }))}
            value={view}
            onChange={(next) => setSearchParam("view", next === "grid" ? null : next)}
          />
        </div>

        {error && (
          <div className="bp-error" role="alert">
            {error} — showing default Blueprints.
          </div>
        )}

        {loading ? (
          <div className="bp-status">
            <Spinner size="sm" /> Loading Blueprints…
          </div>
        ) : filtered.length === 0 ? (
          kind === "all" || kind === "companies" ? (
            <div className="bp-empty">
              <p className="bp-empty-title">No Blueprints match.</p>
              <p className="bp-empty-sub">
                Try a shorter search.{" "}
                <button
                  type="button"
                  className="bp-empty-link"
                  onClick={() => setSearchParam("q", "")}
                >
                  Show everything
                </button>
              </p>
            </div>
          ) : (
            <div className="bp-empty">
              <p className="bp-empty-title">
                Standalone {KIND_LABELS[kind]} Blueprints — coming soon.
              </p>
              <p className="bp-empty-sub">
                v1 ships Companies — full org bundles with agents, ideas, events, and quests
                pre-threaded. Standalone primitives land next.
              </p>
            </div>
          )
        ) : view === "list" ? (
          <ul className="bp-list" role="list">
            {filtered.map((t) => (
              <li key={t.slug} className="bp-list-row">
                <button
                  type="button"
                  className="bp-list-row-btn"
                  onClick={() =>
                    navigate(`/blueprints/${encodeURIComponent(t.slug)}${importTargetSuffix}`)
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
            {filtered.map((t, i) => (
              <BlueprintCard key={t.slug} template={t} index={i} />
            ))}
          </div>
        )}

        {!loading && (
          <div className="bp-foot-custom">
            <button type="button" className="bp-foot-custom-btn" onClick={handleCustom}>
              <span aria-hidden="true">+</span>
              <span>Start blank — custom agent without a Blueprint</span>
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

interface ToolbarPopoverProps<T extends string> {
  label: string;
  current: string;
  glyph: ReactElement;
  options: { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}

function ToolbarPopover<T extends string>({
  label,
  current,
  glyph,
  options,
  value,
  onChange,
}: ToolbarPopoverProps<T>) {
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

const GLYPHS = {
  sort: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path d="M3 3.5h7M3 6.5h5M3 9.5h3" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  filter: (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" aria-hidden>
      <path d="M2 3.5h9M3.5 6.5h6M5 9.5h3" strokeWidth="1.2" strokeLinecap="round" />
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
