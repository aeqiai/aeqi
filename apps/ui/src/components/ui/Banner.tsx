import styles from "./Banner.module.css";

export type BannerKind = "success" | "error" | "warning" | "info";

export interface BannerProps {
  kind: BannerKind;
  children: React.ReactNode;
  className?: string;
}

/**
 * Inline tinted feedback banner — success/error/warning/info.
 *
 * Shape: tinted background, no border (anti-hairline rule), no icon by
 * default. Used for inline form feedback ("Profile updated", "Invalid
 * code"), API errors at the top of a panel, and any short status
 * message that lives in the page rather than a transient toast.
 *
 * `role` is auto-derived: errors and warnings get `role="alert"` so
 * screen readers interrupt; success/info get `role="status"`. Override
 * via `className` only — no `role` prop because it's a footgun (most
 * misuses come from setting role manually).
 */
export function Banner({ kind, children, className }: BannerProps) {
  const role = kind === "error" || kind === "warning" ? "alert" : "status";
  const cls = [styles.banner, styles[kind], className].filter(Boolean).join(" ");
  return (
    <div className={cls} role={role} aria-live="polite">
      {children}
    </div>
  );
}

Banner.displayName = "Banner";
