import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import type { CompanyTemplate } from "@/lib/types";
import { useDaemonStore } from "@/store/daemon";
import { Button, Spinner } from "@/components/ui";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { BlueprintRootChip } from "@/components/blueprints/BlueprintRootChip";
import { BlueprintSeedSamples } from "@/components/blueprints/BlueprintSeedSamples";
import { BlueprintSeedCounts } from "@/components/blueprints/BlueprintSeedCounts";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";

/**
 * `/blueprints/:slug` — pure inspect surface. Read what a Blueprint is,
 * see the tree, scan the seed events/ideas/quests. The actual launch
 * happens at `/start?blueprint=:slug` — separating inspect from launch
 * keeps the launch ceremony deliberate (named, payment-aware, single
 * primary CTA) and the inspect page free of form chrome.
 */
export default function BlueprintDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();

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

  // Fetch the full template; fall back to the bundled fixtures so the
  // detail page still renders for unauthed/offline visitors.
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
        <div className="bp-status">
          <Spinner size="sm" /> Loading Blueprint…
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="bp-detail-page">
        <BlueprintDetailBackLink />
        <div className="bp-detail-missing">
          <p className="bp-detail-missing-title">Blueprint not found.</p>
          <p className="bp-detail-missing-sub">
            {error || "We couldn't find a blueprint with that slug."}
          </p>
        </div>
      </div>
    );
  }

  const launchHref = isImportMode
    ? `/blueprints/${encodeURIComponent(template.slug)}?import_into=${encodeURIComponent(importIntoId ?? "")}`
    : `/start?blueprint=${encodeURIComponent(template.slug)}`;

  return (
    <div className="bp-detail-page">
      <BlueprintDetailBackLink />

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

      <div className="bp-detail-page-grid">
        <header className="bp-detail-page-head">
          <h1 className="bp-detail-page-name">{template.name}</h1>
          {template.tagline && <p className="bp-detail-page-tagline">{template.tagline}</p>}
          {template.root && <BlueprintRootChip root={template.root} />}
          {template.description && <p className="bp-detail-page-desc">{template.description}</p>}
        </header>

        <section className="bp-detail-page-tree">
          <BlueprintTreePreview template={template} />
          <BlueprintSeedCounts template={template} />
        </section>

        <section className="bp-detail-page-samples">
          <BlueprintSeedSamples template={template} eventLimit={6} ideaLimit={6} questLimit={4} />
        </section>

        <aside className="bp-detail-page-spawn">
          <p className="bp-detail-cta-eyebrow">Use this Blueprint</p>
          <p className="bp-detail-cta-line">
            {isImportMode
              ? "Importing into an existing agent — merge endpoint coming soon."
              : "Take it to /start, name your Company, and launch."}
          </p>
          <Link to={launchHref} className="bp-detail-cta-link" aria-disabled={isImportMode}>
            <Button
              type="button"
              variant="primary"
              size="lg"
              fullWidth
              disabled={isImportMode}
              onClick={(e) => {
                if (isImportMode) e.preventDefault();
              }}
            >
              {isImportMode ? "Coming soon" : "Use this Blueprint →"}
            </Button>
          </Link>
        </aside>
      </div>
    </div>
  );
}

function BlueprintDetailBackLink() {
  return (
    <Link to="/blueprints" className="bp-detail-back" aria-label="Back to Blueprints">
      <span aria-hidden="true">←</span>
      <span>Back to Blueprints</span>
    </Link>
  );
}
