import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import type { CompanyTemplate } from "@/lib/types";
import SpawnTemplateModal from "@/components/SpawnTemplateModal";
import BlueprintGallery, { type IdentitySummary } from "@/components/BlueprintGallery";
import { Spinner } from "@/components/ui";
import "@/styles/templates.css";

type Category = "all" | "companies" | "personas";

const CATEGORIES: { id: Category; label: string }[] = [
  { id: "all", label: "All" },
  { id: "companies", label: "Companies" },
  { id: "personas", label: "Personas" },
];

/**
 * /blueprints — the front door of æqi. A user picks a company blueprint
 * and within seconds is inside a fully-threaded runtime (seed agents,
 * events, ideas, quests already alive). Grid + card rendering lives in
 * `<BlueprintGallery>`; this page is the data + spawn-modal shell.
 *
 * Renamed: /templates → /library → /blueprints. Same data underneath,
 * but the surface stops being framed as just "templates" or "library"
 * and gets framed as the architectural plans the runtime spawns from.
 * Over time this grows into the proper store (skills, packs, workflows,
 * future distributable blueprints).
 *
 * Data flow:
 *   - On mount, try `GET /api/templates`. On any failure, fall back to
 *     local fixtures so the store is never empty.
 *   - `?start=<slug>` and `?template=<slug>` both deep-link into the
 *     gallery preview for that slug. After close, the param is stripped
 *     from the URL so the preview doesn't re-open on state changes.
 */
export default function BlueprintsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [templates, setTemplates] = useState<CompanyTemplate[]>([]);
  const [identities, setIdentities] = useState<IdentitySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalTemplate, setModalTemplate] = useState<CompanyTemplate | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");

  useEffect(() => {
    document.title = "blueprints · æqi";
  }, []);

  // Fetch both catalogs in parallel. Companies and personas are
  // independent surfaces — a failure on either side falls back to its
  // own default so the marketplace is never empty on one axis because
  // the other endpoint hiccupped.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      api.getTemplates().catch((e: Error) => {
        return { ok: false, templates: FALLBACK_TEMPLATES, _err: e };
      }),
      api.getIdentityTemplates().catch(() => {
        return { ok: false, identities: [] };
      }),
    ])
      .then(([co, id]) => {
        if (cancelled) return;
        const incoming = Array.isArray((co as { templates?: CompanyTemplate[] })?.templates)
          ? ((co as { templates: CompanyTemplate[] }).templates ?? [])
          : [];
        setTemplates(incoming.length > 0 ? incoming : FALLBACK_TEMPLATES);
        const ids = Array.isArray((id as { identities?: IdentitySummary[] })?.identities)
          ? ((id as { identities: IdentitySummary[] }).identities ?? [])
          : [];
        setIdentities(ids);
        const errInside = (co as { _err?: Error })?._err;
        if (errInside) {
          setError(errInside.message || "Could not reach the blueprint store.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Filter view — search query + active category. Search is a simple
  // substring match across name / tagline / description; case-insensitive.
  const matches = useCallback(
    (haystack: string | undefined | null) => {
      if (!query.trim()) return true;
      if (!haystack) return false;
      return haystack.toLowerCase().includes(query.trim().toLowerCase());
    },
    [query],
  );

  const visibleCompanies = useMemo(() => {
    if (category !== "all" && category !== "companies") return [];
    return templates.filter((t) => matches(t.name) || matches(t.tagline) || matches(t.description));
  }, [templates, category, matches]);

  const visiblePersonas = useMemo(() => {
    if (category !== "all" && category !== "personas") return [];
    return identities.filter(
      (i) => matches(i.name) || matches(i.display_name) || matches(i.description),
    );
  }, [identities, category, matches]);

  const totalVisible = visibleCompanies.length + visiblePersonas.length;

  const cleanDeepLinkParams = useCallback(() => {
    if (!searchParams.has("start") && !searchParams.has("template")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("start");
    next.delete("template");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handlePick = useCallback(
    (slug: string, kind: "company" | "identity") => {
      if (kind !== "company") return;
      const tpl = templates.find((t) => t.slug === slug);
      if (tpl) setModalTemplate(tpl);
    },
    [templates],
  );

  const closeModal = useCallback(() => {
    setModalTemplate(null);
    cleanDeepLinkParams();
  }, [cleanDeepLinkParams]);

  const handleSpawned = useCallback(
    (rootAgentId: string) => {
      // Land users inside their new company: sessions tab is where the
      // chat lives, so they can start talking immediately.
      navigate(`/${encodeURIComponent(rootAgentId)}/sessions`);
    },
    [navigate],
  );

  const initialSlug = searchParams.get("start") || searchParams.get("template") || undefined;

  return (
    <div className="tpl-page">
      <div className="tpl-inner">
        <header className="tpl-hero">
          <h1 className="tpl-title">blueprints — explore the runtime catalog.</h1>
          <p className="tpl-subtitle">
            companies you can spawn, personas you can hire, more coming. each blueprint lands you in
            a fully-threaded runtime — agents, events, ideas, quests already alive. pick one, name
            it, start talking.
          </p>
        </header>

        <div className="tpl-toolbar" role="toolbar" aria-label="Filter blueprints">
          <div className="tpl-search-wrap">
            <svg
              className="tpl-search-icon"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="6" cy="6" r="4" stroke="currentColor" strokeWidth="1.4" />
              <path d="M9 9l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              className="tpl-search-input"
              placeholder="search blueprints…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search blueprints by name or description"
            />
          </div>
          <div className="tpl-filter-pills" role="tablist" aria-label="Blueprint category">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={category === c.id}
                className={`tpl-filter-pill${category === c.id ? " is-active" : ""}`}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="tpl-error" role="alert">
            {error} — showing default blueprints.
          </div>
        )}

        {loading ? (
          <div className="tpl-status">
            <Spinner size="sm" />
            loading blueprints…
          </div>
        ) : totalVisible === 0 ? (
          <div className="tpl-empty">
            <p className="tpl-empty-title">no blueprints match.</p>
            <p className="tpl-empty-sub">
              try a shorter search, or switch category to{" "}
              <button
                type="button"
                className="tpl-empty-link"
                onClick={() => {
                  setQuery("");
                  setCategory("all");
                }}
              >
                show everything
              </button>
              .
            </p>
          </div>
        ) : (
          <BlueprintGallery
            companyTemplates={visibleCompanies}
            identityTemplates={visiblePersonas}
            onPick={handlePick}
            initialSlug={initialSlug}
            onPreviewClose={cleanDeepLinkParams}
            showKindBadge
          />
        )}
      </div>

      <SpawnTemplateModal
        template={modalTemplate}
        open={Boolean(modalTemplate)}
        onClose={closeModal}
        onSpawned={handleSpawned}
      />
    </div>
  );
}
