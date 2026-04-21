import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import type { CompanyTemplate } from "@/lib/types";
import SpawnTemplateModal from "@/components/SpawnTemplateModal";
import { Spinner } from "@/components/ui";
import "@/styles/templates.css";

/**
 * /templates — the front door of AEQI. A user picks a company template
 * and within seconds is inside a fully-threaded runtime (seed agents,
 * events, ideas, quests already alive). The browse / detail / spawn
 * flow is the single step between goal and company.
 *
 * Data flow:
 *   - On mount, try `GET /api/templates` (Stream C). If the endpoint
 *     isn't live yet or errors, fall back to the local fixtures so the
 *     page always renders something meaningful — users never see an
 *     empty store.
 *   - `?start=<slug>` opens the spawn modal for that template. This is
 *     the deep-link the landing page CTAs land on.
 *   - A selected template renders the detail view (same page, stays
 *     ambient — no extra route hop). "Back to templates" restores grid.
 */
export default function TemplatesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [templates, setTemplates] = useState<CompanyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detailSlug, setDetailSlug] = useState<string | null>(null);
  const [modalTemplate, setModalTemplate] = useState<CompanyTemplate | null>(null);

  useEffect(() => {
    document.title = "templates · æqi";
  }, []);

  // Fetch catalog. On any failure, fall back to the fixture catalog so we
  // never ship a blank store — even before Stream C's endpoint is live.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getTemplates()
      .then((resp) => {
        if (cancelled) return;
        const incoming = Array.isArray(resp?.templates) ? resp.templates : [];
        if (incoming.length > 0) {
          setTemplates(incoming);
        } else {
          // Backend responded but catalog is empty — still give users the
          // canonical three so the page is useful on fresh installs.
          setTemplates(FALLBACK_TEMPLATES);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setTemplates(FALLBACK_TEMPLATES);
        setError(e instanceof Error ? e.message : "Could not reach the template store.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Deep-link: `?start=<slug>` auto-opens the spawn modal once the catalog
  // is loaded. The URL param is preserved while the modal is open so a
  // refresh still lands in the same spot.
  useEffect(() => {
    const startSlug = searchParams.get("start");
    if (!startSlug || loading) return;
    const found = templates.find((t) => t.slug === startSlug);
    if (found) {
      setModalTemplate(found);
    }
  }, [searchParams, loading, templates]);

  const selectedDetail = useMemo(
    () => (detailSlug ? templates.find((t) => t.slug === detailSlug) || null : null),
    [detailSlug, templates],
  );

  const startTemplate = useCallback((tpl: CompanyTemplate) => {
    setModalTemplate(tpl);
  }, []);

  const closeModal = useCallback(() => {
    setModalTemplate(null);
    // Strip ?start= so the modal doesn't re-open on state change
    if (searchParams.has("start")) {
      const next = new URLSearchParams(searchParams);
      next.delete("start");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleSpawned = useCallback(
    (rootAgentId: string) => {
      // Land users inside their new company: sessions tab is where the
      // chat lives, so they can start talking immediately.
      navigate(`/${encodeURIComponent(rootAgentId)}/sessions`);
    },
    [navigate],
  );

  const highlightSlug = searchParams.get("start");

  return (
    <div className="tpl-page">
      <div className="tpl-inner">
        {selectedDetail ? (
          <DetailView
            template={selectedDetail}
            onBack={() => setDetailSlug(null)}
            onStart={() => startTemplate(selectedDetail)}
          />
        ) : (
          <>
            <a
              className="tpl-back"
              href="/"
              onClick={(e) => {
                e.preventDefault();
                navigate("/");
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M8.5 3L4.5 7l4 4" />
              </svg>
              Back
            </a>

            <header className="tpl-hero">
              <p className="tpl-eyebrow">Template store</p>
              <h1 className="tpl-title">Start a company in one step.</h1>
              <p className="tpl-subtitle">
                Each template lands you in a fully-threaded runtime — agents, events, ideas, and
                quests already alive. Pick one, name it, and start talking.
              </p>
            </header>

            {error && (
              <div className="tpl-error" role="alert">
                {error} — showing default templates.
              </div>
            )}

            {loading ? (
              <div className="tpl-status">
                <Spinner size="sm" />
                Loading templates…
              </div>
            ) : (
              <div className="tpl-grid" role="list">
                {templates.map((tpl) => {
                  const counts = {
                    agents: tpl.seed_agents?.length ?? 0,
                    events: tpl.seed_events?.length ?? 0,
                    ideas: tpl.seed_ideas?.length ?? 0,
                    quests: tpl.seed_quests?.length ?? 0,
                  };
                  const highlighted = highlightSlug === tpl.slug;
                  return (
                    <button
                      key={tpl.slug}
                      type="button"
                      role="listitem"
                      className={`tpl-card${highlighted ? " is-highlighted" : ""}`}
                      onClick={() => setDetailSlug(tpl.slug)}
                    >
                      <h2 className="tpl-card-name">{tpl.name}</h2>
                      {tpl.tagline && <p className="tpl-card-tagline">{tpl.tagline}</p>}
                      {tpl.description && <p className="tpl-card-desc">{tpl.description}</p>}
                      <div className="tpl-card-counts">
                        <span className="tpl-card-count">
                          <span className="tpl-card-count-n">{counts.agents}</span> agents
                        </span>
                        <span className="tpl-card-count">
                          <span className="tpl-card-count-n">{counts.events}</span> events
                        </span>
                        <span className="tpl-card-count">
                          <span className="tpl-card-count-n">{counts.ideas}</span> ideas
                        </span>
                        <span className="tpl-card-count">
                          <span className="tpl-card-count-n">{counts.quests}</span> quests
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
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

/* ── Detail view — inline sub-page for the selected template ───────── */

function DetailView({
  template,
  onBack,
  onStart,
}: {
  template: CompanyTemplate;
  onBack: () => void;
  onStart: () => void;
}) {
  const sections: Array<{
    label: string;
    items: Array<{ name: string; sub?: string }>;
  }> = [
    {
      label: "Agents",
      items: (template.seed_agents ?? []).map((a) => ({
        name: a.display_name || a.name,
        sub: a.tagline || a.role,
      })),
    },
    {
      label: "Events",
      items: (template.seed_events ?? []).map((e) => ({
        name: e.name || e.pattern,
        sub: e.name ? e.pattern : e.description,
      })),
    },
    {
      label: "Ideas",
      items: (template.seed_ideas ?? []).map((i) => ({
        name: i.name,
        sub: i.tags && i.tags.length > 0 ? i.tags.join(" · ") : i.summary,
      })),
    },
    {
      label: "Quests",
      items: (template.seed_quests ?? []).map((q) => ({
        name: q.subject,
        sub: q.description,
      })),
    },
  ];

  return (
    <>
      <button
        type="button"
        className="tpl-back"
        onClick={onBack}
        style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        >
          <path d="M8.5 3L4.5 7l4 4" />
        </svg>
        Back to templates
      </button>

      <header className="tpl-detail-hero">
        <h1 className="tpl-detail-name">{template.name}</h1>
        {template.tagline && <p className="tpl-detail-tagline">{template.tagline}</p>}
        {template.description && <p className="tpl-detail-desc">{template.description}</p>}

        <div className="tpl-detail-cta-row">
          <button type="button" className="tpl-cta-primary" onClick={onStart}>
            Start this company
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            >
              <path d="M5 3l4 4-4 4" />
            </svg>
          </button>
          <button type="button" className="tpl-cta-secondary" onClick={onBack}>
            Browse other templates
          </button>
        </div>
      </header>

      <div className="tpl-seed-grid">
        {sections.map((section) => (
          <section key={section.label} className="tpl-seed-section">
            <div className="tpl-seed-head">
              <span className="tpl-seed-label">{section.label}</span>
              <span className="tpl-seed-count">{section.items.length}</span>
            </div>
            {section.items.length === 0 ? (
              <p className="tpl-seed-empty">None seeded.</p>
            ) : (
              <ul className="tpl-seed-list">
                {section.items.map((item, idx) => (
                  <li key={`${item.name}-${idx}`} className="tpl-seed-item">
                    <span className="tpl-seed-item-name">{item.name}</span>
                    {item.sub && <span className="tpl-seed-item-sub">{item.sub}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
