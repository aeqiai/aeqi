import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { DEFAULT_TEMPLATE_SLUG, FALLBACK_TEMPLATES } from "@/lib/templateFixtures";
import type { CompanyTemplate, User } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { Button, Input, Spinner } from "@/components/ui";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { BlueprintSeedCounts } from "@/components/blueprints/BlueprintSeedCounts";
import "@/styles/templates.css";
import "@/styles/blueprints-store.css";
import "@/styles/start.css";

/**
 * `/start` — the single place a company is created.
 *
 * Loads the chosen Blueprint (`?blueprint=:slug`) or the
 * operator-configured default and renders a focused launch surface:
 * compact preview header, name input, trial-slot indicator, single
 * primary CTA. Lives inside AppLayout so the LeftSidebar stays
 * available for users with existing companies; users with none get a
 * naturally focused view because the sidebar has nothing to show.
 *
 * Design intent: zero scroll on first paint at 1280×800, every
 * affordance one click away, no chrome competing with the act of
 * launching.
 */
export default function StartPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const token = useAuthStore((s) => s.token);
  const authMode = useAuthStore((s) => s.authMode);
  const setActiveRoot = useUIStore((s) => s.setActiveRoot);
  const fetchAgents = useDaemonStore((s) => s.fetchAgents);

  const slug = searchParams.get("blueprint") || "";
  const [template, setTemplate] = useState<CompanyTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [trialUsed, setTrialUsed] = useState(false);
  const [hasPaidPlan, setHasPaidPlan] = useState(false);

  const isAuthed = authMode === "none" || !!token;

  useEffect(() => {
    document.title = "Start a Company · aeqi";
  }, []);

  // Resolve the Blueprint — either ?blueprint=:slug or the default.
  // Falls back to bundled fixtures so the page still renders for
  // unauthed/offline visitors.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const fetcher = slug ? api.getTemplate(slug) : api.getDefaultTemplate();
    fetcher
      .then((resp) => {
        if (cancelled) return;
        const tpl = (resp as { template?: CompanyTemplate })?.template;
        if (tpl) {
          setTemplate(tpl);
        } else {
          const fallback = FALLBACK_TEMPLATES.find(
            (t) => t.slug === (slug || DEFAULT_TEMPLATE_SLUG),
          );
          setTemplate(fallback ?? null);
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        const fallback = FALLBACK_TEMPLATES.find((t) => t.slug === (slug || DEFAULT_TEMPLATE_SLUG));
        if (fallback) {
          setTemplate(fallback);
          setLoadError(e.message || "Could not reach the Blueprint store.");
        } else {
          setLoadError(e.message || "Blueprint not found.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  // Resolve the user's trial-slot status. Only fires when there's a
  // real account; auth mode "none" treats every spawn as free.
  useEffect(() => {
    if (!token || authMode === "none") {
      setTrialUsed(false);
      setHasPaidPlan(false);
      return;
    }
    let cancelled = false;
    api
      .getMe()
      .then((me) => {
        if (cancelled) return;
        const u = me as Partial<User>;
        setTrialUsed(!!u.free_company_used_at);
        setHasPaidPlan(!!u.subscription_status && u.subscription_status !== "none");
      })
      .catch(() => {
        // Non-fatal — fall through assuming the slot is free; the
        // server enforces the cap on POST regardless.
      });
    return () => {
      cancelled = true;
    };
  }, [token, authMode]);

  // Pre-fill the company name with the Blueprint's name. The user can
  // override; the placeholder still shows the suggestion when blank.
  useEffect(() => {
    setCompanyName(template?.name || "");
    setSubmitError(null);
  }, [template?.slug, template?.name]);

  const trialState = useMemo<TrialState>(() => {
    if (hasPaidPlan) return "paid";
    if (trialUsed) return "trial-used";
    return "trial-available";
  }, [hasPaidPlan, trialUsed]);

  const handleLaunch = useCallback(async () => {
    if (!template) return;
    if (!isAuthed) {
      const next = `/start${slug ? `?blueprint=${encodeURIComponent(slug)}` : ""}`;
      navigate(`/signup?next=${encodeURIComponent(next)}`);
      return;
    }
    if (trialState === "trial-used") {
      setSubmitError("Your free trial company has launched. Subscribe to a plan to spawn another.");
      return;
    }
    const trimmed = companyName.trim();
    if (!trimmed) {
      setSubmitError("Pick a name for your Company.");
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
      const msg = e instanceof Error ? e.message : "Could not launch the Company.";
      setSubmitError(msg);
      setSubmitting(false);
    }
  }, [template, isAuthed, slug, navigate, trialState, companyName, setActiveRoot, fetchAgents]);

  if (loading && !template) {
    return (
      <div className="start-page">
        <div className="start-loading">
          <Spinner size="sm" /> Loading Blueprint…
        </div>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="start-page">
        <div className="start-missing">
          <p className="start-missing-title">Blueprint not found.</p>
          <p className="start-missing-sub">
            {loadError || "We couldn't find that Blueprint."}{" "}
            <Link to="/blueprints">Browse the catalog →</Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="start-page">
      <div className="start-shell">
        <header className="start-head">
          <p className="start-eyebrow">Launch a Company</p>
          <h1 className="start-headline">Name it. Launch it.</h1>
          <p className="start-lede">
            One Blueprint, one click. Your agents spawn pre-threaded with the ideas, events, and
            quests that come with this Company.
          </p>
        </header>

        {loadError && (
          <div className="start-error" role="alert">
            {loadError} — showing the bundled copy.
          </div>
        )}

        <section className="start-blueprint">
          <div className="start-blueprint-head">
            <div className="start-blueprint-meta">
              <p className="start-blueprint-eyebrow">You'll launch</p>
              <h2 className="start-blueprint-name">{template.name}</h2>
              {template.tagline && <p className="start-blueprint-tagline">{template.tagline}</p>}
            </div>
            <Link
              to={`/blueprints?from=start${slug ? `&current=${encodeURIComponent(slug)}` : ""}`}
              className="start-switch-link"
            >
              <span aria-hidden="true">↺</span>
              <span>Pick a different Blueprint</span>
            </Link>
          </div>

          <div className="start-blueprint-preview">
            <BlueprintTreePreview template={template} />
            <BlueprintSeedCounts template={template} />
          </div>
        </section>

        <form
          className="start-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleLaunch();
          }}
        >
          <Input
            id="start-company-name"
            label="Name your Company"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            placeholder={template.name}
            maxLength={48}
            disabled={submitting}
            autoComplete="off"
            error={submitError ?? undefined}
            hint="You can rename it later. This is what your agents and channels will refer to it as."
          />

          <div className="start-form-actions">
            <TrialBadge state={trialState} />
            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={submitting}
              disabled={submitting || trialState === "trial-used"}
            >
              {submitting ? (
                <>
                  <Spinner size="sm" />
                  Launching…
                </>
              ) : isAuthed ? (
                <>Launch Company</>
              ) : (
                <>Sign Up to Launch</>
              )}
            </Button>
          </div>

          {trialState === "trial-used" && (
            <p className="start-trial-locked">
              You've already used your one free Company. Plans for additional Companies are coming
              soon — we'll email you the moment they ship.
            </p>
          )}
        </form>
      </div>
    </div>
  );
}

type TrialState = "trial-available" | "trial-used" | "paid";

function TrialBadge({ state }: { state: TrialState }) {
  if (state === "paid") {
    return (
      <div className="start-trial-badge start-trial-paid">
        <span className="start-trial-dot" aria-hidden="true" />
        <span>On your plan</span>
      </div>
    );
  }
  if (state === "trial-used") {
    return (
      <div className="start-trial-badge start-trial-locked-badge">
        <span className="start-trial-dot" aria-hidden="true" />
        <span>Trial used</span>
      </div>
    );
  }
  return (
    <div className="start-trial-badge start-trial-free">
      <span className="start-trial-dot" aria-hidden="true" />
      <span>Free trial — your one and only on us</span>
    </div>
  );
}
