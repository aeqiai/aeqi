import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import type { CompanyTemplate } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { Spinner } from "@/components/ui";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { BlueprintRootChip } from "@/components/blueprints/BlueprintRootChip";
import { BlueprintSeedSamples } from "@/components/blueprints/BlueprintSeedSamples";
import { BlueprintSeedCounts } from "@/components/blueprints/BlueprintSeedCounts";
import { BlueprintSpawnForm } from "@/components/blueprints/BlueprintSpawnForm";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";

/**
 * `/blueprints/:slug` — dedicated, full-width detail surface for one blueprint.
 *
 * Replaces the previous right-side preview pane. The catalog page now
 * navigates here on card click; closing returns to `/blueprints`. The
 * URL is the source of truth for which blueprint is being viewed —
 * deep links and back/forward both work.
 */
export default function BlueprintDetailPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);
  const setActiveRoot = useUIStore((s) => s.setActiveRoot);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);
  const allAgents = useDaemonStore((s) => s.agents);

  const importIntoId = searchParams.get("import_into") || null;
  const importTarget = useMemo(
    () => (importIntoId ? allAgents.find((a) => a.id === importIntoId) || null : null),
    [allAgents, importIntoId],
  );
  const isImportMode = !!importIntoId;
  const isAuthed = authMode === "none" || !!token;

  const [template, setTemplate] = useState<CompanyTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

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

  useEffect(() => {
    setCompanyName(template?.name || "");
    setSubmitError(null);
  }, [template?.slug, template?.name]);

  const handleSpawn = useCallback(async () => {
    if (!template) return;
    if (!isAuthed) {
      navigate(`/signup?next=/blueprints/${encodeURIComponent(template.slug)}`);
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
      const resp = await api.spawnTemplate({ template: template.slug, name: trimmed });
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
  }, [template, isAuthed, companyName, setActiveRoot, fetchAgents, navigate]);

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

  return (
    <div className="bp-detail-page">
      <BlueprintDetailBackLink />

      {isImportMode && (
        <div className="bp-import-banner" role="status">
          <span className="bp-import-banner-eyebrow">Import mode</span>
          <p className="bp-import-banner-line">
            Picking this blueprint will merge its seed agents, ideas, events, and quests into{" "}
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
          <BlueprintSpawnForm
            template={template}
            companyName={companyName}
            onCompanyNameChange={setCompanyName}
            onSpawn={handleSpawn}
            submitting={submitting}
            submitError={submitError}
            isAuthed={isAuthed}
            importMode={isImportMode}
            importTargetName={importTarget?.name || null}
          />
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
