import { forwardRef } from "react";
import styles from "./Button.module.css";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  /** Stretch to fill the container width (auth forms, modal CTAs). */
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    fullWidth = false,
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
    </button>
  );
});

Button.displayName = "Button";
