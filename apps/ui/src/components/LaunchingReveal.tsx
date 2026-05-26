import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ProgressList, type ProgressStep } from "@/components/ui";
import { api } from "@/lib/api";
import { publicWebsiteUrl } from "@/lib/publicWebsite";
import { trustEmailAddress } from "@/lib/trustEmail";
import { LaunchShell } from "@/pages/trustSetup/LaunchShell";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";

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
 * Owns the launch interstitial and exposes the launched TRUST plus the
 * public website handoff once the placement becomes ready.
 */
export function LaunchingReveal({
  trustId,
  fallbackDisplayName,
  websiteUrl,
  websiteDomain,
  emailAddress,
}: {
  trustId: string;
  fallbackDisplayName?: string;
  websiteUrl?: string | null;
  websiteDomain?: string | null;
  emailAddress?: string | null;
}) {
  const [status, setStatus] = useState<LaunchStatus | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const fetchEntities = useDaemonStore((s) => s.fetchEntities);
  const setActiveEntity = useUIStore((s) => s.setActiveEntity);

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
  const generatedWebsiteUrl =
    trustAddress !== null
      ? publicWebsiteUrl({ id: trustId, name: displayName, trust_address: trustAddress })
      : null;
  const trustToolsPath = trustAddress ? `/trust/${encodeURIComponent(trustAddress)}` : null;
  const launchWebsiteUrl = websiteUrl ?? generatedWebsiteUrl;
  const launchWebsiteLabel =
    websiteDomain ?? launchWebsiteUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? null;
  const launchEmailAddress =
    emailAddress ??
    status?.email_address ??
    (trustAddress !== null
      ? trustEmailAddress({ id: trustId, name: displayName, trust_address: trustAddress })
      : null);
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

  useEffect(() => {
    if (!isReady || hasError || !trustAddress) return;
    void (async () => {
      try {
        await api.updateEntity(trustId, { public: true });
        await fetchEntities();
      } catch (e) {
        if (import.meta.env.MODE !== "test") {
          console.error("failed to publish website on launch", e);
        }
      } finally {
        setActiveEntity(trustAddress);
      }
    })();
  }, [fetchEntities, hasError, isReady, setActiveEntity, trustAddress, trustId]);

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
          ? "The TRUST exists and the public website shell is live."
          : "Payment confirmed. aeqi is creating the TRUST, registering it on Solana, and starting its runtime."}
      </p>

      <ProgressList steps={progressSteps} className="launching-reveal__steps" />

      {isReady && trustAddress && (
        <div className="launching-reveal__complete">
          <div className="launching-reveal__website">
            <div className="launching-reveal__website-meta">
              <span className="launching-reveal__website-label">Website</span>
              <span className="launching-reveal__website-route">
                {launchWebsiteLabel ?? launchWebsiteUrl}
              </span>
            </div>
            <div className="launching-reveal__website-stats" aria-label="Website status">
              <span className="launching-reveal__website-stat">
                <strong>Live</strong>
                <span>Status</span>
              </span>
              <span className="launching-reveal__website-stat">
                <strong>0</strong>
                <span>Views</span>
              </span>
            </div>
          </div>
          {launchEmailAddress && (
            <div className="launching-reveal__website">
              <div className="launching-reveal__website-meta">
                <span className="launching-reveal__website-label">Email</span>
                <span className="launching-reveal__website-route">{launchEmailAddress}</span>
              </div>
              <div className="launching-reveal__website-stats" aria-label="Email status">
                <span className="launching-reveal__website-stat">
                  <strong>Reserved</strong>
                  <span>Status</span>
                </span>
                <span className="launching-reveal__website-stat">
                  <strong>Trust</strong>
                  <span>Owner</span>
                </span>
              </div>
            </div>
          )}
          <div className="launching-reveal__actions">
            {trustToolsPath && (
              <Link className="launching-reveal__cta" to={trustToolsPath}>
                Trust tools
              </Link>
            )}
            {launchWebsiteUrl && (
              <a
                className="launching-reveal__secondary"
                href={launchWebsiteUrl}
                target="_self"
                rel="noreferrer"
              >
                Open Website
              </a>
            )}
          </div>
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
