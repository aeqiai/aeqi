import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { api } from "@/lib/api";
import { FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import AgentAvatar from "./AgentAvatar";
import SpawnTemplateModal from "./SpawnTemplateModal";
import TemplateGallery from "./TemplateGallery";
import { Button, EmptyState, Panel } from "./ui";
import type { Agent, CompanyTemplate } from "@/lib/types";

const NO_AGENTS: Agent[] = [];

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "still up";
  if (h < 12) return "good morning";
  if (h < 17) return "good afternoon";
  if (h < 22) return "good evening";
  return "welcome back";
}

function firstName(name: string | undefined, email: string | undefined): string | null {
  const raw = name || email?.split("@")[0] || "";
  if (!raw) return null;
  const seg = raw.split(/[\s._-]+/)[0];
  if (!seg) return null;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

/**
 * Home — root `/` landing.
 *
 * First-time users (zero companies): the page swaps the greeting + CTA
 * for a template gallery — "Pick a company to begin." sits above the
 * grid as a single quiet Cinzel gesture. The empty state is the first
 * impression; it should do real work, not apologize.
 *
 * Returning users (≥1 company): the current dashboard renders untouched
 * — wordmark, greeting, primary CTA, list of autonomous companies.
 *
 * Deep link: `?template=<slug>` auto-opens the gallery's preview for
 * the matching slug (landing-page CTA contract). If the user already
 * has companies, the page forwards them to `/templates?template=<slug>`
 * so the deep link still lands them inside the preview.
 */
export default function HomeDashboard() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const agents = useDaemonStore((s) => s.agents) || NO_AGENTS;
  const initialLoaded = useDaemonStore((s) => s.initialLoaded);

  useEffect(() => {
    document.title = "home · æqi";
  }, []);

  const name = firstName(user?.name, user?.email);
  const greet = greeting();
  const heading = name ? `${greet}, ${name}` : greet;

  const companies = useMemo(() => agents.filter((a) => !a.parent_id), [agents]);
  const agentCountsByRoot = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of agents) {
      if (a.parent_id) counts.set(a.parent_id, (counts.get(a.parent_id) ?? 0) + 1);
    }
    return counts;
  }, [agents]);

  // Zero-state detection: the daemon store is the source of truth for
  // "which companies does this user own?". We only flip into zero-state
  // UI after the daemon has fetched at least once — before that, render
  // nothing so we don't flash the gallery for an existing user on slow
  // networks.
  const isZeroState = initialLoaded && companies.length === 0;

  // Deep-link: ?template=<slug>. When the user already has companies,
  // forward to /templates so the param still opens the preview there.
  const templateParam = searchParams.get("template");
  useEffect(() => {
    if (!templateParam) return;
    if (!initialLoaded) return;
    if (companies.length > 0) {
      // Existing user — hand off to the full templates page, preserve
      // the deep link so their preview still opens there.
      navigate(`/templates?template=${encodeURIComponent(templateParam)}`, { replace: true });
    }
  }, [templateParam, initialLoaded, companies.length, navigate]);

  const cleanDeepLink = useCallback(() => {
    if (!searchParams.has("template")) return;
    const next = new URLSearchParams(searchParams);
    next.delete("template");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Gallery data — lazy-load only in zero state so existing users don't
  // pay the fetch cost. Falls back to the canonical fixtures on error.
  const [gallery, setGallery] = useState<CompanyTemplate[]>([]);
  useEffect(() => {
    if (!isZeroState) return;
    let cancelled = false;
    api
      .getTemplates()
      .then((resp) => {
        if (cancelled) return;
        const incoming = Array.isArray(resp?.templates) ? resp.templates : [];
        setGallery(incoming.length > 0 ? incoming : FALLBACK_TEMPLATES);
      })
      .catch(() => {
        if (cancelled) return;
        setGallery(FALLBACK_TEMPLATES);
      });
    return () => {
      cancelled = true;
    };
  }, [isZeroState]);

  const [modalTemplate, setModalTemplate] = useState<CompanyTemplate | null>(null);
  const handlePick = useCallback(
    (slug: string, kind: "company" | "identity") => {
      if (kind !== "company") return;
      const tpl = gallery.find((t) => t.slug === slug);
      if (tpl) setModalTemplate(tpl);
    },
    [gallery],
  );
  const closeModal = useCallback(() => {
    setModalTemplate(null);
    cleanDeepLink();
  }, [cleanDeepLink]);
  const handleSpawned = useCallback(
    (rootId: string) => {
      cleanDeepLink();
      navigate(`/${encodeURIComponent(rootId)}/sessions`);
    },
    [cleanDeepLink, navigate],
  );

  const openCompany = (id: string) => navigate(`/${encodeURIComponent(id)}`);

  // Zero state — gallery + one Cinzel sentence above it.
  if (isZeroState) {
    return (
      <div className="home home-empty">
        <header className="home-empty-hero">
          <h1 className="home-empty-preamble">Pick a company to begin.</h1>
        </header>

        <TemplateGallery
          companyTemplates={gallery}
          onPick={handlePick}
          initialSlug={templateParam || undefined}
          onPreviewClose={cleanDeepLink}
        />

        <SpawnTemplateModal
          template={modalTemplate}
          open={Boolean(modalTemplate)}
          onClose={closeModal}
          onSpawned={handleSpawned}
        />
      </div>
    );
  }

  // Returning-user dashboard — untouched.
  const ctaLabel =
    companies.length === 0 ? "Launch your first autonomous company" : "Launch autonomous company";

  return (
    <div className="home">
      <h1 className="home-greeting">{heading}</h1>

      <Button
        variant="primary"
        size="lg"
        fullWidth
        className="home-cta"
        onClick={() => navigate("/new")}
      >
        <span className="home-cta-label">{ctaLabel}</span>
        <span className="home-cta-arrow" aria-hidden>
          →
        </span>
      </Button>

      <Panel
        title="Autonomous companies"
        actions={<span className="home-panel-count">{companies.length}</span>}
      >
        {companies.length === 0 ? (
          <EmptyState
            eyebrow="Nothing spun up"
            title="No companies yet"
            description="Spin one up with the button above."
          />
        ) : (
          <ul className="home-companies" role="list">
            {companies.map((c) => {
              const label = c.display_name || c.name;
              const childCount = agentCountsByRoot.get(c.id) ?? 0;
              return (
                <li key={c.id}>
                  <button type="button" className="home-company" onClick={() => openCompany(c.id)}>
                    <AgentAvatar name={label} />
                    <span className="home-company-name">{label}</span>
                    <span className="home-company-meta">
                      {childCount} {childCount === 1 ? "agent" : "agents"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}
