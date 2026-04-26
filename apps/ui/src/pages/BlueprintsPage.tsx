import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import type { CompanyTemplate } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { Input, Spinner } from "@/components/ui";
import PageRail from "@/components/PageRail";
import { BlueprintCard } from "@/components/blueprints/BlueprintCard";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";

const FILTERS = [
  { id: "companies", label: "Companies" },
  { id: "agents", label: "Agents" },
  { id: "events", label: "Events" },
  { id: "quests", label: "Quests" },
  { id: "ideas", label: "Ideas" },
];

type FilterId = (typeof FILTERS)[number]["id"];

/**
 * `/blueprints` — catalog. Two columns: filter rail on the left, search +
 * card grid on the right. Selecting a card navigates to
 * `/blueprints/:slug`; the right-side preview pane was retired in favor
 * of a dedicated detail surface.
 */
export default function BlueprintsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);

  const importIntoId = searchParams.get("import_into") || null;
  const isImportMode = !!importIntoId;
  const isAuthed = authMode === "none" || !!token;

  const [templates, setTemplates] = useState<CompanyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const filterParam = searchParams.get("tab");
  const filter: FilterId =
    filterParam && FILTERS.some((f) => f.id === filterParam)
      ? (filterParam as FilterId)
      : "companies";

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
        setError(e.message || "Could not reach the blueprint store.");
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

  // v1 only ships company-shaped blueprints. The other filter tabs
  // (agents/events/quests/ideas) are present so the affordance is
  // discoverable, but they intentionally render an empty grid until
  // the corresponding template.kind partitions land.
  const visible = useMemo(() => {
    if (filter !== "companies") return [];
    return templates.filter((t) => matches(t.name) || matches(t.tagline) || matches(t.description));
  }, [templates, filter, matches]);

  const importTargetSuffix = isImportMode ? `?import_into=${importIntoId}` : "";

  const handleCustom = useCallback(() => {
    if (!isAuthed) {
      navigate("/signup?next=/new");
      return;
    }
    navigate(`/new${importTargetSuffix}`);
  }, [isAuthed, navigate, importTargetSuffix]);

  return (
    <div className="bp-page">
      <PageRail tabs={FILTERS} defaultTab="companies" title="Blueprints" />

      <main className="bp-content">
        {isImportMode && (
          <div className="bp-import-banner" role="status">
            <span className="bp-import-banner-eyebrow">Import mode</span>
            <p className="bp-import-banner-line">
              Browse the catalog. Picking a blueprint here will merge its seed agents, ideas,
              events, and quests into the selected agent&rsquo;s tree once the server merge endpoint
              lands.
            </p>
          </div>
        )}
        <header className="bp-hero">
          <h1 className="bp-hero-title">Blueprints.</h1>
          <p className="bp-hero-lede">
            Companies you can spawn in seconds — agents, ideas, events, and quests already alive.
            Pick one, name it, start talking.
          </p>
        </header>

        <div className="bp-toolbar" role="toolbar" aria-label="Search Blueprints">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Blueprints…"
            aria-label="Search Blueprints"
            size="md"
            className="bp-search-input"
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
        ) : (
          <div className="bp-grid" role="list">
            <button
              type="button"
              role="listitem"
              className="bp-card bp-card-custom"
              onClick={handleCustom}
              title="Build a custom agent without a blueprint"
            >
              <span className="bp-card-custom-glyph" aria-hidden="true">
                +
              </span>
              <span className="bp-card-custom-title">Start Blank</span>
              <span className="bp-card-custom-sub">A custom agent, no Blueprint.</span>
            </button>

            {visible.map((t, i) => (
              <BlueprintCard key={t.slug} template={t} index={i} />
            ))}

            {visible.length === 0 &&
              (filter === "companies" ? (
                <div className="bp-empty">
                  <p className="bp-empty-title">No Blueprints match.</p>
                  <p className="bp-empty-sub">
                    Try a shorter search.{" "}
                    <button type="button" className="bp-empty-link" onClick={() => setQuery("")}>
                      Show everything
                    </button>
                  </p>
                </div>
              ) : (
                <div className="bp-empty">
                  <p className="bp-empty-title">
                    Standalone {FILTERS.find((f) => f.id === filter)?.label} Blueprints — coming
                    soon.
                  </p>
                  <p className="bp-empty-sub">
                    v1 ships Companies — full org bundles with agents, ideas, events, and quests
                    pre-threaded. Standalone primitives land next.
                  </p>
                </div>
              ))}
          </div>
        )}
      </main>
    </div>
  );
}
