import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { blueprintId } from "@/lib/blueprintId";
import { DEFAULT_BLUEPRINT_SLUG } from "@/lib/blueprintDefaults";
import { entityBasePath } from "@/lib/entityPath";
import { goExternal } from "@/lib/navigation";
import { DEFAULT_LAUNCH_PLAN, LAUNCH_PLANS, type LaunchPlanId } from "@/lib/pricing";
import { RECOMMENDED_BLUEPRINTS } from "@/lib/recommendedBlueprints";
import type { SingleBlueprint as Blueprint } from "@/lib/types";
import { isSingleBlueprint } from "@/lib/types";
import { useAuthStore } from "@/store/auth";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";
import { LaunchingReveal } from "@/components/LaunchingReveal";
import {
  LaunchShellError,
  LaunchShellLoading,
  TrustSetupFlow,
} from "@/pages/trustSetup/TrustSetupFlow";
import "@/styles/blueprint-launch-picker.css";

const FIRST_RUN_BLUEPRINT_SLUG = "personal-os";

type LaunchEntry = "standard" | "personal";
type OperationsChoice = "free" | "paid";

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

function pickFirstRunBlueprintId(byBlueprintId: Map<string, Blueprint>): string | null {
  if (byBlueprintId.has(FIRST_RUN_BLUEPRINT_SLUG)) return FIRST_RUN_BLUEPRINT_SLUG;
  if (byBlueprintId.has(DEFAULT_BLUEPRINT_SLUG)) return DEFAULT_BLUEPRINT_SLUG;
  return byBlueprintId.keys().next().value ?? null;
}

function userFallbackName(user: { name?: string | null; email?: string | null } | null): string {
  return user?.name?.trim() || user?.email?.split("@")[0] || "You";
}

function defaultTrustName(
  user: { name?: string | null; email?: string | null } | null,
  blueprint: Blueprint | null,
): string {
  const base = userFallbackName(user);
  if (blueprint && blueprintId(blueprint) !== FIRST_RUN_BLUEPRINT_SLUG) {
    return blueprint.root?.name || blueprint.name || `${base} TRUST`;
  }
  return `${base}'s TRUST`;
}

function unavailableNameHint(name: string): string {
  const base = name.trim() || "Janus";
  return `Already taken. Try ${base} Labs, ${base} One, or ${base} Trust.`;
}

export default function TrustSetupPage({ entry = "standard" }: { entry?: LaunchEntry } = {}) {
  const navigate = useNavigate();
  const { blueprintId: blueprintIdParam = "" } = useParams<{ blueprintId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const launchId = searchParams.get("launch");
  const requestedBlueprint = searchParams.get("blueprint") || blueprintIdParam;
  const isFirstRun = entry === "personal" || requestedBlueprint === FIRST_RUN_BLUEPRINT_SLUG;

  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const entities = useDaemonStore((s) => s.entities);
  const activeEntityId = useUIStore((s) => s.activeEntity);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.user?.is_admin === true);
  const canSkipCheckout = isAdmin;

  const [blueprint, setBlueprint] = useState<Blueprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [provisioning, setProvisioning] = useState(false);
  const [trustName, setTrustName] = useState("");
  const [trustNameTouched, setTrustNameTouched] = useState(false);
  const [operations, setOperations] = useState<OperationsChoice>("paid");
  const [plan, setPlan] = useState<LaunchPlanId>(DEFAULT_LAUNCH_PLAN);
  const [nameCheck, setNameCheck] = useState<NameCheckState>({ status: "idle" });

  const nameCheckSeq = useRef(0);
  const activeLaunchEntity = useMemo(
    () => (launchId ? (entities.find((entity) => entity.id === launchId) ?? null) : null),
    [entities, launchId],
  );

  useEffect(() => {
    document.title = "aeqi";
  }, []);

  useEffect(() => {
    void fetchEntities();
  }, [fetchEntities]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    const loadBlueprints = async () => {
      try {
        const resp = await api.getBlueprints();
        if (cancelled) return;
        const available = (resp.blueprints ?? []).filter(isSingleBlueprint);
        const byId = new Map<string, Blueprint>();
        for (const tpl of available) byId.set(blueprintId(tpl), tpl);

        let selectedId = requestedBlueprint || "";
        if (isFirstRun) selectedId = pickFirstRunBlueprintId(byId) ?? selectedId;
        if (!selectedId) selectedId = pickInitialBlueprintId(available, byId) ?? "";

        let selected = selectedId ? (byId.get(selectedId) ?? null) : null;
        if (!selected && selectedId) {
          const detail = await api.getBlueprint(selectedId);
          if (cancelled) return;
          if (detail.blueprint && isSingleBlueprint(detail.blueprint)) {
            selected = detail.blueprint;
            available.push(detail.blueprint);
          }
        }

        if (!selected) {
          setLoadError("No blueprints are available yet.");
          return;
        }

        setBlueprint(selected);
        setPlan(DEFAULT_LAUNCH_PLAN);
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Could not reach the blueprint store.";
        setLoadError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadBlueprints();
    return () => {
      cancelled = true;
    };
  }, [isFirstRun, requestedBlueprint]);

  useEffect(() => {
    if (trustNameTouched || !blueprint) return;
    setTrustName(defaultTrustName(user, blueprint));
  }, [blueprint, trustNameTouched, user]);

  const selectedLaunchPlan = useMemo(
    () => LAUNCH_PLANS.find((p) => p.id === plan) ?? LAUNCH_PLANS[0],
    [plan],
  );

  const selectedBlueprintId = blueprint ? blueprintId(blueprint) : "";
  const blueprintPath = blueprint
    ? `/blueprints/${encodeURIComponent(selectedBlueprintId)}`
    : "/blueprints";
  const exitEntity = useMemo(() => {
    if (isFirstRun) return null;
    return (
      (activeEntityId ? entities.find((entity) => entity.id === activeEntityId) : null) ??
      entities[0] ??
      null
    );
  }, [activeEntityId, entities, isFirstRun]);
  const exitHref = exitEntity ? entityBasePath(exitEntity) : null;

  const nameHint = useMemo(() => {
    switch (nameCheck.status) {
      case "checking":
        return "Checking availability...";
      case "available":
        return "Name is available.";
      case "error":
        return nameCheck.message;
      case "taken":
        return unavailableNameHint(trustName);
      case "idle":
      default:
        return "Choose a name for this TRUST.";
    }
  }, [nameCheck, trustName]);

  const nameError = useMemo(() => {
    if (nameCheck.status === "error") {
      return nameCheck.message;
    }
    return undefined;
  }, [nameCheck]);

  useEffect(() => {
    const name = trustName.trim();
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
  }, [trustName]);

  useEffect(() => {
    setProvisioning(Boolean(launchId));
    if (launchId) setSubmitError(null);
  }, [launchId]);

  const handleFreeTrust = useCallback(async () => {
    if (!blueprint) return;
    const displayName = trustName.trim();
    if (!displayName || nameCheck.status !== "available") return;

    setSubmitError(null);
    setSubmitting(true);
    try {
      const created = await api.createPersonalTrust({
        name: displayName,
        owner_name: userFallbackName(user),
        goal: "launch",
        tagline: `${blueprint.name} blueprint - operations off`,
      });
      const trustId = created.trust?.id || created.id;
      if (!trustId) throw new Error("The TRUST was created without an id.");

      setActiveEntity(trustId);
      await fetchEntities();
      const refreshed = useDaemonStore.getState().entities.find((entity) => entity.id === trustId);
      if (refreshed?.trust_address) {
        navigate(`/trust/${encodeURIComponent(refreshed.trust_address)}`, { replace: true });
      } else {
        navigate("/trust", { replace: true });
      }
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not create this TRUST.");
      setSubmitting(false);
    }
  }, [blueprint, fetchEntities, nameCheck.status, navigate, setActiveEntity, trustName, user]);

  const handlePaidLaunch = useCallback(async () => {
    if (!blueprint) return;
    const displayName = trustName.trim();
    if (!displayName || nameCheck.status !== "available") return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      if (canSkipCheckout) {
        const resp = await api.startLaunch({
          template: blueprintId(blueprint),
          display_name: displayName,
          mission: "",
          plan,
        });

        setSearchParams(
          new URLSearchParams({
            launch: resp.trust_id,
          }),
          { replace: true },
        );
        return;
      }

      const { url } = await api.createCheckoutSession({
        blueprint: blueprintId(blueprint),
        display_name: displayName,
        mission: "",
        plan,
        launch: true,
      });
      goExternal(url);
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) {
        try {
          const { url } = await api.createCheckoutSession({
            blueprint: blueprintId(blueprint),
            display_name: displayName,
            mission: "",
            plan,
            launch: true,
          });
          goExternal(url);
          return;
        } catch {
          setSubmitError("Payment is required to activate operations for this TRUST.");
        }
      } else {
        setSubmitError(e instanceof Error ? e.message : "Launch failed. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [blueprint, canSkipCheckout, nameCheck.status, plan, setSearchParams, trustName]);

  const handleLaunch = () => {
    if (operations === "free") {
      void handleFreeTrust();
      return;
    }
    void handlePaidLaunch();
  };

  if (loading && !blueprint) {
    return <LaunchShellLoading />;
  }

  if (!blueprint) {
    return <LaunchShellError error={loadError} onBack={() => navigate("/blueprints")} />;
  }

  if (provisioning && launchId) {
    return (
      <LaunchingReveal
        trustId={launchId}
        fallbackDisplayName={activeLaunchEntity?.name || trustName.trim() || undefined}
      />
    );
  }

  const canSubmit = trustName.trim().length > 1 && nameCheck.status === "available";

  return (
    <TrustSetupFlow
      blueprint={blueprint}
      blueprintPath={blueprintPath}
      submitError={submitError}
      loadError={loadError}
      trustName={trustName}
      nameHint={nameHint}
      nameError={nameError}
      operations={operations}
      plan={plan}
      selectedLaunchPlan={selectedLaunchPlan}
      exitHref={exitHref}
      canSubmit={canSubmit}
      submitting={submitting}
      onTrustNameChange={(value) => {
        setTrustNameTouched(true);
        setTrustName(value);
      }}
      onOperationsChange={setOperations}
      onPlanChange={setPlan}
      onLaunch={handleLaunch}
    />
  );
}
