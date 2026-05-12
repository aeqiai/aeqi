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
import "@/styles/blueprints-store.css";
import "@/styles/blueprint-launch-picker.css";

const PROVISION_POLL_INTERVAL_MS = 1000;
const PROVISION_POLL_TIMEOUT_MS = 60_000;

type NameCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available"; message: string }
  | { status: "taken"; message: string }
  | { status: "error"; message: string };

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
  const launchId = searchParams.get("launch");

  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const entities = useDaemonStore((s) => s.entities);
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
  const [nameCheck, setNameCheck] = useState<NameCheckState>({ status: "idle" });

  const provisionHandled = useRef(false);
  const nameCheckSeq = useRef(0);
  const activeLaunchEntity = useMemo(
    () => (launchId ? (entities.find((entity) => entity.id === launchId) ?? null) : null),
    [entities, launchId],
  );

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
      return {
        label: "Company",
        meta: "A flexible organization that adapts as your mission evolves.",
      };
    }
    const category = blueprint.category ?? "company";
    if (category === "foundation") {
      return {
        label: "Foundation",
        meta: "A flexible organization that adapts as your mission evolves.",
      };
    }
    if (category === "fund") {
      return {
        label: "Fund",
        meta: "A flexible organization that adapts as your mission evolves.",
      };
    }
    return {
      label: "Company",
      meta: "A flexible organization that adapts as your mission evolves.",
    };
  }, [blueprint]);

  const blueprintPath = useMemo(() => {
    if (!blueprint) return "/blueprints";
    return `/blueprints/${encodeURIComponent(blueprintId(blueprint))}`;
  }, [blueprint]);

  const nameHint = useMemo(() => {
    switch (nameCheck.status) {
      case "checking":
        return "Checking availability…";
      case "available":
        return "Name is available.";
      case "error":
        return nameCheck.message;
      case "taken":
        return undefined;
      case "idle":
      default:
        return "This can be changed later.";
    }
  }, [nameCheck]);

  const nameError = useMemo(() => {
    if (nameCheck.status === "taken" || nameCheck.status === "error") {
      return nameCheck.status === "taken" ? "Already taken." : nameCheck.message;
    }
    return undefined;
  }, [nameCheck]);

  useEffect(() => {
    const name = organizationName.trim();
    if (!name) {
      setNameCheck({ status: "idle" });
      return;
    }

    setNameCheck({ status: "checking" });
    const seq = ++nameCheckSeq.current;
    const timer = window.setTimeout(async () => {
      try {
        const resp = await api.checkLaunchName(name);
        if (seq !== nameCheckSeq.current) return;
        setNameCheck(
          resp.available
            ? { status: "available", message: "Available." }
            : { status: "taken", message: "Already taken." },
        );
      } catch {
        if (seq !== nameCheckSeq.current) return;
        setNameCheck({
          status: "error",
          message: "Could not check availability right now.",
        });
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [organizationName]);

  useEffect(() => {
    if (!launchId || provisionHandled.current) return;

    provisionHandled.current = true;
    setProvisioning(true);
    setSubmitError(null);

    let cancelled = false;
    const deadline = Date.now() + PROVISION_POLL_TIMEOUT_MS;

    const poll = async () => {
      if (cancelled) return;
      try {
        await fetchEntities();
        const match = useDaemonStore.getState().entities.find((entity) => entity.id === launchId);
        if (match) {
          const launchState = match.launch_state ?? match.placement_status ?? "";
          const isReady =
            launchState === "complete" || launchState === "ready" || match.status === "active";
          if (isReady) {
            setSearchParams(new URLSearchParams(), { replace: true });
            navigate(entityPath(match), { replace: true });
            return;
          }
          if (launchState === "failed") {
            setProvisioning(false);
            setSubmitError(
              match.launch_error ||
                "Launch failed while provisioning. Refresh to keep watching the state.",
            );
            return;
          }
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
  }, [fetchEntities, launchId, navigate, setSearchParams]);

  const handleLaunch = useCallback(async () => {
    if (!blueprint) return;
    const displayName = organizationName.trim();
    const shortMission = mission.trim();
    if (!displayName || nameCheck.status !== "available") return;

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
  }, [
    blueprint,
    canSkipCheckout,
    fetchEntities,
    mission,
    nameCheck.status,
    navigate,
    organizationName,
    plan,
  ]);

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
    const launchState =
      activeLaunchEntity?.launch_state ?? activeLaunchEntity?.placement_status ?? "";
    const launchLabel =
      launchState === "checkout_pending"
        ? "Waiting for checkout"
        : launchState === "checkout_completed"
          ? "Payment confirmed"
          : launchState === "trust_provisioning"
            ? "Provisioning trust"
            : launchState === "runtime_provisioning"
              ? "Installing runtime"
              : launchState === "complete" || launchState === "ready"
                ? "Organization ready"
                : "Provisioning";

    const launchSteps = [
      { key: "checkout_completed", label: "Payment received" },
      { key: "trust_provisioning", label: "Trust provisioning" },
      { key: "runtime_provisioning", label: "Runtime install" },
      { key: "complete", label: "Organization ready" },
    ];

    return (
      <div className="launch-page launch-page--provisioning">
        <Card variant="default" padding="lg" className="launch-provisioning-card">
          <p className="start-section-kicker">Provisioning</p>
          <h1 className="page-title">Your organization is being created.</h1>
          <p className="start-sub">{launchLabel}. Refreshing the launch state.</p>
          <div className="launch-provisioning-status">
            <Spinner size="sm" /> Waiting for the organization to appear…
          </div>
          <ol className="launch-provisioning-steps">
            {launchSteps.map((step) => {
              const active =
                launchState === step.key ||
                (step.key === "checkout_completed" && launchState === "checkout_pending");
              const done =
                launchState === "complete" ||
                launchState === "ready" ||
                (step.key === "checkout_completed" && launchState !== "checkout_pending") ||
                (step.key === "trust_provisioning" &&
                  ["runtime_provisioning", "complete", "ready"].includes(launchState)) ||
                (step.key === "runtime_provisioning" &&
                  ["complete", "ready"].includes(launchState));
              return (
                <li
                  key={step.key}
                  className={`launch-provisioning-step ${active ? "is-active" : ""} ${
                    done ? "is-done" : ""
                  }`}
                >
                  <span className="launch-provisioning-step-dot" aria-hidden="true" />
                  <span>{step.label}</span>
                </li>
              );
            })}
          </ol>
        </Card>
      </div>
    );
  }

  return (
    <div className="launch-page">
      <header className="launch-head">
        <div className="start-head-copy">
          <h1 className="page-title">Launch your organization.</h1>
        </div>
        <div className="start-head-actions">
          <Link to="/blueprints" className="start-secondary-link">
            Browse blueprints
          </Link>
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
          <Card variant="default" padding="lg" className="launch-card">
            <div className="launch-card-head">
              <p className="start-section-kicker">Identity</p>
            </div>

            <div className="launch-fields">
              <div className="launch-field launch-field--name">
                <p className="launch-field-title">Organization name</p>
                <Input
                  aria-label="Organization name"
                  hint={nameHint}
                  error={nameError}
                  value={organizationName}
                  onChange={(e) => setOrganizationName(e.target.value)}
                  placeholder="Enter a name"
                  size="lg"
                />
                <p className="launch-field-note">This becomes the registered name.</p>
              </div>

              <div className="launch-field">
                <Textarea
                  label="Mission"
                  hint="One sentence is enough."
                  value={mission}
                  onChange={(e) => setMission(e.target.value)}
                  rows={2}
                  placeholder="What should this organization do?"
                />
              </div>
            </div>
          </Card>
        </div>

        <div className="launch-side">
          <Card variant="default" padding="lg" className="launch-preview-card">
            <div className="launch-preview-head">
              <div>
                <p className="start-section-kicker">Blueprint</p>
                <h3 className="start-section-title">{blueprint.name}</h3>
              </div>
              <span className="launch-preview-type">{blueprintMode.label}</span>
            </div>
            <p className="start-sub launch-preview-sub">
              {blueprint.tagline || blueprint.description || blueprintMode.meta}
            </p>
            <p className="launch-preview-structure">Starting structure</p>
            <p className="launch-preview-structure-copy">
              Includes a default lead agent. Roles can be edited later.
            </p>
            <BlueprintTreePreview template={blueprint} />
            <div className="launch-blueprint-actions">
              <Link to={blueprintPath} className="launch-secondary-link">
                Customize blueprint
              </Link>
            </div>
          </Card>
        </div>
      </section>

      <div className="launch-footer">
        <div className="launch-footer-meta">
          <p className="start-section-kicker">Choose execution capacity</p>
          <p className="launch-footer-note">
            Both plans include the full organization and unlimited agents. Pro gives you 4× more LLM
            capacity and 4× more runtime.
          </p>
        </div>

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
                <div className="plan-card-price">
                  <span className="plan-card-price-amount">
                    {item.id === "growth" ? item.dueToday : item.price}
                  </span>
                  <span className="plan-card-price-cadence">
                    {item.id === "growth"
                      ? `first month · then ${item.price}${item.cadence}`
                      : item.cadence}
                  </span>
                </div>
                <p className="launch-plan-intro">{item.intro}</p>
                <ul className="launch-plan-bullets">
                  {item.features.map((feature) => (
                    <li key={feature} className="launch-plan-bullet">
                      {feature}
                    </li>
                  ))}
                </ul>
                <p className="launch-plan-footer">{item.blurb}</p>
              </button>
            );
          })}
        </div>
        <div className="launch-footer-action">
          <div className="launch-footer-copy">
            <p className="launch-footer-note">Due today: {selectedLaunchPlan.dueToday}</p>
          </div>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => void handleLaunch()}
            disabled={submitting || !organizationName.trim() || nameCheck.status !== "available"}
            loading={submitting}
            loadingLabel="Creating"
          >
            {`Pay ${selectedLaunchPlan.dueToday} and launch`}
          </Button>
          <p className="launch-footer-support">
            Created automatically after checkout succeeds. You can change capacity later.
          </p>
        </div>
      </div>
    </div>
  );
}
