import styles from "./StatusRow.module.css";

export type StatusDotKind = "idle" | "active" | "warning" | "error";

export interface StatusRowProps {
  /** Lead with EITHER a colored dot (state) OR an icon (provider/brand mark). */
  dot?: StatusDotKind;
  icon?: React.ReactNode;
  label: React.ReactNode;
  /** Optional trailing status text (e.g. "Connected"). Mutually
   * exclusive with `action` in practice — pass one or the other. */
  status?: React.ReactNode;
  /** Optional trailing action button. */
  action?: React.ReactNode;
  className?: string;
}

/**
 * Flat one-line status row — dot or icon, label, trailing status or
 * action. Used for connected accounts, 2FA enabled state, analytics
 * consent toggle, and any settings-style "thing + state + control"
 * triple. No card frame, no hairline divider — sits on the page paper.
 */
export function StatusRow({ dot, icon, label, status, action, className }: StatusRowProps) {
  const cls = [styles.row, className].filter(Boolean).join(" ");
  const dotClass =
    dot === "active"
      ? styles.dotActive
      : dot === "warning"
        ? styles.dotWarning
        : dot === "error"
          ? styles.dotError
          : styles.dotIdle;
  return (
    <div className={cls}>
      {dot && <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />}
      {icon && <span className={styles.icon}>{icon}</span>}
      <span className={styles.label}>{label}</span>
      {status && <span className={styles.status}>{status}</span>}
      {action && <span className={styles.action}>{action}</span>}
    </div>
  );
}

StatusRow.displayName = "StatusRow";
