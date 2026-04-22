/**
 * @aeqi/tokens — TypeScript constants
 *
 * TypeScript mirror of tokens.css. Use when you need token values in JS/TS
 * (charting libs, canvas rendering, inline styles, dynamic theming).
 * For CSS/Tailwind, use `./css` or `./tailwind` exports.
 *
 * Design system: v3 "Neutral Paper + Steel Blue"
 * Single source of truth for values is tokens.css — this file mirrors it.
 */

export const color = {
  // Surface ramp — mirrors tokens.css. Tinted toward the steel accent hue
  // (oklch chroma ~0.005 @ 260°) for subliminal brand cohesion. Canonical
  // names are card / paper / slab / slabElevated. The `bg` block preserves
  // legacy aliases (bg.base → slab, bg.surface → paper, bg.elevated → card).
  card: "#ffffff",
  sectionAlt: "#ffffff",
  paper: "oklch(0.97 0.004 260)",
  slab: "oklch(0.955 0.005 260)",
  slabElevated: "oklch(0.965 0.004 260)",
  slabBorder: "rgba(0, 0, 0, 0.06)",
  slabBorderHover: "rgba(0, 0, 0, 0.1)",
  slabBorderFocus: "rgba(90, 115, 152, 0.45)",

  bg: {
    base: "oklch(0.955 0.005 260)", // alias of slab — was standalone #f1f1ee
    surface: "oklch(0.97 0.004 260)", // alias of paper
    elevated: "#ffffff", // alias of card
    overlay: "#ffffff", // tooltips, floating menus
  },

  // Ink / text — the ink-on-paper scale. Tinted toward the steel hue
  // (chroma 0.015 @ 260°) so near-black carries a whisper of brand.
  // text.* and ink.* are aliases; pick the one that reads naturally.
  text: {
    title: "oklch(0.2 0.015 260 / 0.9)",
    primary: "oklch(0.2 0.015 260 / 0.85)",
    secondary: "oklch(0.2 0.015 260 / 0.45)",
    muted: "oklch(0.2 0.015 260 / 0.25)",
    disabled: "oklch(0.2 0.015 260 / 0.18)",
  },

  ink: {
    base: "oklch(0.2 0.015 260)",
    primary: "oklch(0.2 0.015 260 / 0.9)",
    text: "oklch(0.2 0.015 260 / 0.85)",
    secondary: "oklch(0.2 0.015 260 / 0.45)",
    muted: "oklch(0.2 0.015 260 / 0.25)",
    disabled: "oklch(0.2 0.015 260 / 0.18)",
  },

  // Accent — steel blue. The one brand color. Used sparingly (~5%).
  accent: {
    DEFAULT: "#5a7398",
    hover: "#455d80",
    pressed: "#455d80",
    dim: "#7b92b4",
    bg: "rgba(90, 115, 152, 0.1)",
    glow: "rgba(90, 115, 152, 0.2)",
  },

  border: {
    faint: "rgba(0, 0, 0, 0.04)",
    DEFAULT: "rgba(0, 0, 0, 0.06)",
    hover: "rgba(0, 0, 0, 0.14)",
  },

  // Interaction
  link: "#5a7398",
  linkHover: "#455d80",
  focusRing: "rgba(90, 115, 152, 0.4)",
  selection: "rgba(90, 115, 152, 0.16)",
  textOnAccent: "#ffffff",

  divider: "rgba(0, 0, 0, 0.04)",
  hover: "rgba(0, 0, 0, 0.03)",
  disabledSurface: "rgba(0, 0, 0, 0.025)",

  // Status — semantic. Jade success, oxide error, muted amber warn, steel info.
  status: {
    success: "#2e8f71",
    error: "#b85c5c",
    warning: "#b98a47",
    info: "#5a7398",
  },

  statusBg: {
    success: "rgba(46, 143, 113, 0.1)",
    error: "rgba(184, 92, 92, 0.1)",
    warning: "rgba(185, 138, 71, 0.1)",
    info: "rgba(90, 115, 152, 0.1)",
  },

  scrim: "rgba(0, 0, 0, 0.35)",

  glass: {
    bg: "rgba(255, 255, 255, 0.82)",
    border: "rgba(0, 0, 0, 0.08)",
  },

  // Brand — domain-specific tokens (tuned for light surfaces)
  brand: {
    venture: "#6468d8",
    fund: "#5b6c88",
    entity: "#6b7884",
    foundation: "#5e6864",
  },

  funding: {
    angel: "#2e8f71",
    seed: "#6468d8",
    bridge: "#5b6c88",
    series: "#6b7884",
    exit: "#3a4743",
  },

  role: {
    partner: "#2e8f71",
    advisor: "#3fae8c",
    holder: "#3a4743",
    director: "#6468d8",
    executive: "#5b6c88",
    dealflow: "#5a7398",
  },

  // Supporting neutrals
  stone: "#e8e1cf",
  highlight: "#2e3331",
} as const;

export const font = {
  family: {
    sans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: '"JetBrains Mono", "SF Mono", "Fira Code", monospace',
    display: '"Cinzel", Georgia, serif',
    brand: '"Zen Dots", system-ui, sans-serif',
  },

  size: {
    "3xs": "0.5625rem", //  9px
    "2xs": "0.625rem", // 10px
    xs: "0.75rem", // 12px
    sm: "0.8125rem", // 13px
    base: "0.875rem", // 14px
    lg: "1rem", // 16px
    xl: "1.25rem", // 20px
    "2xl": "1.5rem", // 24px
    "3xl": "1.875rem", // 30px
    "4xl": "2.25rem", // 36px
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
  1: "0.25rem", //  4px
  2: "0.5rem", //  8px
  3: "0.75rem", // 12px
  4: "1rem", // 16px
  5: "1.25rem", // 20px
  6: "1.5rem", // 24px
  8: "2rem", // 32px
  10: "2.5rem", // 40px
  12: "3rem", // 48px
  16: "4rem", // 64px
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
  sm: "0 1px 2px rgba(0, 0, 0, 0.04)",
  md: "0 4px 12px rgba(0, 0, 0, 0.06)",
  lg: "0 8px 24px rgba(0, 0, 0, 0.08)",
  xl: "0 20px 25px -5px rgba(0, 0, 0, 0.08), 0 8px 10px -6px rgba(0, 0, 0, 0.06)",
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

export const elevation = {
  0: "transparent",
  1: "rgba(0, 0, 0, 0.02)",
  2: "rgba(0, 0, 0, 0.04)",
  3: "rgba(0, 0, 0, 0.06)",
} as const;

export const texture = {
  grain: {
    opacity: 0.03,
    frequency: 0.9,
  },
  glass: {
    blur: "24px",
    bg: "rgba(255, 255, 255, 0.82)",
    border: "rgba(0, 0, 0, 0.08)",
  },
} as const;

export const interaction = {
  hover: {
    lift: "-1px",
    bg: "rgba(0, 0, 0, 0.03)",
  },
  focusRing:
    "0 0 0 2px oklch(0.97 0.004 260), 0 0 0 4px rgba(90, 115, 152, 0.2)",
  activeScale: 0.98,
} as const;

export const prose = {
  width: "48rem",
  contentWidth: "56rem",
  lineHeight: 1.75,
} as const;

/** Append hex opacity suffix to a hex color. */
export function withOpacity(
  hex: string,
  percent: 5 | 10 | 20 | 30 | 50 | 80,
): string {
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
  idle: "rgba(0, 0, 0, 0.03)",
  working: color.accent.bg,
  offline: "rgba(0, 0, 0, 0.03)",
  active: color.statusBg.success,
  paused: "rgba(0, 0, 0, 0.03)",
  pending: "rgba(0, 0, 0, 0.03)",
  in_progress: color.statusBg.info,
  done: color.statusBg.success,
  blocked: color.statusBg.warning,
  cancelled: "rgba(0, 0, 0, 0.03)",
  failed: color.statusBg.error,
};

/** Map of priority levels to their token colors. */
export const priorityColor: Record<string, string> = {
  critical: color.status.error,
  high: color.status.warning,
  normal: color.text.primary,
  low: color.text.muted,
};
