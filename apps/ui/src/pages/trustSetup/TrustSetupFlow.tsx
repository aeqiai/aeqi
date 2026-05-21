import { ArrowLeft, ArrowRight, Check, Layers3, ShieldCheck, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import Wordmark from "@/components/Wordmark";
import { BlueprintTreePreview } from "@/components/blueprints/BlueprintTreePreview";
import { Banner, Button, EmptyState, Input, Loading } from "@/components/ui";
import { blueprintId } from "@/lib/blueprintId";
import { LAUNCH_PLANS, type LaunchPlan, type LaunchPlanId } from "@/lib/pricing";
import type { SingleBlueprint as Blueprint } from "@/lib/types";

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
    <main className="signup-split launch-split">
      <div className="signup-form-side launch-form-side">
        <div className="auth-container launch-flow-card">
          <div className="launch-loading">
            <Loading size="sm" /> Loading blueprint...
          </div>
        </div>
      </div>
      <aside className="signup-pitch-side launch-pitch-side" aria-hidden="true" />
    </main>
  );
}

export function LaunchShellError({ error, onBack }: { error: string | null; onBack: () => void }) {
  return (
    <main className="signup-split launch-split">
      <div className="signup-form-side launch-form-side">
        <div className="auth-container launch-flow-card">
          <EmptyState
            title="Blueprint not found."
            description={error || "We couldn't find a blueprint with that id."}
            action={
              <Button variant="secondary" onClick={onBack}>
                Back to catalog
              </Button>
            }
          />
        </div>
      </div>
      <aside className="signup-pitch-side launch-pitch-side" aria-hidden="true" />
    </main>
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
      <div className="launch-step-icon" aria-hidden="true">
        <Layers3 size={18} strokeWidth={1.7} />
      </div>
      <h1 id="launch-title" className="auth-heading">
        Choose the blueprint.
      </h1>
      <p className="auth-subheading">
        Start with a shape. You can change ownership and governance after the TRUST exists.
      </p>

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
      <div className="launch-step-icon" aria-hidden="true">
        <ShieldCheck size={18} strokeWidth={1.7} />
      </div>
      <h1 id="launch-title" className="auth-heading">
        Name the TRUST.
      </h1>
      <p className="auth-subheading">
        The {blueprint.name} blueprint is selected. Ownership starts with you.
      </p>

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
        <p className="launch-preview-copy">1 of 1 required - you</p>
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
      <div className="launch-step-icon" aria-hidden="true">
        <Sparkles size={18} strokeWidth={1.7} />
      </div>
      <h1 id="launch-title" className="auth-heading">
        Choose operations.
      </h1>
      <p className="auth-subheading">
        A free TRUST can hold roles and assets. Operations add agents, quests, events, and memory.
      </p>

      <div className="launch-operations-grid" role="radiogroup" aria-label="Operations">
        <button
          type="button"
          className={`launch-operation-card ${operations === "free" ? "is-selected" : ""}`}
          onClick={() => onOperationsChange("free")}
          aria-pressed={operations === "free"}
        >
          <span className="launch-operation-title">No operations</span>
          <span className="launch-operation-price">Free</span>
          <span className="launch-operation-copy">
            Creates the TRUST without a runtime. Add operations later.
          </span>
        </button>
        <button
          type="button"
          className={`launch-operation-card ${operations === "paid" ? "is-selected" : ""}`}
          onClick={() => onOperationsChange("paid")}
          aria-pressed={operations === "paid"}
        >
          <span className="launch-operation-title">Activate operations</span>
          <span className="launch-operation-price">Standard or Pro</span>
          <span className="launch-operation-copy">
            Provision agents and the operating runtime now.
          </span>
        </button>
      </div>

      {operations === "paid" && (
        <div className="launch-plan-grid" role="radiogroup" aria-label="Runtime plan">
          {LAUNCH_PLANS.map((item) => {
            const selected = item.id === plan;
            return (
              <button
                key={item.id}
                type="button"
                className={`launch-plan-option ${selected ? "is-selected" : ""}`}
                onClick={() => onPlanChange(item.id)}
                aria-pressed={selected}
              >
                <span className="launch-plan-name">{item.name}</span>
                <span className="launch-plan-price">
                  {item.id === "growth" ? item.dueToday : item.price}
                </span>
                <span className="launch-plan-copy">
                  {item.id === "growth"
                    ? `First month, then ${item.price}${item.cadence}`
                    : item.cadence}
                </span>
              </button>
            );
          })}
        </div>
      )}
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

function LaunchPitch() {
  return (
    <aside className="signup-pitch-side launch-pitch-side" aria-hidden="true">
      <div className="signup-pitch-scrim launch-pitch-scrim" />
      <div className="signup-pitch-content launch-pitch-content">
        <p className="signup-pitch-eyebrow">LAUNCH A TRUST</p>
        <h2 className="signup-pitch-heading">
          <span>Own first.</span>
          <span>Operate when</span>
          <span>you are ready.</span>
        </h2>
        <p className="signup-lead">Blueprint. Name. Operations. Governance comes after creation.</p>
      </div>
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
    <main className="signup-split launch-split">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <div className="signup-form-side launch-form-side" id="main-content">
        <section className="auth-container launch-flow-card" aria-labelledby="launch-title">
          <div className="auth-logo launch-logo">
            <Wordmark size={36} />
          </div>

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
                fullWidth
                onClick={onNext}
                disabled={!canGoNext}
                trailingIcon={<ArrowRight size={14} strokeWidth={1.7} />}
              >
                Continue
              </Button>
            )}
          </footer>
        </section>

        <StructurePreview blueprint={blueprint} blueprintPath={blueprintPath} />
      </div>

      <LaunchPitch />
    </main>
  );
}
