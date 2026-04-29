import { forwardRef } from "react";
import type { ReactNode } from "react";
import styles from "./Button.module.css";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "light";
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  /** Stretch to fill the container width (auth forms, modal CTAs). */
  fullWidth?: boolean;
  /** Icon or element rendered to the right of the label. Animated on hover with translate-x. */
  trailingIcon?: ReactNode;
  /** Screen-reader label for the loading spinner. Prevents double-announce when button label
      already describes the action (e.g. "Save" + spinner should announce "Save", not "Save Loading").
      Defaults to "Loading". Set to empty string to suppress sr-only announcement. */
  loadingLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    fullWidth = false,
    trailingIcon,
    loadingLabel = "Loading",
    className,
    children,
    disabled,
    ...rest
  },
  ref,
) {
  const cls = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth ? styles.fullWidth : "",
    loading ? styles.loading : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button ref={ref} className={cls} disabled={disabled || loading} aria-busy={loading} {...rest}>
      {loading && (
        <span className={styles.spinner} aria-hidden="true">
          {loadingLabel && <span className="sr-only">{loadingLabel}</span>}
        </span>
      )}
      {children}
      {trailingIcon && (
        <span className={styles.trailingIcon} aria-hidden="true">
          {trailingIcon}
        </span>
      )}
    </button>
  );
});

Button.displayName = "Button";
