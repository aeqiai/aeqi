import { useEffect, useState } from "react";

import { api } from "@/lib/api";

import "@/styles/launching-reveal.css";

const SOLANA_CLUSTER =
  (import.meta.env.VITE_SOLANA_CLUSTER as string | undefined) ?? "localnet-solana";

const STEPS = [
  { key: "creating_trust", label: "Creating TRUST" },
  { key: "signing_on_solana", label: "Signing on Solana" },
  { key: "loading_roles", label: "Loading roles" },
  { key: "spawning_agent", label: "Spawning agent" },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

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

  return (
    <section
      className="launching-reveal"
      aria-live="polite"
      aria-busy={status?.placement_status !== "ready"}
    >
      <div className="launching-reveal__inner">
        <h1 className="launching-reveal__heading">{displayName} is forming.</h1>
        <p className="launching-reveal__subheading">
          aeqi is signing four transactions on Solana to make this Company real.
        </p>
        <ol className="launching-reveal__steps">
          {STEPS.map((step) => {
            const milestone = milestones?.[step.key as StepKey];
            const reached = milestone?.reached ?? false;
            return (
              <li
                key={step.key}
                className={`launching-reveal__step${
                  reached ? " launching-reveal__step--reached" : ""
                }`}
                data-step={step.key}
              >
                <span className="launching-reveal__mark" aria-hidden="true">
                  {reached ? "●" : "○"}
                </span>
                <span className="launching-reveal__label">{step.label}</span>
                {step.key === "signing_on_solana" && reached && trustAddress && (
                  <a
                    className="launching-reveal__explorer"
                    href={explorerUrl(trustAddress)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`View TRUST ${trustAddress} on the Solana explorer`}
                  >
                    {truncate(trustAddress)}
                  </a>
                )}
              </li>
            );
          })}
        </ol>
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
        {!trustError && !runtimeError && pollError && !status && (
          <p className="launching-reveal__pending">{pollError}</p>
        )}
      </div>
    </section>
  );
}
