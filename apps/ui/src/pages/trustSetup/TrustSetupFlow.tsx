import { ArrowLeft, ArrowRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Banner, Button, EmptyState, Input, Loading } from "@/components/ui";
import { countBlueprintStructures } from "@/lib/blueprintStructures";
import type { LaunchPlan, LaunchPlanId } from "@/lib/pricing";
import { LAUNCH_PLANS } from "@/lib/pricing";
import type { SingleBlueprint as Blueprint } from "@/lib/types";
import { LaunchShell, type LaunchPitchContent } from "./LaunchShell";

type OperationsChoice = "free" | "paid" | "sandbox";

interface TrustSetupFlowProps {
  blueprint: Blueprint;
  blueprintPath: string;
  submitError: string | null;
  loadError: string | null;
  trustName: string;
  nameHint?: string;
  nameError?: string;
  operations: OperationsChoice;
  plan: LaunchPlanId;
  selectedLaunchPlan: LaunchPlan;
  adminSandboxAvailable?: boolean;
  exitHref?: string | null;
  canSubmit: boolean;
  submitting: boolean;
  onTrustNameChange: (value: string) => void;
  onOperationsChange: (value: OperationsChoice) => void;
  onPlanChange: (value: LaunchPlanId) => void;
  onLaunch: () => void;
}

export function LaunchShellLoading() {
  return (
    <LaunchShell>
      <div className="launch-loading">
        <Loading size="sm" /> Loading blueprint...
      </div>
    </LaunchShell>
  );
}

export function LaunchShellError({ error, onBack }: { error: string | null; onBack: () => void }) {
  return (
    <LaunchShell>
      <EmptyState
        title="Template not found."
        description={error || "We couldn't find a template with that id."}
        action={
          <Button variant="secondary" onClick={onBack}>
            Back to catalog
          </Button>
        }
      />
    </LaunchShell>
  );
}

function blueprintStats(blueprint: Blueprint): string {
  const declaredRoles = blueprint.seed_roles?.length ?? 0;
  const totalAgents = (blueprint.seed_agents?.length ?? 0) + 1;
  const structures = countBlueprintStructures(blueprint);
  const roles = declaredRoles > 0 ? declaredRoles : totalAgents;
  const views = blueprint.seed_views?.length ?? 0;
  const parts = [
    structures > 1 ? `${structures} structures` : null,
    `${roles} roles`,
    `${totalAgents} agents`,
    views > 0 ? `${views} ${views === 1 ? "view" : "views"}` : null,
  ].filter(Boolean);
  return parts.join(" · ");
}

function NameSection({
  trustName,
  nameHint,
  nameError,
  onTrustNameChange,
}: Pick<TrustSetupFlowProps, "trustName" | "nameHint" | "nameError" | "onTrustNameChange">) {
  const launchSteps = ["Name", "Template", "Operations"];

  return (
    <section className="launch-form-step launch-form-step--name" aria-labelledby="launch-title">
      <div className="launch-form-step-body">
        <div className="launch-form-step-head">
          <p className="launch-kicker">TRUST launch</p>
          <h1 id="launch-title" className="auth-heading">
            Launch your TRUST.
          </h1>
          <p className="auth-subheading">
            Name the workspace, confirm the template, and choose whether to add hosted operations
            now.
          </p>
          <ol className="launch-sequence" aria-label="Launch sequence">
            {launchSteps.map((step, index) => (
              <li key={step} className="launch-sequence-item">
                <span className="launch-sequence-index">{String(index + 1).padStart(2, "0")}</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>

        <Input
          aria-label="TRUST name"
          autoFocus
          label="TRUST name"
          hint={nameHint}
          error={nameError}
          value={trustName}
          onChange={(e) => onTrustNameChange(e.target.value)}
          placeholder="Your TRUST"
          size="lg"
        />
      </div>
    </section>
  );
}

function BlueprintSection({
  blueprint,
  blueprintPath,
  operations,
}: Pick<TrustSetupFlowProps, "blueprint" | "blueprintPath" | "operations">) {
  const freeOperations = operations === "free";

  return (
    <section className="launch-form-step" aria-labelledby="launch-blueprint-title">
      <div className="launch-form-step-body">
        <div className="launch-section-row">
          <h2 id="launch-blueprint-title" className="launch-section-title">
            Template
          </h2>
          <Link to={blueprintPath} className="launch-inline-link">
            View
            <ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" />
          </Link>
        </div>
        <div className="launch-blueprint-summary">
          <span className="launch-blueprint-summary-head">
            <span className="launch-blueprint-summary-name">{blueprint.name}</span>
            <span className="launch-blueprint-summary-meta">{blueprintStats(blueprint)}</span>
          </span>
          <span className="launch-blueprint-summary-copy">
            {freeOperations
              ? "Creates a free platform TRUST with a public profile and founding Director. Template agents, quests, memory, tools, and evidence activate with hosted operations."
              : "Includes the initial roles, agents, quests, memory, tools, and evidence structure."}
          </span>
        </div>
      </div>
    </section>
  );
}

function OperationsSection({
  operations,
  plan,
  adminSandboxAvailable = false,
  onOperationsChange,
  onPlanChange,
}: Pick<
  TrustSetupFlowProps,
  "operations" | "plan" | "adminSandboxAvailable" | "onOperationsChange" | "onPlanChange"
>) {
  const standardPlan = LAUNCH_PLANS.find((item) => item.id === "starter") ?? LAUNCH_PLANS[0];
  const proPlan = LAUNCH_PLANS.find((item) => item.id === "growth") ?? LAUNCH_PLANS[0];
  const choices: Array<{
    key: string;
    title: string;
    price: string;
    secondaryPrice?: string;
    copy: string;
    detail?: string;
    selected: boolean;
    onSelect: () => void;
  }> = [
    {
      key: "none",
      title: "Free TRUST",
      price: "Free",
      copy: "Create a free platform TRUST with a public profile and founding Director.",
      selected: operations === "free",
      onSelect: () => onOperationsChange("free"),
    },
    ...(adminSandboxAvailable
      ? [
          {
            key: "sandbox",
            title: "Admin sandbox",
            price: "Admin only",
            copy: "Provision hosted operations without checkout.",
            detail: "No Stripe checkout",
            selected: operations === "sandbox",
            onSelect: () => onOperationsChange("sandbox"),
          },
        ]
      : []),
    {
      key: "starter",
      title: standardPlan.name,
      price: `${standardPlan.dueToday}/mo`,
      copy: "Hosted operations for focused agent work.",
      selected: operations === "paid" && plan === "starter",
      onSelect: () => {
        onPlanChange("starter");
        onOperationsChange("paid");
      },
    },
    {
      key: "growth",
      title: proPlan.name,
      price: `${proPlan.dueToday} today`,
      secondaryPrice: `then ${proPlan.price}${proPlan.cadence}`,
      copy: "Higher capacity for heavier execution.",
      detail: "4x Standard capacity",
      selected: operations === "paid" && plan === "growth",
      onSelect: () => {
        onPlanChange("growth");
        onOperationsChange("paid");
      },
    },
  ];

  return (
    <section className="launch-form-step" aria-labelledby="launch-operations-title">
      <div className="launch-form-step-body">
        <div className="launch-form-step-head">
          <h2 id="launch-operations-title" className="launch-section-title">
            Operations
          </h2>
          <p className="launch-section-copy">
            Free creates a platform TRUST and public profile. Standard and Pro add hosted agents,
            quests, memory, tools, and runtime capacity.
          </p>
        </div>

        <div
          className={`launch-operations-grid launch-operations-grid--${choices.length}`}
          role="radiogroup"
          aria-label="Operations"
        >
          {choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              role="radio"
              className={`launch-operation-card ${choice.selected ? "is-selected" : ""}`}
              onClick={choice.onSelect}
              aria-checked={choice.selected}
            >
              <span className="launch-operation-radio" aria-hidden="true">
                <span className="launch-operation-radio-dot" />
              </span>
              <span className="launch-operation-main">
                <span className="launch-option-head">
                  <span className="launch-operation-title">{choice.title}</span>
                  <span className="launch-operation-copy">{choice.copy}</span>
                  {choice.detail && (
                    <span className="launch-operation-detail">{choice.detail}</span>
                  )}
                </span>
              </span>
              <span className="launch-operation-side">
                <span className="launch-operation-price">{choice.price}</span>
                {choice.secondaryPrice && (
                  <span className="launch-operation-price-sub">{choice.secondaryPrice}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function launchPitchForOperations(operations: OperationsChoice): LaunchPitchContent | undefined {
  if (operations !== "free") return undefined;
  return {
    eyebrow: "FREE TRUST",
    lines: ["Public", "profile", "first."],
    lead: "Create the TRUST profile and founding Director now. Hosted agents, quests, memory, tools, and proof activate when operations are added.",
    ledger: [
      { label: "Identity", value: "TRUST profile, name, founder" },
      { label: "Director", value: "Founding owner ready" },
      { label: "Operations", value: "Available with Standard or Pro" },
    ],
  };
}

export function TrustSetupFlow({
  blueprint,
  blueprintPath,
  submitError,
  loadError,
  trustName,
  nameHint,
  nameError,
  operations,
  plan,
  selectedLaunchPlan,
  adminSandboxAvailable,
  exitHref,
  canSubmit,
  submitting,
  onTrustNameChange,
  onOperationsChange,
  onPlanChange,
  onLaunch,
}: TrustSetupFlowProps) {
  const navigate = useNavigate();
  const handleExit = () => {
    const historyState = window.history.state as { idx?: unknown } | null;

    if (typeof historyState?.idx === "number" && historyState.idx > 0) {
      navigate(-1);
      return;
    }

    if (exitHref) {
      navigate(exitHref);
    }
  };

  const exitAction = exitHref ? (
    <nav className="launch-flow-exit" aria-label="Launch exit">
      <button type="button" className="launch-exit-link" onClick={handleExit}>
        <ArrowLeft size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>Back</span>
      </button>
    </nav>
  ) : null;

  return (
    <LaunchShell
      mobileActionHref={exitHref}
      mobileActionLabel="Back"
      mobileActionOnClick={exitHref ? handleExit : undefined}
      topSlot={exitAction}
      pitch={launchPitchForOperations(operations)}
    >
      {submitError && (
        <div className="launch-flow-error">
          <Banner kind="error">{submitError}</Banner>
        </div>
      )}

      {loadError && !submitError && (
        <div className="launch-flow-error">
          <Banner kind="error">{loadError}</Banner>
        </div>
      )}

      <div className="launch-compact-form">
        <NameSection
          trustName={trustName}
          nameHint={nameHint}
          nameError={nameError}
          onTrustNameChange={onTrustNameChange}
        />
        <BlueprintSection
          blueprint={blueprint}
          blueprintPath={blueprintPath}
          operations={operations}
        />
        <OperationsSection
          operations={operations}
          plan={plan}
          adminSandboxAvailable={adminSandboxAvailable}
          onOperationsChange={onOperationsChange}
          onPlanChange={onPlanChange}
        />
      </div>

      <footer className="launch-actions">
        <Button
          type="button"
          variant="primary"
          size="xl"
          fullWidth
          onClick={onLaunch}
          disabled={submitting || !canSubmit}
          loading={submitting}
          loadingLabel="Launching"
          trailingIcon={<ArrowRight size={16} strokeWidth={1.8} />}
        >
          {operations === "paid"
            ? `Launch with ${selectedLaunchPlan.name} - ${
                selectedLaunchPlan.id === "growth"
                  ? `${selectedLaunchPlan.dueToday} today`
                  : `${selectedLaunchPlan.dueToday}/mo`
              }`
            : operations === "sandbox"
              ? "Launch admin sandbox"
              : "Create free TRUST"}
        </Button>
      </footer>
    </LaunchShell>
  );
}
