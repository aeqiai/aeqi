import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import type { CompanyTemplate } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { Spinner } from "@/components/ui";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";

type Filter = "all" | "companies";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "companies", label: "Companies" },
];

export default function BlueprintsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);
  const setActiveRoot = useUIStore((s) => s.setActiveRoot);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);

  const [templates, setTemplates] = useState<CompanyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "blueprints · æqi";
  }, []);

  const isAuthed = authMode === "none" || !!token;

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

  const visible = useMemo(() => {
    if (filter !== "all" && filter !== "companies") return [];
    return templates.filter((t) => matches(t.name) || matches(t.tagline) || matches(t.description));
  }, [templates, filter, matches]);

  const selected = useMemo(
    () => (selectedSlug ? templates.find((t) => t.slug === selectedSlug) || null : null),
    [selectedSlug, templates],
  );

  useEffect(() => {
    setCompanyName(selected?.name || "");
    setSubmitError(null);
  }, [selected?.slug, selected?.name]);

  useEffect(() => {
    const deepSlug = searchParams.get("start") || searchParams.get("template");
    if (!deepSlug || templates.length === 0) return;
    if (templates.some((t) => t.slug === deepSlug)) {
      setSelectedSlug(deepSlug);
    }
  }, [searchParams, templates]);

  const cleanDeepLinkParams = useCallback(() => {
    if (!searchParams.has("start") && !searchParams.has("template")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("start");
    next.delete("template");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleSelect = useCallback(
    (slug: string) => {
      setSelectedSlug(slug);
      cleanDeepLinkParams();
    },
    [cleanDeepLinkParams],
  );

  const handleClose = useCallback(() => {
    setSelectedSlug(null);
    setSubmitError(null);
    cleanDeepLinkParams();
  }, [cleanDeepLinkParams]);

  const handleCustom = useCallback(() => {
    if (!isAuthed) {
      navigate("/signup?next=/new");
      return;
    }
    navigate("/new");
  }, [isAuthed, navigate]);

  const handleSpawn = useCallback(async () => {
    if (!selected) return;
    if (!isAuthed) {
      navigate(`/signup?next=/blueprints?start=${encodeURIComponent(selected.slug)}`);
      return;
    }
    const trimmed = companyName.trim();
    if (!trimmed) {
      setSubmitError("Pick a name for your company.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const resp = await api.spawnTemplate({ template: selected.slug, name: trimmed });
      const rootId = (resp as { root_agent_id?: string })?.root_agent_id;
      if (!rootId) throw new Error("Spawn returned no root agent id.");
      setActiveRoot(rootId);
      await fetchAgents();
      navigate(`/${encodeURIComponent(rootId)}/sessions`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not spawn the blueprint.";
      setSubmitError(msg);
      setSubmitting(false);
    }
  }, [selected, isAuthed, companyName, setActiveRoot, fetchAgents, navigate]);

  return (
    <div className="bp-page">
      <aside className="bp-rail" aria-label="Blueprint filters">
        <h2 className="bp-rail-title">Blueprints</h2>
        <ul className="bp-rail-list" role="tablist">
          {FILTERS.map((f) => (
            <li key={f.id}>
              <button
                type="button"
                role="tab"
                aria-selected={filter === f.id}
                className={`bp-rail-item${filter === f.id ? " active" : ""}`}
                onClick={() => setFilter(f.id)}
              >
                <span className="bp-rail-label">{f.label}</span>
                <span className="bp-rail-count">
                  {f.id === "all" ? templates.length : templates.length}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="bp-rail-foot">
          <button type="button" className="bp-rail-custom" onClick={handleCustom}>
            <span aria-hidden="true">+</span>
            <span>Custom agent</span>
          </button>
        </div>
      </aside>

      <main className="bp-content">
        <header className="bp-hero">
          <h1 className="bp-hero-title">blueprints.</h1>
          <p className="bp-hero-lede">
            companies you can spawn in seconds — agents, ideas, events, and quests already alive.
            pick one, name it, start talking.
          </p>
        </header>

        <div className="bp-toolbar" role="toolbar" aria-label="Search blueprints">
          <div className="bp-search-wrap">
            <svg className="bp-search-icon" viewBox="0 0 14 14" aria-hidden="true">
              <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
              <path
                d="M9 9l3 3"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
            <input
              type="search"
              className="bp-search-input"
              placeholder="search blueprints…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search blueprints"
            />
          </div>
        </div>

        {error && (
          <div className="bp-error" role="alert">
            {error} — showing default blueprints.
          </div>
        )}

        {loading ? (
          <div className="bp-status">
            <Spinner size="sm" /> loading blueprints…
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
              <span className="bp-card-custom-title">Start blank</span>
              <span className="bp-card-custom-sub">A custom agent, no blueprint.</span>
            </button>

            {visible.map((t) => (
              <BlueprintCard
                key={t.slug}
                template={t}
                active={selectedSlug === t.slug}
                onSelect={() => handleSelect(t.slug)}
              />
            ))}

            {visible.length === 0 && (
              <div className="bp-empty">
                <p className="bp-empty-title">no blueprints match.</p>
                <p className="bp-empty-sub">
                  try a shorter search.{" "}
                  <button
                    type="button"
                    className="bp-empty-link"
                    onClick={() => {
                      setQuery("");
                      setFilter("all");
                    }}
                  >
                    show everything
                  </button>
                </p>
              </div>
            )}
          </div>
        )}
      </main>

      <aside className={`bp-detail${selected ? " is-open" : ""}`} aria-label="Blueprint detail">
        {selected ? (
          <BlueprintDetail
            template={selected}
            companyName={companyName}
            onCompanyNameChange={setCompanyName}
            onClose={handleClose}
            onSpawn={handleSpawn}
            submitting={submitting}
            submitError={submitError}
            isAuthed={isAuthed}
          />
        ) : (
          <BlueprintDetailEmpty />
        )}
      </aside>
    </div>
  );
}

function BlueprintCard({
  template,
  active,
  onSelect,
}: {
  template: CompanyTemplate;
  active: boolean;
  onSelect: () => void;
}) {
  const counts = {
    a: template.seed_agents?.length ?? 0,
    i: template.seed_ideas?.length ?? 0,
    e: template.seed_events?.length ?? 0,
    q: template.seed_quests?.length ?? 0,
  };
  return (
    <button
      type="button"
      role="listitem"
      className={`bp-card${active ? " active" : ""}`}
      onClick={onSelect}
    >
      <h3 className="bp-card-name">{template.name}</h3>
      {template.tagline && <p className="bp-card-tagline">{template.tagline}</p>}
      <div className="bp-card-monograms" aria-label="seed counts">
        {(["a", "i", "e", "q"] as const).map((l) => (
          <span key={l} className="bp-card-mono">
            <span className="bp-card-mono-l">{l}</span>
            <span className="bp-card-mono-n">{counts[l]}</span>
          </span>
        ))}
      </div>
    </button>
  );
}

function BlueprintDetailEmpty() {
  return (
    <div className="bp-detail-empty">
      <p className="bp-detail-empty-eyebrow">Pick a blueprint</p>
      <p className="bp-detail-empty-line">
        Each one spins up a fully-threaded runtime — agents, events, ideas, and quests already alive
        when you land.
      </p>
    </div>
  );
}

function BlueprintDetail({
  template,
  companyName,
  onCompanyNameChange,
  onClose,
  onSpawn,
  submitting,
  submitError,
  isAuthed,
}: {
  template: CompanyTemplate;
  companyName: string;
  onCompanyNameChange: (v: string) => void;
  onClose: () => void;
  onSpawn: () => void;
  submitting: boolean;
  submitError: string | null;
  isAuthed: boolean;
}) {
  const counts = {
    a: template.seed_agents?.length ?? 0,
    i: template.seed_ideas?.length ?? 0,
    e: template.seed_events?.length ?? 0,
    q: template.seed_quests?.length ?? 0,
  };
  return (
    <div className="bp-detail-card" key={template.slug}>
      <button
        type="button"
        className="bp-detail-close"
        onClick={onClose}
        aria-label="Close detail"
        title="Close detail"
      >
        ×
      </button>
      <header className="bp-detail-head">
        <h2 className="bp-detail-name">{template.name}</h2>
        {template.tagline && <p className="bp-detail-tagline">{template.tagline}</p>}
      </header>
      {template.description && <p className="bp-detail-desc">{template.description}</p>}

      <BlueprintTreePreview template={template} />

      <ul className="bp-detail-monograms" aria-label="What this blueprint seeds">
        <li>
          <span className="n">{counts.a}</span> agents
        </li>
        <li>
          <span className="n">{counts.i}</span> ideas
        </li>
        <li>
          <span className="n">{counts.e}</span> events
        </li>
        <li>
          <span className="n">{counts.q}</span> quests
        </li>
      </ul>

      <form
        className="bp-detail-spawn"
        onSubmit={(e) => {
          e.preventDefault();
          onSpawn();
        }}
      >
        <label className="bp-detail-spawn-label" htmlFor="bp-company-name">
          Company name
        </label>
        <input
          id="bp-company-name"
          type="text"
          className="bp-detail-spawn-input"
          value={companyName}
          onChange={(e) => onCompanyNameChange(e.target.value)}
          placeholder={template.name}
          maxLength={48}
          disabled={submitting}
          autoComplete="off"
        />
        {submitError && (
          <p className="bp-detail-spawn-error" role="alert">
            {submitError}
          </p>
        )}
        <button type="submit" className="bp-detail-spawn-btn" disabled={submitting}>
          {submitting ? (
            <>
              <Spinner size="sm" />
              spawning…
            </>
          ) : isAuthed ? (
            <>Start this company</>
          ) : (
            <>Sign up to start</>
          )}
        </button>
        {!isAuthed && (
          <p className="bp-detail-spawn-hint">
            Free trial. One company on us — pick any blueprint to begin.
          </p>
        )}
      </form>
    </div>
  );
}

function BlueprintTreePreview({ template }: { template: CompanyTemplate }) {
  const seeds = template.seed_agents ?? [];
  return (
    <div className="bp-tree" aria-hidden="true">
      <div className="bp-tree-root">
        <span className="bp-tree-node bp-tree-node-root">
          <span className="bp-tree-node-name">{template.name}</span>
          <span className="bp-tree-node-tag">root</span>
        </span>
      </div>
      {seeds.length > 0 && (
        <>
          <svg className="bp-tree-edges" viewBox="0 0 100 18" preserveAspectRatio="none">
            {seeds.map((_, i) => {
              const total = seeds.length;
              const x = total === 1 ? 50 : 16 + (i * 68) / Math.max(1, total - 1);
              return (
                <path
                  key={i}
                  d={`M50 0 C50 8 ${x} 8 ${x} 18`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.6"
                  strokeOpacity="0.45"
                />
              );
            })}
          </svg>
          <ul className="bp-tree-children">
            {seeds.map((seed, i) => (
              <li
                key={`${seed.name}-${i}`}
                className="bp-tree-node bp-tree-node-child"
                style={{ animationDelay: `${100 + i * 80}ms` }}
              >
                <span className="bp-tree-node-name">{seed.name}</span>
                {seed.role && <span className="bp-tree-node-tag">{seed.role}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
