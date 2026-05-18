import BrandMark from "@/components/BrandMark";
import Wordmark from "@/components/Wordmark";
import styles from "./Loading.module.css";

export interface LoadingProps {
  variant?: "page" | "section" | "inline";
  size?: "sm" | "md" | "lg";
  label?: string;
  showLabel?: boolean;
  className?: string;
}

const WORDMARK_SIZE = {
  sm: 14,
  md: 20,
  lg: 48,
} as const;

const BRAND_MARK_SIZE = {
  sm: 14,
  md: 20,
  lg: 32,
} as const;

export function Loading({
  variant = "inline",
  size = variant === "page" ? "lg" : "md",
  label = "Loading",
  showLabel = variant === "section",
  className,
}: LoadingProps) {
  const Mark = variant === "page" ? Wordmark : BrandMark;
  const markSize = variant === "page" ? WORDMARK_SIZE[size] : BRAND_MARK_SIZE[size];
  const cls = [styles.loading, styles[variant], styles[size], className].filter(Boolean).join(" ");

  return (
    <span className={cls} role="status" aria-label={label}>
      <span className={styles.mark} aria-hidden="true">
        <Mark size={markSize} />
      </span>
      {showLabel && <span className={styles.label}>{label}</span>}
    </span>
  );
}

Loading.displayName = "Loading";
