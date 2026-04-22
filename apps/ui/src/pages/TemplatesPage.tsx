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
 * /templates — the front door of æqi. A user picks a company template
 * and within seconds is inside a fully-threaded runtime (seed agents,
 * events, ideas, quests already alive). Grid + card rendering lives in
 * `<TemplateGallery>`; this page is the data + spawn-modal shell.
 *
 * Data flow:
 *   - On mount, try `GET /api/templates`. On any failure, fall back to
 *     local fixtures so the store is never empty.
 *   - `?start=<slug>` and `?template=<slug>` both deep-link into the
 *     gallery preview for that slug. After close, the param is stripped
 *     from the URL so the preview doesn't re-open on state changes.
 */
export default function TemplatesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [templates, setTemplates] = useState<CompanyTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalTemplate, setModalTemplate] = useState<CompanyTemplate | null>(null);

  useEffect(() => {
    document.title = "templates · æqi";
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
            Each template lands you in a fully-threaded runtime — agents, events, ideas, and quests
            already alive. Pick one, name it, and start talking.
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
