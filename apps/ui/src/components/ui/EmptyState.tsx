import styles from "./EmptyState.module.css";

export interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  /** Optional eyebrow label above the title (uppercase mono). */
  eyebrow?: string;
}

/**
 * Generic empty state used across master panes.
 *
 * Brutalist: left-aligned, no decorative icon, optional mono eyebrow.
 * The container it sits in (rail, card, settings pane) supplies the frame.
 */
export function EmptyState({ title, description, action, eyebrow }: EmptyStateProps) {
  return (
    <div className={styles.wrapper}>
      {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
      <h3 className={styles.title}>{title}</h3>
      {description && <p className={styles.description}>{description}</p>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}

EmptyState.displayName = "EmptyState";
