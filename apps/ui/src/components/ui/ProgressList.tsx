import type { ReactNode } from "react";

import "./ProgressList.css";

export type ProgressStepStatus = "pending" | "active" | "done" | "error";

export interface ProgressStep {
  key: string;
  label: string;
  status: ProgressStepStatus;
  detail?: ReactNode;
}

export function ProgressList({
  steps,
  className = "",
}: {
  steps: ProgressStep[];
  className?: string;
}) {
  return (
    <ol className={["progress-list", className].filter(Boolean).join(" ")}>
      {steps.map((step) => (
        <li
          key={step.key}
          className={`progress-list-step progress-list-step--${step.status}`}
          aria-current={step.status === "active" ? "step" : undefined}
        >
          <span className="progress-list-marker" aria-hidden="true">
            {step.status === "done"
              ? "✓"
              : step.status === "error"
                ? "!"
                : step.status === "active"
                  ? "•"
                  : "·"}
          </span>
          <span className="progress-list-label">{step.label}</span>
          {step.detail && <span className="progress-list-detail">{step.detail}</span>}
        </li>
      ))}
    </ol>
  );
}
