import styles from "./Badge.module.css";

export type BadgeVariant =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "error"
  | "muted"
  | "accent";

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  size?: "sm" | "md";
  dot?: boolean;
  className?: string;
}

const STATUS_VARIANT_MAP: Record<string, BadgeVariant> = {
  idle: "neutral",
  working: "accent",
  offline: "muted",
  pending: "neutral",
  in_progress: "info",
  done: "success",
  blocked: "warning",
  cancelled: "muted",
  failed: "error",
  active: "success",
  paused: "muted",
};

const STATUS_LABELS: Record<string, string> = {
  idle: "Idle",
  working: "Working",
  offline: "Offline",
  pending: "Pending",
  in_progress: "In Progress",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
  failed: "Failed",
  active: "Active",
  paused: "Paused",
};

export function Badge({
  children,
  variant = "neutral",
  size = "md",
  dot = false,
  className,
}: BadgeProps) {
  const cls = [styles.badge, styles[variant], size === "sm" ? styles.sm : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={cls}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}

Badge.displayName = "Badge";

/** Convenience wrapper for status values (maps status string to variant + label). */
export interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
  className?: string;
}

export function StatusBadge({ status, size = "md", className }: StatusBadgeProps) {
  const variant = STATUS_VARIANT_MAP[status] || "neutral";
  const label = STATUS_LABELS[status] || status;

  return (
    <Badge variant={variant} size={size} dot className={className}>
      {label}
    </Badge>
  );
}

StatusBadge.displayName = "StatusBadge";
