import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { blueprintId } from "@/lib/blueprintId";
import { DEFAULT_BLUEPRINT_SLUG } from "@/lib/blueprintDefaults";
import { entityPath, entityPathFromId } from "@/lib/entityPath";
import { DEFAULT_LAUNCH_PLAN, LAUNCH_PLANS, type LaunchPlanId } from "@/lib/pricing";
import { RECOMMENDED_BLUEPRINTS } from "@/lib/recommendedBlueprints";
import type { SingleBlueprint as Blueprint } from "@/lib/types";
import { isSingleBlueprint } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { Banner, Button, Card, EmptyState, Input, Spinner, Textarea } from "@/components/ui";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { BlueprintSeedCounts } from "@/components/blueprints/BlueprintSeedCounts";
import "@/styles/blueprints-store.css";
import "@/styles/blueprint-launch-picker.css";

const PROVISION_POLL_INTERVAL_MS = 1000;
const PROVISION_POLL_TIMEOUT_MS = 60_000;

function pickInitialBlueprintId(
  blueprints: Blueprint[],
  byBlueprintId: Map<string, Blueprint>,
): string | null {
  for (const id of RECOMMENDED_BLUEPRINTS) {
    if (byBlueprintId.has(id)) return id;
  }
  if (byBlueprintId.has(DEFAULT_BLUEPRINT_SLUG)) return DEFAULT_BLUEPRINT_SLUG;
  return blueprints[0] ? blueprintId(blueprints[0]) : null;
}

export default function CompanySetupPage() {
  const navigate = useNavigate();
  const { blueprintId: blueprintIdParam = "" } = useParams<{ blueprintId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const subscriptionStatus = useAuthStore((s) => s.user?.subscription_status ?? null);
  const isAdmin = useAuthStore((s) => s.user?.is_admin === true);
  const canSkipCheckout =
    isAdmin || subscriptionStatus === "active" || subscriptionStatus === "invited";

  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [organizationName, setOrganizationName] = useState("");
  const [mission, setMission] = useState("");
  const [plan, setPlan] = useState<LaunchPlanId>(DEFAULT_LAUNCH_PLAN);

  const provisionHandled = useRef(false);

  useEffect(() => {
    document.title = blueprint?.name ? `Launch ${blueprint.name} · aeqi` : "Launch · aeqi";
  }, [blueprint?.name]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const loadBlueprint = async () => {
      try {
        if (blueprintIdParam) {
          const resp = await api.getBlueprint(blueprintIdParam);
          if (cancelled) return;
          const tpl = resp.blueprint;
          if (!tpl || !isSingleBlueprint(tpl)) {
            setLoadError("Blueprint not found.");
            return;
          }
          setBlueprint(tpl);
          const initialName = tpl.root?.name ?? tpl.name;
          setOrganizationName(initialName);
          setMission(tpl.tagline || tpl.description || "");
          setPlan(DEFAULT_LAUNCH_PLAN);
          return;
        }

        const resp = await api.getBlueprints();
        if (cancelled) return;
        const blueprints = (resp.blueprints ?? []).filter(isSingleBlueprint);
        const byId = new Map<string, Blueprint>();
        for (const tpl of blueprints) byId.set(blueprintId(tpl), tpl);
        const selectedId = pickInitialBlueprintId(blueprints, byId);
        const tpl = selectedId ? (byId.get(selectedId) ?? null) : null;
        if (!tpl) {
          setLoadError("No blueprints are available yet.");
          return;
        }
        setBlueprint(tpl);
        const initialName = tpl.root?.name ?? tpl.name;
        setOrganizationName(initialName);
        setMission(tpl.tagline || tpl.description || "");
        setPlan(DEFAULT_LAUNCH_PLAN);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Could not reach the blueprint store.";
        setLoadError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadBlueprint();
    return () => {
      cancelled = true;
    };
  }, [blueprintIdParam]);

  const selectedLaunchPlan = useMemo(
    () => LAUNCH_PLANS.find((p) => p.id === plan) ?? LAUNCH_PLANS[0],
    [plan],
  );

  const blueprintMode = useMemo(() => {
    if (!blueprint) {
      return { label: "Company", meta: "cap table · standard launch" };
    }
    const category = blueprint.category ?? "company";
    if (category === "foundation") {
      return { label: "Foundation", meta: "multisig · grant flows" };
    }
    if (category === "fund") {
      return { label: "Fund", meta: "pro rata · tokenized capital" };
    }
    return { label: "Company", meta: "cap table · standard launch" };
  }, [blueprint]);

  useEffect(() => {
    const spawnName = searchParams.get("spawn");
    if (!spawnName || provisionHandled.current) return;

    provisionHandled.current = true;
    setProvisioning(true);
    setSubmitError(null);

    let cancelled = false;
    const deadline = Date.now() + PROVISION_POLL_TIMEOUT_MS;

    const poll = async () => {
      if (cancelled) return;
      try {
        await fetchEntities();
        const match = useDaemonStore
          .getState()
          .entities.find((entity) => entity.name === spawnName);
        if (match) {
          setSearchParams(new URLSearchParams(), { replace: true });
          navigate(entityPath(match), { replace: true });
          return;
        }
      } catch {
        // Keep polling through transient failures.
      }

      if (Date.now() >= deadline) {
        if (!cancelled) {
          setProvisioning(false);
          setSubmitError(
            "Payment received. Your organization is still provisioning. Refresh in a moment.",
          );
          setSearchParams(new URLSearchParams(), { replace: true });
        }
        return;
      }

      window.setTimeout(poll, PROVISION_POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [fetchEntities, navigate, searchParams, setSearchParams]);

  const handleLaunch = useCallback(async () => {
    if (!blueprint) return;
    const displayName = organizationName.trim();
    const shortMission = mission.trim();
    if (!displayName) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      if (canSkipCheckout) {
        const resp = await api.startLaunch({
          template: blueprintId(blueprint),
          display_name: displayName,
          mission: shortMission,
          plan,
        });

        await fetchEntities();
        navigate(entityPathFromId(useDaemonStore.getState().entities, resp.entity_id), {
          replace: true,
        });
        return;
      }

      const { url } = await api.createCheckoutSession({
        blueprint: blueprintId(blueprint),
        display_name: displayName,
        mission: shortMission,
        plan,
        launch: true,
      });
      window.location.href = url;
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        try {
          const { url } = await api.createCheckoutSession({
            blueprint: blueprintId(blueprint),
            display_name: displayName,
            mission: shortMission,
            plan,
            launch: true,
          });
          window.location.href = url;
          return;
        } catch {
          setSubmitError("Payment is required to launch this organization.");
        }
      } else {
        setSubmitError(e instanceof Error ? e.message : "Launch failed. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [blueprint, canSkipCheckout, fetchEntities, mission, navigate, organizationName, plan]);

  if (loading && !blueprint) {
    return (
      <div className="wizard-page">
        <div className="bp-status">
          <Spinner size="sm" /> Loading blueprint…
        </div>
      </div>
    );
  }

  if (!blueprint) {
    return (
      <div className="wizard-page">
        <EmptyState
          title="Blueprint not found."
          description={loadError || "We couldn't find a blueprint with that id."}
          action={
            <Button variant="secondary" onClick={() => navigate("/blueprints")}>
              Back to catalog
            </Button>
          }
        />
      </div>
    );
  }

  if (provisioning) {
    return (
      <div className="launch-page launch-page--provisioning">
        <Card variant="default" padding="lg" className="launch-provisioning-card">
          <p className="start-section-kicker">Provisioning</p>
          <h1 className="page-title">Your organization is being created.</h1>
          <p className="start-sub">Stripe has cleared. AEQI is wiring the runtime now.</p>
          <div className="launch-provisioning-status">
            <Spinner size="sm" /> Waiting for the organization to appear…
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="launch-page">
      <header className="launch-head">
        <div className="launch-head-copy">
          <p className="start-eyebrow">Launch</p>
          <h1 className="page-title">Launch your organization.</h1>
        </div>
      </header>

      {submitError && (
        <Banner kind="error" className="start-banner">
          {submitError}
        </Banner>
      )}

      {loadError && !submitError && (
        <Banner kind="error" className="start-banner">
          {loadError}
        </Banner>
      )}

      <section className="launch-grid">
        <div className="launch-main">
          <Link
            to="/blueprints"
            className="launch-blueprint-picker"
            aria-label={`Change selected blueprint. Current blueprint: ${blueprint.name}`}
          >
            <Card variant="default" padding="lg" interactive className="launch-blueprint-card">
              <div className="launch-blueprint-head">
                <div>
                  <p className="start-section-kicker">Blueprint</p>
                  <h2 className="start-section-title">{blueprint.name}</h2>
                </div>
                <span className="launch-blueprint-link" aria-hidden>
                  Change →
                </span>
              </div>
            </Card>
          </Link>

          <Card variant="default" padding="lg" className="launch-card">
            <div className="launch-card-head">
              <div>
                <p className="start-section-kicker">Identity</p>
                <h3 className="start-section-title">Name it.</h3>
              </div>
            </div>

            <div className="launch-fields">
              <label className="launch-field launch-field--name">
                <span className="launch-field-label">Organization name</span>
                <Input
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="The name on the charter"
                  size="lg"
                />
              </label>

              <p className="launch-field-divider" aria-hidden="true">
                Mission
              </p>

              <label className="launch-field">
                <span className="launch-field-label">What it is for</span>
                <Textarea
                  value={mission}
                  onChange={(e) => setMission(e.target.value)}
                  rows={3}
                  placeholder="What should this organization accomplish?"
                />
              </label>
            </div>
          </Card>
        </div>

        <div className="launch-side">
          <Card variant="default" padding="lg" className="launch-preview-card">
            <div className="launch-preview-head">
              <div>
                <p className="start-section-kicker">Preview</p>
                <h3 className="start-section-title">{blueprint.name}</h3>
              </div>
              <span className="launch-preview-type">{blueprintMode.label}</span>
            </div>
            <p className="start-sub launch-preview-sub">
              {blueprint.tagline || blueprint.description || blueprintMode.meta}
            </p>
            <BlueprintSeedCounts template={blueprint} />
            <BlueprintTreePreview template={blueprint} />
          </Card>
        </div>
      </section>

      <div className="launch-footer">
        <div className="launch-footer-plans" role="list" aria-label="Launch plans">
          {LAUNCH_PLANS.map((item) => {
            const selected = item.id === plan;
            return (
              <button
                key={item.id}
                type="button"
                className={`plan-card launch-plan-card launch-plan-card--footer ${
                  selected ? "plan-card--selected" : ""
                } ${item.recommended ? "plan-card--popular" : ""}`}
                onClick={() => setPlan(item.id)}
                aria-pressed={selected}
              >
                {item.recommended && <span className="plan-card-badge">Recommended</span>}
                <div className="plan-card-top">
                  <div className="plan-card-name">{item.name}</div>
                  <span className="plan-card-check" aria-hidden="true">
                    {selected ? "✓" : ""}
                  </span>
                </div>
                <p className="plan-card-summary">
                  {item.id === "growth" ? "4x Standard" : "Standard capacity"}
                </p>
              </button>
            );
          })}
        </div>
        <div className="launch-footer-action">
          <div className="launch-footer-copy">
            <p className="launch-footer-note">Due today {selectedLaunchPlan.dueToday}</p>
          </div>
          <Button
            variant="primary"
            size="lg"
            onClick={() => void handleLaunch()}
            disabled={submitting || !organizationName.trim()}
            loading={submitting}
            loadingLabel="Creating"
          >
            {canSkipCheckout
              ? "Launch organization"
              : `Pay ${selectedLaunchPlan.dueToday} and launch`}
          </Button>
        </div>
      </div>
    </div>
  );
}
