import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Link } from "react-router-dom";
import { RuntimePlanPicker } from "@/components/billing/RuntimePlanPicker";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { Banner, Button, EmptyState, Input, Loading } from "@/components/ui";
import { blueprintId } from "@/lib/blueprintId";
import type { LaunchPlan, LaunchPlanId } from "@/lib/pricing";
import type { SingleBlueprint as Blueprint } from "@/lib/types";
import { LaunchShell } from "./LaunchShell";

type LaunchStep = "blueprint" | "details" | "operations";
type OperationsChoice = "free" | "paid";

type StepItem = { id: LaunchStep; label: string };

interface TrustSetupFlowProps {
  visibleSteps: StepItem[];
  stepIndex: number;
  step: LaunchStep;
  blueprints: Blueprint[];
  blueprint: Blueprint;
  selectedBlueprintId: string;
  blueprintPath: string;
  submitError: string | null;
  loadError: string | null;
  trustName: string;
  nameHint?: string;
  nameError?: string;
  operations: OperationsChoice;
  plan: LaunchPlanId;
  selectedLaunchPlan: LaunchPlan;
  showBack: boolean;
  canGoNext: boolean;
  canSubmit: boolean;
  submitting: boolean;
  onChooseBlueprint: (tpl: Blueprint) => void;
  onTrustNameChange: (value: string) => void;
  onOperationsChange: (value: OperationsChoice) => void;
  onPlanChange: (value: LaunchPlanId) => void;
  onBack: () => void;
  onNext: () => void;
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

function StepRow({ visibleSteps, stepIndex }: { visibleSteps: StepItem[]; stepIndex: number }) {
  return (
    <div className="launch-step-row" aria-label="Launch progress">
      {visibleSteps.map((item, index) => (
        <span
          key={item.id}
          className={`launch-step-pill ${
            index === stepIndex ? "is-current" : index < stepIndex ? "is-complete" : ""
          }`}
        >
          <span className="launch-step-mark" aria-hidden="true">
            {index < stepIndex ? <Check size={12} strokeWidth={2} /> : index + 1}
          </span>
          {item.label}
        </span>
      ))}
    </div>
  );
}

function BlueprintStep({
  blueprints,
  selectedBlueprintId,
  onChooseBlueprint,
}: Pick<TrustSetupFlowProps, "blueprints" | "selectedBlueprintId" | "onChooseBlueprint">) {
  return (
    <section className="launch-step-panel" aria-labelledby="launch-title">
      <div className="launch-step-head">
        <h1 id="launch-title" className="auth-heading">
          Pick the starting shape.
        </h1>
        <p className="auth-subheading">
          Choose the initial structure. Ownership, roles, and governance can change after creation.
        </p>
      </div>

      <div className="launch-blueprint-list" role="list" aria-label="Blueprints">
        {blueprints.slice(0, 6).map((tpl) => {
          const id = blueprintId(tpl);
          const selected = id === selectedBlueprintId;
          return (
            <button
              key={id}
              type="button"
              className={`launch-blueprint-card ${selected ? "is-selected" : ""}`}
              onClick={() => onChooseBlueprint(tpl)}
              aria-pressed={selected}
            >
              <span className="launch-blueprint-name">{tpl.name}</span>
              <span className="launch-blueprint-copy">
                {tpl.tagline || tpl.description || "A starting structure for this TRUST."}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function DetailsStep({
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
    <section className="launch-step-panel" aria-labelledby="launch-title">
      <div className="launch-step-head">
        <h1 id="launch-title" className="auth-heading">
          Name the TRUST.
        </h1>
        <p className="auth-subheading">
          The {blueprint.name} blueprint is selected. This is the vehicle stakeholders will
          recognize.
        </p>
      </div>

      <Input
        aria-label="TRUST name"
        hint={nameHint}
        error={nameError}
        value={trustName}
        onChange={(e) => onTrustNameChange(e.target.value)}
        placeholder="Enter a TRUST name"
        size="lg"
      />

      <div className="launch-trust-preview" aria-live="polite">
        <p className="launch-preview-kicker">Initial ownership</p>
        <p className="launch-preview-title">{trustName || "Your TRUST"}</p>
        <p className="launch-preview-copy">1 signer required: you</p>
      </div>
    </section>
  );
}

function OperationsStep({
  operations,
  plan,
  onOperationsChange,
  onPlanChange,
}: Pick<TrustSetupFlowProps, "operations" | "plan" | "onOperationsChange" | "onPlanChange">) {
  return (
    <section className="launch-step-panel" aria-labelledby="launch-title">
      <div className="launch-step-head">
        <h1 id="launch-title" className="auth-heading">
          Choose how it operates.
        </h1>
        <p className="auth-subheading">
          Create the TRUST for free, or start the runtime now so agents, quests, events, and memory
          are ready on entry.
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
            <span className="launch-operation-title">No operations</span>
            <span className="launch-operation-price">Free</span>
          </span>
          <span className="launch-operation-copy">
            Creates the TRUST without a runtime. Add operations later.
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
            <span className="launch-operation-title">Activate operations</span>
            <span className="launch-operation-price">Standard or Pro</span>
          </span>
          <span className="launch-operation-copy">
            Provision agents and the operating runtime now.
          </span>
        </button>
      </div>

      {operations === "paid" && <RuntimePlanPicker value={plan} onChange={onPlanChange} />}
    </section>
  );
}

function StructurePreview({
  blueprint,
  blueprintPath,
}: Pick<TrustSetupFlowProps, "blueprint" | "blueprintPath">) {
  return (
    <aside className="launch-structure-preview" aria-label="Selected blueprint preview">
      <div className="launch-preview-head">
        <div>
          <p className="launch-preview-kicker">Selected blueprint</p>
          <h2 className="launch-preview-name">{blueprint.name}</h2>
        </div>
        <Link to={blueprintPath} className="launch-secondary-link">
          View
        </Link>
      </div>
      <p className="launch-preview-copy">
        {blueprint.tagline || blueprint.description || "A starting structure for this TRUST."}
      </p>
      <BlueprintTreePreview template={blueprint} />
    </aside>
  );
}

export function TrustSetupFlow({
  visibleSteps,
  stepIndex,
  step,
  blueprints,
  blueprint,
  selectedBlueprintId,
  blueprintPath,
  submitError,
  loadError,
  trustName,
  nameHint,
  nameError,
  operations,
  plan,
  selectedLaunchPlan,
  showBack,
  canGoNext,
  canSubmit,
  submitting,
  onChooseBlueprint,
  onTrustNameChange,
  onOperationsChange,
  onPlanChange,
  onBack,
  onNext,
  onLaunch,
}: TrustSetupFlowProps) {
  return (
    <LaunchShell
      sideSlot={<StructurePreview blueprint={blueprint} blueprintPath={blueprintPath} />}
    >
      <StepRow visibleSteps={visibleSteps} stepIndex={stepIndex} />

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

      {step === "blueprint" && (
        <BlueprintStep
          blueprints={blueprints}
          selectedBlueprintId={selectedBlueprintId}
          onChooseBlueprint={onChooseBlueprint}
        />
      )}
      {step === "details" && (
        <DetailsStep
          blueprint={blueprint}
          trustName={trustName}
          nameHint={nameHint}
          nameError={nameError}
          onTrustNameChange={onTrustNameChange}
        />
      )}
      {step === "operations" && (
        <OperationsStep
          operations={operations}
          plan={plan}
          onOperationsChange={onOperationsChange}
          onPlanChange={onPlanChange}
        />
      )}

      <footer className="launch-actions">
        {showBack ? (
          <Button
            type="button"
            variant="secondary"
            size="lg"
            onClick={onBack}
            leadingIcon={<ArrowLeft size={14} strokeWidth={1.7} />}
          >
            Back
          </Button>
        ) : (
          <Link to="/blueprints" className="launch-secondary-link">
            Browse store
          </Link>
        )}

        {step === "operations" ? (
          <Button
            type="button"
            variant="primary"
            size="lg"
            fullWidth
            onClick={onLaunch}
            disabled={submitting || !canSubmit}
            loading={submitting}
            loadingLabel="Creating"
            trailingIcon={<ArrowRight size={14} strokeWidth={1.7} />}
          >
            {operations === "free"
              ? "Create free TRUST"
              : `Pay ${selectedLaunchPlan.dueToday} and launch`}
          </Button>
        ) : (
          <Button
            type="button"
            variant="primary"
            size="lg"
            fullWidth
            onClick={onNext}
            disabled={!canGoNext}
            trailingIcon={<ArrowRight size={14} strokeWidth={1.7} />}
          >
            Continue
          </Button>
        )}
      </footer>
    </LaunchShell>
  );
}
