import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import type { CompanyTemplate } from "@/lib/types";
import SpawnTemplateModal from "@/components/SpawnTemplateModal";
import TemplateGallery from "@/components/TemplateGallery";
import { Spinner } from "@/components/ui";
import "@/styles/templates.css";

/**
 * /blueprints — the front door of æqi. A user picks a company blueprint
 * and within seconds is inside a fully-threaded runtime (seed agents,
 * events, ideas, quests already alive). Grid + card rendering lives in
 * `<TemplateGallery>`; this page is the data + spawn-modal shell.
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalTemplate, setModalTemplate] = useState<CompanyTemplate | null>(null);

  useEffect(() => {
    document.title = "blueprints · æqi";
  }, []);

  // Fetch catalog. On any failure, fall back to the fixture catalog so we
  // never ship a blank store — even before the endpoint is live.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    api
      .getTemplates()
      .then((resp) => {
        if (cancelled) return;
        const incoming = Array.isArray(resp?.templates) ? resp.templates : [];
        setTemplates(incoming.length > 0 ? incoming : FALLBACK_TEMPLATES);
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
          <h1 className="tpl-title">start a company in one step.</h1>
          <p className="tpl-subtitle">
            each blueprint lands you in a fully-threaded runtime — agents, events, ideas, and quests
            already alive. pick one, name it, start talking.
          </p>
        </header>

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
        ) : (
          <TemplateGallery
            companyTemplates={templates}
            onPick={handlePick}
            initialSlug={initialSlug}
            onPreviewClose={cleanDeepLinkParams}
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
