import { Check } from "lucide-react";

import { LAUNCH_PLANS, type LaunchPlan, type LaunchPlanId } from "@/lib/pricing";

function capacityLine(plan: LaunchPlan): string {
  const { resources } = plan;
  return `${resources.tokens} tokens / mo, ${resources.cpu}, ${resources.ram} RAM, ${resources.storage} storage`;
}

function priceLine(plan: LaunchPlan): { primary: string; secondary: string } {
  if (plan.id === "growth") {
    return { primary: `${plan.dueToday} today`, secondary: `Then ${plan.price}${plan.cadence}` };
  }
  return { primary: `${plan.dueToday} today`, secondary: `Then ${plan.price}${plan.cadence}` };
}

export function RuntimePlanPicker({
  value,
  onChange,
  label = "Runtime capacity",
  helper = "Capacity can be changed later. Both plans include the same organization and agent surface.",
}: {
  value: LaunchPlanId;
  onChange: (value: LaunchPlanId) => void;
  label?: string;
  helper?: string;
}) {
  return (
    <div className="launch-capacity">
      <div className="launch-capacity-head">
        <p className="launch-capacity-label">{label}</p>
        <p className="launch-capacity-note">{helper}</p>
      </div>
      <div className="launch-capacity-options" role="radiogroup" aria-label={label}>
        {LAUNCH_PLANS.map((plan) => {
          const selected = plan.id === value;
          const price = priceLine(plan);
          return (
            <button
              key={plan.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`launch-capacity-option ${selected ? "is-selected" : ""}`}
              onClick={() => onChange(plan.id)}
            >
              <span className="launch-capacity-main">
                <span className="launch-capacity-title-row">
                  <span className="launch-capacity-title">{plan.name}</span>
                  {plan.recommended && <span className="launch-capacity-badge">Recommended</span>}
                </span>
                <span className="launch-capacity-spec">{capacityLine(plan)}</span>
              </span>
              <span className="launch-capacity-price">
                <span className="launch-capacity-price-main">{price.primary}</span>
                <span className="launch-capacity-price-sub">{price.secondary}</span>
              </span>
              <span className="launch-capacity-check" aria-hidden="true">
                {selected && <Check size={14} strokeWidth={2} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
