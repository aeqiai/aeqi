import { type ReactNode } from "react";
import styles from "./WizardPanel.module.css";

export interface WizardPanelProps {
  id: string;
  title: string;
  summary: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/**
 * Generic collapsible section container for the /start/:slug wizard.
 *
 * Collapsed → shows a one-line summary of the current value.
 * Expanded  → shows the full editable content.
 *
 * No hairlines, no border-left stripes, no drop shadows. Separation
 * comes from spacing and a subtle tint shift to --color-card-muted.
 */
export function WizardPanel({
  id,
  title,
  summary,
  expanded,
  onToggle,
  children,
}: WizardPanelProps) {
  const headingId = `${id}-heading`;
  const regionId = `${id}-region`;

  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <button
        id={headingId}
        type="button"
        className={styles.trigger}
        aria-expanded={expanded}
        aria-controls={regionId}
        onClick={onToggle}
      >
        <span className={styles.triggerTitle}>{title}</span>
        {!expanded && <span className={styles.triggerSummary}>{summary}</span>}
        <span className={styles.chevron} aria-hidden="true">
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            style={{
              transform: expanded ? "rotate(180deg)" : "none",
              transition: "transform 0.15s ease",
            }}
          >
            <path
              d="M2 4L6 8L10 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {expanded && (
        <div id={regionId} role="region" aria-labelledby={headingId} className={styles.body}>
          {children}
        </div>
      )}
    </section>
  );
}
