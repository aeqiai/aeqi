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
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    fullWidth = false,
    trailingIcon,
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
          <span className="sr-only">Loading</span>
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
