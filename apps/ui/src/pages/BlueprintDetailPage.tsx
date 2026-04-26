import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import type { CompanyTemplate } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { Button, Spinner } from "@/components/ui";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { BlueprintSeedSamples } from "@/components/blueprints/BlueprintSeedSamples";
import { BlueprintSeedCounts } from "@/components/blueprints/BlueprintSeedCounts";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";

/**
 * `/blueprints/:slug` — pure inspect surface.
 *
 * Layout mirrors the ideas canvas: a slim head band (back-icon +
 * blueprint name on the left, primary CTA on the right) and the actual
 * content left-aligned in a single column below. No per-template accent
 * colours, no centred grid, no editorial chrome — same restrained
 * register the rest of the app uses.
 */
export default function BlueprintDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const allAgents = useDaemonStore((s) => s.agents);

  const importIntoId = searchParams.get("import_into") || null;
  const importTarget = useMemo(
    () => (importIntoId ? allAgents.find((a) => a.id === importIntoId) || null : null),
    [allAgents, importIntoId],
  );
  const isImportMode = !!importIntoId;

  const [template, setTemplate] = useState<CompanyTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = template?.name ? `${template.name} · Blueprints · aeqi` : "Blueprint · aeqi";
  }, [template?.name]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getTemplate(slug)
      .then((resp) => {
        if (cancelled) return;
        const tpl = (resp as { template?: CompanyTemplate })?.template;
        if (tpl) {
          setTemplate(tpl);
        } else {
          const fallback = FALLBACK_TEMPLATES.find((t) => t.slug === slug);
          if (fallback) setTemplate(fallback);
          else setError("Blueprint not found.");
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        const fallback = FALLBACK_TEMPLATES.find((t) => t.slug === slug);
        if (fallback) {
          setTemplate(fallback);
          setError(e.message || "Could not reach the blueprint store.");
        } else {
          setError(e.message || "Blueprint not found.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading && !template) {
    return (
      <div className="bp-detail-page">
        <BlueprintDetailHeader title="" onBack={() => navigate("/blueprints")} />
        <div className="bp-detail-body">
          <div className="bp-status">
            <Spinner size="sm" /> Loading Blueprint…
          </div>
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="bp-detail-page">
        <BlueprintDetailHeader title="Blueprint" onBack={() => navigate("/blueprints")} />
        <div className="bp-detail-body">
          <div className="bp-detail-missing">
            <p className="bp-detail-missing-title">Blueprint not found.</p>
            <p className="bp-detail-missing-sub">
              {error || "We couldn't find a blueprint with that slug."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const launchHref = isImportMode
    ? `/blueprints/${encodeURIComponent(template.slug)}?import_into=${encodeURIComponent(importIntoId ?? "")}`
    : `/start?blueprint=${encodeURIComponent(template.slug)}`;

  return (
    <div className="bp-detail-page">
      <BlueprintDetailHeader
        title={template.name}
        onBack={() => navigate("/blueprints")}
        action={
          <Link to={launchHref} className="bp-detail-launch-link" aria-disabled={isImportMode}>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isImportMode}
              onClick={(e) => {
                if (isImportMode) e.preventDefault();
              }}
            >
              {isImportMode ? "Coming soon" : "Use this Blueprint →"}
            </Button>
          </Link>
        }
      />

      <div className="bp-detail-body">
        {isImportMode && (
          <div className="bp-import-banner" role="status">
            <span className="bp-import-banner-eyebrow">Import mode</span>
            <p className="bp-import-banner-line">
              Picking this Blueprint will merge its seed agents, ideas, events, and quests into{" "}
              <strong>{importTarget?.name || "the selected agent"}</strong>&rsquo;s tree once the
              server merge endpoint lands.
            </p>
          </div>
        )}

        {error && (
          <div className="bp-error" role="alert">
            {error} — showing the bundled copy.
          </div>
        )}

        <header className="bp-detail-page-head">
          <h1 className="bp-detail-page-name">{template.name}</h1>
          {template.tagline && <p className="bp-detail-page-tagline">{template.tagline}</p>}
          {template.description && <p className="bp-detail-page-desc">{template.description}</p>}
        </header>

        <section className="bp-detail-section">
          <BlueprintTreePreview template={template} />
          <BlueprintSeedCounts template={template} />
        </section>

        <section className="bp-detail-section">
          <BlueprintSeedSamples template={template} eventLimit={6} ideaLimit={6} questLimit={4} />
        </section>
      </div>
    </div>
  );
}

/**
 * Slim canvas-style head band. Reuses the ideas surface vocabulary —
 * `.ideas-toolbar-btn` for the back-icon, same horizontal padding as
 * `.ideas-list-head` — so jumping between an idea and a blueprint feels
 * like the same app, not different surfaces with different chrome.
 */
function BlueprintDetailHeader({
  title,
  onBack,
  action,
}: {
  title: string;
  onBack: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="ideas-list-head bp-detail-head">
      <div className="ideas-toolbar bp-detail-toolbar">
        <button
          type="button"
          className="ideas-toolbar-btn"
          onClick={onBack}
          title="Back to Blueprints"
          aria-label="Back to Blueprints"
        >
          <svg
            width="13"
            height="13"
            viewBox="0 0 13 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M8 3 L4.5 6.5 L8 10" />
          </svg>
        </button>
        <span className="bp-detail-toolbar-title">{title}</span>
        <div className="ideas-toolbar-spacer" aria-hidden />
        {action}
      </div>
    </div>
  );
}
