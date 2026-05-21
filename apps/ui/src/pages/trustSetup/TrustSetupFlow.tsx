import { Link } from "react-router-dom";
import { RuntimePlanPicker } from "@/components/billing/RuntimePlanPicker";
import { Banner, Button, EmptyState, Input, Loading } from "@/components/ui";
import { countBlueprintStructures } from "@/lib/blueprintStructures";
import type { LaunchPlan, LaunchPlanId } from "@/lib/pricing";
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
      <span className="launch-form-index" aria-hidden="true">
        1
      </span>
      <div className="launch-form-step-body">
        <div className="launch-form-step-head">
          <h1 id="launch-title" className="auth-heading">
            Name the TRUST.
          </h1>
          <p className="auth-subheading">
            This is the vehicle stakeholders will recognize. Initial ownership starts with you.
          </p>
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
      <span className="launch-form-index" aria-hidden="true">
        2
      </span>
      <div className="launch-form-step-body">
        <div className="launch-form-step-head launch-form-step-head--inline">
          <div>
            <h2 id="launch-blueprint-title" className="launch-section-title">
              Blueprint
            </h2>
            <p className="launch-section-copy">Structure can evolve after launch.</p>
          </div>
          <Link to="/blueprints" className="launch-inline-link">
            Browse store
          </Link>
        </div>

        <Link to={blueprintPath} className="launch-blueprint-summary">
          <span className="launch-blueprint-summary-name">{blueprint.name}</span>
          <span className="launch-blueprint-summary-copy">
            {blueprint.tagline || blueprint.description || "A starting structure for this TRUST."}
          </span>
          <span className="launch-blueprint-summary-meta">{blueprintStats(blueprint)}</span>
        </Link>
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
  return (
    <section className="launch-form-step" aria-labelledby="launch-operations-title">
      <span className="launch-form-index" aria-hidden="true">
        3
      </span>
      <div className="launch-form-step-body">
        <div className="launch-form-step-head">
          <h2 id="launch-operations-title" className="launch-section-title">
            Ownership or operations
          </h2>
          <p className="launch-section-copy">
            Launch with ownership only, or activate the runtime so agents can operate the TRUST.
          </p>
        </div>

        <div className="launch-operations-grid" role="radiogroup" aria-label="Operations">
          <button
            type="button"
            role="radio"
            className={`launch-operation-card ${operations === "free" ? "is-selected" : ""}`}
            onClick={() => onOperationsChange("free")}
            aria-checked={operations === "free"}
          >
            <span className="launch-option-head">
              <span className="launch-operation-title">Ownership only</span>
              <span className="launch-operation-price">Free</span>
            </span>
            <span className="launch-operation-copy">
              Creates the TRUST with you as the initial signer. Add operations later.
            </span>
          </button>
          <button
            type="button"
            role="radio"
            className={`launch-operation-card ${operations === "paid" ? "is-selected" : ""}`}
            onClick={() => onOperationsChange("paid")}
            aria-checked={operations === "paid"}
          >
            <span className="launch-option-head">
              <span className="launch-operation-title">Ownership + operations</span>
              <span className="launch-operation-price">Paid runtime</span>
            </span>
            <span className="launch-operation-copy">
              Provisions agents, quests, events, memory, and operating capacity now.
            </span>
          </button>
        </div>

        {operations === "paid" && (
          <RuntimePlanPicker
            value={plan}
            onChange={onPlanChange}
            label="Operations capacity"
            helper="Choose the runtime capacity for this TRUST. Capacity can change later."
          />
        )}
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
