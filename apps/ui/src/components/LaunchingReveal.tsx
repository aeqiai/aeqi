import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { ProgressList, type ProgressStep } from "@/components/ui";
import { api } from "@/lib/api";
import { publicWebsiteUrl } from "@/lib/publicWebsite";
import { companyEmailAddress } from "@/lib/companyEmail";
import { LaunchShell } from "@/pages/companySetup/LaunchShell";
import { useDaemonStore } from "@/store/daemon";
import { useUIStore } from "@/store/ui";

import "@/styles/launching-reveal.css";

const SOLANA_CLUSTER =
  (import.meta.env.VITE_SOLANA_CLUSTER as string | undefined) ?? "localnet-solana";

const STEPS = [
  { key: "creating_company", label: "Creating COMPANY" },
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
 * Watch-your-COMPANY-form interstitial. Polls the launch-status endpoint
 * every 1s and lights each of four steps as the placement transitions
 * through the spawn flow.
 *
 * Owns the launch interstitial and exposes the launched COMPANY plus the
 * public website handoff once the placement becomes ready.
 */
export function LaunchingReveal({
  companyId,
  fallbackDisplayName,
  websiteUrl,
  websiteDomain,
  emailAddress,
}: {
  companyId: string;
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
        const data = await api.getLaunchStatus(companyId);
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
  }, [companyId]);

  const milestones = status?.milestones;
  const companyAddress = status?.company_address ?? null;
  const trustError = status?.company_error ?? null;
  const runtimeError = status?.runtime_error ?? null;
  const displayName = status?.display_name || fallbackDisplayName || "Your COMPANY";
  const runtimeReady = ["ready", "complete"].includes(status?.placement_status ?? "");
  const chainReady = Boolean(companyAddress);
  const isReady = runtimeReady && chainReady;
  const hasError = Boolean(trustError || runtimeError);
  const generatedWebsiteUrl =
    companyAddress !== null
      ? publicWebsiteUrl({ id: companyId, name: displayName, company_address: companyAddress })
      : null;
  const trustToolsPath = companyAddress ? `/company/${encodeURIComponent(companyAddress)}` : null;
  const launchWebsiteUrl = websiteUrl ?? generatedWebsiteUrl;
  const launchWebsiteLabel =
    websiteDomain ?? launchWebsiteUrl?.replace(/^https?:\/\//, "").replace(/\/$/, "") ?? null;
  const launchEmailAddress =
    emailAddress ??
    status?.email_address ??
    (companyAddress !== null
      ? companyEmailAddress({ id: companyId, name: displayName, company_address: companyAddress })
      : null);
  const reachedSteps = STEPS.map((step) => {
    const milestone = milestones?.[step.key as MilestoneKey];
    if (step.key === "signing_on_solana")
      return chainReady || Boolean(milestone?.reached && chainReady);
    return runtimeReady || (milestone?.reached ?? false);
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
        step.key === "signing_on_solana" && reached && companyAddress ? (
          <a
            className="launching-reveal__explorer"
            href={explorerUrl(companyAddress)}
            target="_blank"
            rel="noreferrer"
            aria-label={`View COMPANY ${companyAddress} on the Solana explorer`}
          >
            {truncate(companyAddress)}
          </a>
        ) : undefined,
    };
  });
  const busy = !isReady && !hasError;

  useEffect(() => {
    if (!isReady || hasError || !companyAddress) return;
    void (async () => {
      try {
        await api.updateEntity(companyId, { public: true });
        await fetchEntities();
      } catch (e) {
        if (import.meta.env.MODE !== "test") {
          console.error("failed to publish website on launch", e);
        }
      } finally {
        setActiveEntity(companyId);
      }
    })();
  }, [fetchEntities, hasError, isReady, setActiveEntity, companyAddress, companyId]);

  return (
    <LaunchShell
      cardClassName="launching-reveal__card"
      ariaLive="polite"
      ariaBusy={busy}
      pitch={{
        eyebrow: "COMPANY LAUNCH",
        lines: ["Your", "workspace", "is forming."],
        lead: "Identity, roles, agents, quests, memory, tools, and evidence are coming online together.",
      }}
    >
      <h1 className="auth-heading">
        {isReady
          ? `${displayName} is ready.`
          : runtimeReady
            ? `${displayName} runtime is ready.`
            : `Launching ${displayName}.`}
      </h1>
      <p className="auth-subheading">
        {isReady
          ? "The COMPANY exists and the public website shell is live."
          : runtimeReady
            ? "The workspace is live. On-chain COMPANY identity is still confirming before we expose website and explorer handoff."
            : "aeqi is creating the workspace, registering the COMPANY on Solana, and starting its runtime."}
      </p>

      <ProgressList steps={progressSteps} className="launching-reveal__steps" />

      {isReady && companyAddress && (
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
                  <strong>Company</strong>
                  <span>Owner</span>
                </span>
              </div>
            </div>
          )}
          <div className="launching-reveal__actions">
            {trustToolsPath && (
              <Link className="launching-reveal__cta" to={trustToolsPath}>
                COMPANY tools
              </Link>
            )}
            {launchWebsiteUrl && (
              <a
                className="launching-reveal__secondary"
                href={launchWebsiteUrl}
                target="_self"
                rel="noreferrer"
              >
                Open website
              </a>
            )}
          </div>
        </div>
      )}

      {trustError && (
        <p className="launching-reveal__error" role="alert">
          Company provisioning failed: {trustError}
        </p>
      )}
      {!trustError && runtimeError && (
        <p className="launching-reveal__error" role="alert">
          Runtime provisioning failed: {runtimeError}
        </p>
      )}
      {hasError && companyAddress && (
        <Link
          className="launching-reveal__secondary"
          to={`/company/${encodeURIComponent(companyAddress)}`}
        >
          Enter COMPANY
        </Link>
      )}
      {!trustError && !runtimeError && pollError && !status && (
        <p className="launching-reveal__pending">{pollError}</p>
      )}
    </LaunchShell>
  );
}
