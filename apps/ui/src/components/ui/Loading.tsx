import BrandMark from "@/components/BrandMark";
import styles from "./Loading.module.css";

export interface LoadingProps {
  variant?: "page" | "section" | "inline";
  size?: "sm" | "md" | "lg";
  label?: string;
  showLabel?: boolean;
  className?: string;
}

// Loading always uses the BrandMark (the connected æ ligature) — the
// single-glyph form is the runtime's loading-state identity. The full
// "aeqi" wordmark is for navigation chrome, not waiting states. Page-
// variant loaders bump to a larger size so the splash reads as
// deliberate; inline/section loaders sit small.
const BRAND_MARK_SIZE = {
  sm: 14,
  md: 20,
  lg: 56,
} as const;

export function Loading({
  variant = "inline",
  size = variant === "page" ? "lg" : "md",
  label = "Loading",
  showLabel = variant === "section",
  className,
}: LoadingProps) {
  const markSize = BRAND_MARK_SIZE[size];
  const cls = [styles.loading, styles[variant], styles[size], className].filter(Boolean).join(" ");

  return (
    <span className={cls} role="status" aria-label={label}>
      <span className={styles.mark} aria-hidden="true">
        <BrandMark size={markSize} />
      </span>
      {showLabel && <span className={styles.label}>{label}</span>}
    </span>
  );
}

Loading.displayName = "Loading";
