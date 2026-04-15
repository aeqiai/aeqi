/**
 * @aeqi/tokens — TypeScript constants
 *
 * Use these when you need token values in JS/TS logic
 * (e.g. charting libraries, inline styles, dynamic theming).
 * For CSS/Tailwind, use the CSS or preset exports instead.
 */

export const color = {
  bg: {
    base: "#ffffff",
    surface: "rgba(0, 0, 0, 0.015)",
    elevated: "rgba(0, 0, 0, 0.035)",
    overlay: "rgba(0, 0, 0, 0.08)",
  },

  text: {
    primary: "rgba(0, 0, 0, 0.85)",
    secondary: "rgba(0, 0, 0, 0.50)",
    muted: "rgba(0, 0, 0, 0.30)",
  },

  accent: {
    DEFAULT: "#000000",
    dim: "rgba(0, 0, 0, 0.45)",
    bg: "rgba(0, 0, 0, 0.04)",
  },

  border: {
    DEFAULT: "rgba(0, 0, 0, 0.08)",
    hover: "rgba(0, 0, 0, 0.15)",
  },

  status: {
    success: "#22c55e",
    error: "#ef4444",
    warning: "#f59e0b",
    info: "#3b82f6",
  },

  statusBg: {
    success: "rgba(34, 197, 94, 0.10)",
    error: "rgba(239, 68, 68, 0.10)",
    warning: "rgba(245, 158, 11, 0.10)",
    info: "rgba(59, 130, 246, 0.10)",
  },

  glass: {
    bg: "rgba(255, 255, 255, 0.90)",
    border: "rgba(0, 0, 0, 0.08)",
  },

  brand: {
    venture: "#6366f1",
    fund: "#334155",
    entity: "#94a3b8",
    foundation: "#808080",
  },

  funding: {
    angel: "#10b981",
    seed: "#6366f1",
    bridge: "#3b82f6",
    series: "#94a3b8",
    exit: "#000000",
  },

  role: {
    partner: "#00fff5",
    advisor: "#10b981",
    holder: "#000000",
    director: "#6366f1",
    executive: "#64748b",
    dealflow: "#3b82f6",
  },
} as const;

export const font = {
  family: {
    sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
    serif: '"EB Garamond", "Georgia", serif',
  },

  size: {
    "3xs": "0.5625rem",
    "2xs": "0.625rem",
    xs: "0.75rem",
    sm: "0.8125rem",
    base: "0.875rem",
    lg: "1rem",
    xl: "1.25rem",
    "2xl": "1.5rem",
    "3xl": "1.875rem",
    "4xl": "2.25rem",
  },

  weight: {
    normal: 400,
    medium: 500,
    semibold: 600,
    bold: 700,
  },

  leading: {
    tight: 1.25,
    normal: 1.5,
    relaxed: 1.75,
  },
} as const;

export const space = {
  0: "2px",
  1: "0.25rem",
  2: "0.5rem",
  3: "0.75rem",
  4: "1rem",
  5: "1.25rem",
  6: "1.5rem",
  8: "2rem",
  10: "2.5rem",
  12: "3rem",
  16: "4rem",
} as const;

export const radius = {
  xs: "4px",
  sm: "6px",
  md: "8px",
  lg: "12px",
  xl: "16px",
  full: "999px",
} as const;

export const shadow = {
  sm: "0 1px 3px rgba(0, 0, 0, 0.06)",
  md: "0 4px 12px rgba(0, 0, 0, 0.08)",
  lg: "0 8px 24px rgba(0, 0, 0, 0.10)",
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.10), 0 8px 10px -6px rgba(0, 0, 0, 0.10)",
} as const;

export const transition = {
  fast: "150ms ease",
  normal: "200ms cubic-bezier(0.4, 0, 0.2, 1)",
  slow: "500ms cubic-bezier(0.4, 0, 0.2, 1)",
} as const;

export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modalBackdrop: 40,
  modal: 50,
  popover: 60,
  tooltip: 70,
} as const;

export const breakpoint = {
  sm: "640px",
  md: "768px",
  lg: "1024px",
  xl: "1280px",
  "2xl": "1536px",
} as const;

/** Append hex opacity suffix to a hex color. */
export function withOpacity(hex: string, percent: 5 | 10 | 20 | 30 | 50 | 80): string {
  const map: Record<number, string> = {
    5: "0D",
    10: "1A",
    20: "33",
    30: "4D",
    50: "80",
    80: "CC",
  };
  return `${hex}${map[percent]}`;
}

/** Map of workflow statuses to their token colors. */
export const statusColor: Record<string, string> = {
  idle: color.text.secondary,
  working: color.accent.DEFAULT,
  offline: color.text.muted,
  active: color.status.success,
  paused: color.text.muted,
  pending: color.text.secondary,
  in_progress: color.status.info,
  done: color.status.success,
  blocked: color.status.warning,
  cancelled: color.text.muted,
  failed: color.status.error,
};

/** Map of workflow statuses to background tints. */
export const statusBgColor: Record<string, string> = {
  idle: "rgba(136, 136, 160, 0.10)",
  working: "rgba(99, 102, 241, 0.10)",
  offline: "rgba(85, 85, 106, 0.10)",
  active: color.statusBg.success,
  paused: "rgba(85, 85, 106, 0.10)",
  pending: "rgba(136, 136, 160, 0.10)",
  in_progress: color.statusBg.info,
  done: color.statusBg.success,
  blocked: color.statusBg.warning,
  cancelled: "rgba(85, 85, 106, 0.10)",
  failed: color.statusBg.error,
};

/** Map of priority levels to their token colors. */
export const priorityColor: Record<string, string> = {
  critical: color.status.error,
  high: color.status.warning,
  normal: color.text.primary,
  low: color.text.muted,
};
