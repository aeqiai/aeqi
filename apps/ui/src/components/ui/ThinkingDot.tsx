import styles from "./ThinkingDot.module.css";

export interface ThinkingDotProps {
  size?: "sm" | "md";
  className?: string;
}

export function ThinkingDot({ size = "sm", className }: ThinkingDotProps) {
  return (
    <span
      className={[styles.dot, styles[size], className].filter(Boolean).join(" ")}
      role="status"
      aria-label="Thinking"
    />
  );
}

ThinkingDot.displayName = "ThinkingDot";
