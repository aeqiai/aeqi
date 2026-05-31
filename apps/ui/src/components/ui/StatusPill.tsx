import styles from "./StatusPill.module.css";

export type StatusPillTone =
  | "neutral"
  | "success"
  | "progress"
  | "review"
  | "warning"
  | "error"
  | "info"
  | "muted";

export interface StatusPillProps {
  children: React.ReactNode;
  tone?: StatusPillTone;
  size?: "sm" | "md";
  className?: string;
}

export function StatusPill({
  children,
  tone = "neutral",
  size = "sm",
  className,
}: StatusPillProps) {
  const cls = [styles.pill, styles[tone], styles[size], className].filter(Boolean).join(" ");

  return (
    <span className={cls}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.label}>{children}</span>
    </span>
  );
}

StatusPill.displayName = "StatusPill";
