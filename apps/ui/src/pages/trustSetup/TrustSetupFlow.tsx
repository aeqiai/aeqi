import { ArrowRight, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { Banner, Button, EmptyState, Input, Loading } from "@/components/ui";
import { countBlueprintStructures } from "@/lib/blueprintStructures";
import type { LaunchPlan, LaunchPlanId } from "@/lib/pricing";
import { LAUNCH_PLANS } from "@/lib/pricing";
import type { SingleBlueprint as Blueprint } from "@/lib/types";
import { LaunchShell } from "./LaunchShell";

type OperationsChoice = "free" | "paid";

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
        title="Blueprint not found."
        description={error || "We couldn't find a blueprint with that id."}
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
  const seedAgents = blueprint.seed_agents?.length ?? 0;
  const structures = countBlueprintStructures(blueprint);
  const roles = declaredRoles > 0 ? declaredRoles : seedAgents;
  const parts = [
    structures > 1 ? `${structures} structures` : null,
    `${roles} roles`,
    `${seedAgents} agents`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function NameSection({
  trustName,
  nameHint,
  nameError,
  onTrustNameChange,
}: Pick<TrustSetupFlowProps, "trustName" | "nameHint" | "nameError" | "onTrustNameChange">) {
  return (
    <section className="launch-form-step launch-form-step--name" aria-labelledby="launch-title">
      <div className="launch-form-step-body">
        <div className="launch-form-step-head">
          <h1 id="launch-title" className="auth-heading">
            Launch your TRUST.
          </h1>
        </div>

        <Input
          aria-label="TRUST name"
          autoFocus
          label="TRUST name"
          hint={nameHint}
          error={nameError}
          value={trustName}
          onChange={(e) => onTrustNameChange(e.target.value)}
          placeholder="Janus"
          size="lg"
        />
      </div>
    </section>
  );
}

function BlueprintSection({
  blueprint,
  blueprintPath,
}: Pick<TrustSetupFlowProps, "blueprint" | "blueprintPath">) {
  return (
    <section className="launch-form-step" aria-labelledby="launch-blueprint-title">
      <div className="launch-form-step-body">
        <div className="launch-blueprint-summary">
          <div className="launch-blueprint-summary-head">
            <span id="launch-blueprint-title" className="launch-section-title">
              Blueprint
            </span>
            <Link to={blueprintPath} className="launch-inline-link">
              Blueprints
              <ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" />
            </Link>
          </div>
          <span className="launch-blueprint-summary-name">{blueprint.name}</span>
          <span className="launch-blueprint-summary-copy">
            Start with your first agent, ownership structure, and operating layer.
          </span>
          <span className="launch-blueprint-summary-meta">{blueprintStats(blueprint)}</span>
        </div>
      </div>
    </section>
  );
}

function OperationsSection({
  operations,
  plan,
  onOperationsChange,
  onPlanChange,
}: Pick<TrustSetupFlowProps, "operations" | "plan" | "onOperationsChange" | "onPlanChange">) {
  const standardPlan = LAUNCH_PLANS.find((item) => item.id === "starter") ?? LAUNCH_PLANS[0];
  const proPlan = LAUNCH_PLANS.find((item) => item.id === "growth") ?? LAUNCH_PLANS[0];
  const choices: Array<{
    key: string;
    title: string;
    price: string;
    secondaryPrice?: string;
    copy: string;
    selected: boolean;
    onSelect: () => void;
  }> = [
    {
      key: "none",
      title: "Ownership only",
      price: "Free",
      copy: "Launch without hosted runtime.",
      selected: operations === "free",
      onSelect: () => onOperationsChange("free"),
    },
    {
      key: "starter",
      title: "Operating",
      price: `${standardPlan.dueToday}/mo`,
      copy: "Standard runtime for agents and workflows.",
      selected: operations === "paid" && plan === "starter",
      onSelect: () => {
        onPlanChange("starter");
        onOperationsChange("paid");
      },
    },
    {
      key: "growth",
      title: "Accelerated",
      price: `${proPlan.dueToday} today`,
      secondaryPrice: `then ${proPlan.price}${proPlan.cadence}`,
      copy: "More capacity for serious execution.",
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
          <p className="launch-section-copy">Choose how this TRUST should run.</p>
        </div>

        <div className="launch-operations-grid" role="radiogroup" aria-label="Operations">
          {choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              role="radio"
              className={`launch-operation-card ${choice.selected ? "is-selected" : ""}`}
              onClick={choice.onSelect}
              aria-checked={choice.selected}
            >
              <span className="launch-operation-main">
                <span className="launch-option-head">
                  <span className="launch-operation-title">{choice.title}</span>
                  <span className="launch-operation-copy">{choice.copy}</span>
                </span>
              </span>
              <span className="launch-operation-side">
                {choice.selected && (
                  <span className="launch-operation-selected">
                    <Check size={12} strokeWidth={2} />
                    Selected
                  </span>
                )}
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
  canSubmit,
  submitting,
  onTrustNameChange,
  onOperationsChange,
  onPlanChange,
  onLaunch,
}: TrustSetupFlowProps) {
  return (
    <LaunchShell>
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
        <BlueprintSection blueprint={blueprint} blueprintPath={blueprintPath} />
        <OperationsSection
          operations={operations}
          plan={plan}
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
            ? `Launch TRUST — ${
                selectedLaunchPlan.id === "growth"
                  ? `${selectedLaunchPlan.dueToday} today`
                  : `${selectedLaunchPlan.dueToday}/mo`
              }`
            : "Launch TRUST"}
        </Button>
      </footer>
    </LaunchShell>
  );
}
