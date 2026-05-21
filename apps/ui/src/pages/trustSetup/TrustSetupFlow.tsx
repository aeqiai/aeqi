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
  blueprint,
  trustName,
  nameHint,
  nameError,
  onTrustNameChange,
}: Pick<
  TrustSetupFlowProps,
  "blueprint" | "trustName" | "nameHint" | "nameError" | "onTrustNameChange"
>) {
  return (
    <section className="launch-form-step launch-form-step--name" aria-labelledby="launch-title">
      <div className="launch-form-step-body">
        <div className="launch-form-step-head">
          <h1 id="launch-title" className="auth-heading">
            Register TRUST name.
          </h1>
        </div>

        <Input
          aria-label="TRUST name"
          autoFocus
          hint={nameHint}
          error={nameError}
          value={trustName}
          onChange={(e) => onTrustNameChange(e.target.value)}
          placeholder={`${blueprint.name} TRUST`}
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
              Blueprints -&gt;
            </Link>
          </div>
          <span className="launch-blueprint-summary-name">{blueprint.name}</span>
          <span className="launch-blueprint-summary-copy">
            {blueprint.tagline || blueprint.description || "A starting structure for this TRUST."}
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
    copy: string;
    resources: string;
    selected: boolean;
    onSelect: () => void;
  }> = [
    {
      key: "none",
      title: "No operations",
      price: "Free",
      copy: "Ownership only. Add operations later.",
      resources: "No hosted runtime",
      selected: operations === "free",
      onSelect: () => onOperationsChange("free"),
    },
    {
      key: "starter",
      title: "Start up",
      price: `${standardPlan.dueToday}/mo`,
      copy: "Standard runtime for a focused operating TRUST.",
      resources: `${standardPlan.resources.tokens} tokens, ${standardPlan.resources.cpu}, ${standardPlan.resources.ram} RAM`,
      selected: operations === "paid" && plan === "starter",
      onSelect: () => {
        onPlanChange("starter");
        onOperationsChange("paid");
      },
    },
    {
      key: "growth",
      title: "Scale up",
      price: `${proPlan.dueToday} today`,
      copy: `Pro runtime. Then ${proPlan.price}${proPlan.cadence}.`,
      resources: `${proPlan.resources.tokens} tokens, ${proPlan.resources.cpu}, ${proPlan.resources.ram} RAM`,
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
            Optional runtime for agents, quests, events, and memory.
          </p>
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
                <span className="launch-operation-resources">{choice.resources}</span>
              </span>
              <span className="launch-operation-price">{choice.price}</span>
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
          blueprint={blueprint}
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
          size="lg"
          fullWidth
          onClick={onLaunch}
          disabled={submitting || !canSubmit}
          loading={submitting}
          loadingLabel="Launching"
        >
          {operations === "paid"
            ? `Pay ${selectedLaunchPlan.dueToday} and launch TRUST`
            : "Launch TRUST"}
        </Button>
      </footer>
    </LaunchShell>
  );
}
