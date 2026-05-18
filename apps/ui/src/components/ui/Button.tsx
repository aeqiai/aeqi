import { forwardRef } from "react";
import type { ReactNode } from "react";
import BrandMark from "@/components/BrandMark";
import styles from "./Button.module.css";

const LOADING_MARK_SIZE = {
  sm: 12,
  md: 14,
  lg: 16,
  xl: 18,
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "light";
  size?: "sm" | "md" | "lg" | "xl";
  loading?: boolean;
  /** Stretch to fill the container width (auth forms, modal CTAs). */
  fullWidth?: boolean;
  /** Icon rendered to the LEFT of the label. Stays put on hover (no animation).
      Reads as part of the action ("+ New idea"). For decorative forward motion
      ("Continue →"), use `trailingIcon`. Pass a stroked SVG sized to match the
      button (sm: 13px, md/lg: 14px, xl: 16px). Hidden while `loading`. */
  leadingIcon?: ReactNode;
  /** Icon or element rendered to the right of the label. */
  trailingIcon?: ReactNode;
  /** `forward` gives continuation arrows extra offset + hover nudge.
      `inline` keeps dropdown/status glyphs optically attached to the label. */
  trailingIconMode?: "forward" | "inline";
  /** Screen-reader label for the loading mark. Prevents double-announce when button label
      already describes the action (e.g. "Save" + mark should announce "Save", not "Save Loading").
      Defaults to "Loading". Set to empty string to suppress sr-only announcement. */
  loadingLabel?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    loading = false,
    fullWidth = false,
    leadingIcon,
    trailingIcon,
    trailingIconMode = "forward",
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
        <span className={styles.loadingMark}>
          <span className={styles.loadingGlyph} aria-hidden="true">
            <BrandMark size={LOADING_MARK_SIZE[size]} color="currentColor" />
          </span>
          {loadingLabel && <span className="sr-only">{loadingLabel}</span>}
        </span>
      )}
      <span className={styles.content}>
        {leadingIcon && !loading && (
          <span className={styles.leadingIcon} aria-hidden="true">
            {leadingIcon}
          </span>
        )}
        <span className={styles.label}>{children}</span>
        {trailingIcon && (
          <span
            className={[
              styles.trailingIcon,
              trailingIconMode === "forward" ? styles.trailingIconForward : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-hidden="true"
          >
            {trailingIcon}
          </span>
        )}
      </span>
    </button>
  );
});

Button.displayName = "Button";
