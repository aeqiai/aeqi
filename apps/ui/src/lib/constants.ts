// TODO: Once @aeqi/tokens is published to npm, replace these with:
//   import { statusColor, statusBgColor, priorityColor } from "@aeqi/tokens";
// The tokens package (packages/tokens/src/tokens.ts) exports resolved color
// values. These inline-style maps use CSS variable references instead, which
// is correct for React inline styles that need to stay in sync with the
// CSS custom-property theme.

export const STATUS_COLORS: Record<string, string> = {
  idle: "var(--color-text-secondary)",
  working: "var(--color-accent)",
  offline: "var(--color-text-muted)",
  active: "var(--color-success)",
  paused: "var(--color-text-muted)",
  pending: "var(--color-text-secondary)",
  in_progress: "var(--color-info)",
  done: "var(--color-success)",
  blocked: "var(--color-warning)",
  cancelled: "var(--color-text-muted)",
  failed: "var(--color-error)",
};

export const STATUS_BG_COLORS: Record<string, string> = {
  idle: "rgba(136, 136, 160, 0.1)",
  working: "rgba(99, 102, 241, 0.1)",
  offline: "rgba(85, 85, 106, 0.1)",
  active: "var(--color-success-bg)",
  paused: "rgba(85, 85, 106, 0.1)",
  pending: "rgba(136, 136, 160, 0.1)",
  in_progress: "var(--color-info-bg)",
  done: "var(--color-success-bg)",
  blocked: "var(--color-warning-bg)",
  cancelled: "rgba(85, 85, 106, 0.1)",
  failed: "var(--color-error-bg)",
};

export const PRIORITY_COLORS: Record<string, string> = {
  critical: "var(--color-error)",
  high: "var(--color-warning)",
  normal: "var(--color-text-primary)",
  low: "var(--color-text-muted)",
};
