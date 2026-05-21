import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ProgressList, type ProgressStep } from "@/components/ui";
import { api } from "@/lib/api";
import { LaunchShell } from "@/pages/trustSetup/LaunchShell";

import "@/styles/launching-reveal.css";

const SOLANA_CLUSTER =
  (import.meta.env.VITE_SOLANA_CLUSTER as string | undefined) ?? "localnet-solana";

const STEPS = [
  { key: "creating_trust", label: "Creating TRUST" },
  { key: "signing_on_solana", label: "Registering on Solana" },
  { key: "loading_roles", label: "Activating roles" },
  { key: "spawning_agent", label: "Starting runtime" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];
type MilestoneKey = StepKey;

type LaunchStatus = Awaited<ReturnType<typeof api.getLaunchStatus>>;

function explorerUrl(addr: string): string {
  if (SOLANA_CLUSTER === "mainnet" || SOLANA_CLUSTER === "mainnet-beta") {
    return `https://solana.fm/address/${addr}`;
  }
  return `https://solana.fm/address/${addr}?cluster=${SOLANA_CLUSTER}`;
}

function truncate(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/**
 * Watch-your-TRUST-form interstitial. Polls the launch-status endpoint
 * every 1s and lights each of four steps as the placement transitions
 * through the spawn flow.
 *
 * Owns visualization only. Navigation when the placement becomes
 * `ready` is the caller's responsibility (TrustSetupPage's existing
 * effect handles it via the entities store).
 */
export function LaunchingReveal({
  trustId,
  fallbackDisplayName,
}: {
  trustId: string;
  fallbackDisplayName?: string;
}) {
  const [status, setStatus] = useState<LaunchStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const tick = async () => {
      try {
        const data = await api.getLaunchStatus(trustId);
        if (cancelled) return;
        setStatus(data);
        setPollError(null);
      } catch (e) {
        if (cancelled) return;
        setPollError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(tick, 1000);
        }
      }
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [trustId]);

  const milestones = status?.milestones;
  const trustAddress = status?.trust_address ?? null;
  const trustError = status?.trust_error ?? null;
  const runtimeError = status?.runtime_error ?? null;
  const displayName = status?.display_name || fallbackDisplayName || "Your TRUST";
  const isReady = ["ready", "complete"].includes(status?.placement_status ?? "");
  const hasError = Boolean(trustError || runtimeError);
  const reachedSteps = STEPS.map((step) => {
    const milestone = milestones?.[step.key as MilestoneKey];
    return isReady || (milestone?.reached ?? false);
  });
  const firstPendingIndex = reachedSteps.findIndex((reached) => !reached);
  const failedStepIndex = hasError
    ? firstPendingIndex === -1
      ? STEPS.length - 1
      : firstPendingIndex
    : -1;
  const progressSteps: ProgressStep[] = STEPS.map((step, index) => {
    const reached = reachedSteps[index] ?? false;
    const active =
      !hasError &&
      !reached &&
      (firstPendingIndex === index || (firstPendingIndex === -1 && index === 0));
    return {
      key: step.key,
      label: step.label,
      status: reached
        ? "done"
        : index === failedStepIndex
          ? "error"
          : active
            ? "active"
            : "pending",
      detail:
        step.key === "signing_on_solana" && reached && trustAddress ? (
          <a
            className="launching-reveal__explorer"
            href={explorerUrl(trustAddress)}
            target="_blank"
            rel="noreferrer"
            aria-label={`View TRUST ${trustAddress} on the Solana explorer`}
          >
            {truncate(trustAddress)}
          </a>
        ) : undefined,
    };
  });
  const busy = !isReady && !hasError;

  return (
    <LaunchShell
      cardClassName="launching-reveal__card"
      ariaLive="polite"
      ariaBusy={busy}
      pitch={{
        eyebrow: "LAUNCH A TRUST",
        lines: ["Programmable", "company", "vehicle."],
        lead: "A TRUST aligns stakeholders, ownership, and operations inside one programmable company — so everyone moves toward the same outcome: creating value.",
      }}
    >
      <h1 className="auth-heading">
        {isReady ? `${displayName} is ready.` : `Launching ${displayName}.`}
      </h1>
      <p className="auth-subheading">
        {isReady
          ? "The TRUST exists. Enter it when you are ready."
          : "Payment confirmed. aeqi is creating the TRUST, registering it on Solana, and starting its runtime."}
      </p>

      <ProgressList steps={progressSteps} className="launching-reveal__steps" />

      {isReady && trustAddress && (
        <div className="launching-reveal__complete">
          <Link className="launching-reveal__cta" to={`/trust/${encodeURIComponent(trustAddress)}`}>
            Enter Trust
          </Link>
        </div>
      )}

      {trustError && (
        <p className="launching-reveal__error" role="alert">
          Trust provisioning failed: {trustError}
        </p>
      )}
      {!trustError && runtimeError && (
        <p className="launching-reveal__error" role="alert">
          Runtime provisioning failed: {runtimeError}
        </p>
      )}
      {hasError && trustAddress && (
        <Link
          className="launching-reveal__secondary"
          to={`/trust/${encodeURIComponent(trustAddress)}`}
        >
          Enter Trust
        </Link>
      )}
      {!trustError && !runtimeError && pollError && !status && (
        <p className="launching-reveal__pending">{pollError}</p>
      )}
    </LaunchShell>
  );
}
