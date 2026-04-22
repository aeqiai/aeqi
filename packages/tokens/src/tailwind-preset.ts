/**
 * @aeqi/tokens — Tailwind CSS 4 preset
 *
 * Usage in any Tailwind project:
 *
 *   // tailwind.config.ts
 *   import aeqi from "@aeqi/tokens/tailwind";
 *   export default { presets: [aeqi], content: [...] };
 *
 * This gives you classes like:
 *   bg-surface, text-muted, border-default,
 *   text-success, bg-venture, rounded-md, shadow-md, etc.
 */

import type { Config } from "tailwindcss";
import { color, font, space, radius, shadow, zIndex } from "./tokens.js";

const preset: Config = {
  content: [],
  theme: {
    extend: {
      colors: {
        /* ── Backgrounds ─────────────────────────── */
        base: color.bg.base,
        surface: color.bg.surface,
        elevated: color.bg.elevated,
        overlay: color.bg.overlay,

        /* ── Text (usable as text-primary, etc.) ── */
        "text-primary": color.text.primary,
        "text-secondary": color.text.secondary,
        "text-muted": color.text.muted,

        /* ── Accent ───────────────────────────────── */
        accent: {
          DEFAULT: color.accent.DEFAULT,
          dim: color.accent.dim,
          bg: color.accent.bg,
        },

        /* ── Borders ──────────────────────────────── */
        border: {
          DEFAULT: color.border.DEFAULT,
          hover: color.border.hover,
        },

        /* ── Status ───────────────────────────────── */
        success: {
          DEFAULT: color.status.success,
          bg: color.statusBg.success,
        },
        error: {
          DEFAULT: color.status.error,
          bg: color.statusBg.error,
        },
        warning: {
          DEFAULT: color.status.warning,
          bg: color.statusBg.warning,
        },
        info: {
          DEFAULT: color.status.info,
          bg: color.statusBg.info,
        },

        /* ── Glass ────────────────────────────────── */
        glass: {
          bg: color.glass.bg,
          border: color.glass.border,
        },

        /* ── Brand ────────────────────────────────── */
        venture: color.brand.venture,
        fund: color.brand.fund,
        entity: color.brand.entity,
        foundation: color.brand.foundation,

        /* ── Funding stages ───────────────────────── */
        "funding-angel": color.funding.angel,
        "funding-seed": color.funding.seed,
        "funding-bridge": color.funding.bridge,
        "funding-series": color.funding.series,
        "funding-exit": color.funding.exit,

        /* ── Roles ────────────────────────────────── */
        "role-partner": color.role.partner,
        "role-advisor": color.role.advisor,
        "role-holder": color.role.holder,
        "role-director": color.role.director,
        "role-executive": color.role.executive,
        "role-dealflow": color.role.dealflow,
      },

      fontFamily: {
        sans: [font.family.sans],
        mono: [font.family.mono],
        serif: [font.family.serif],
      },

      fontSize: { ...font.size },

      spacing: {
        "0": space[0],
        "1": space[1],
        "2": space[2],
        "3": space[3],
        "4": space[4],
        "5": space[5],
        "6": space[6],
        "8": space[8],
        "10": space[10],
        "12": space[12],
        "16": space[16],
      },

      borderRadius: {
        xs: radius.xs,
        sm: radius.sm,
        md: radius.md,
        lg: radius.lg,
        xl: radius.xl,
        full: radius.full,
      },

      boxShadow: {
        sm: shadow.sm,
        md: shadow.md,
        lg: shadow.lg,
        xl: shadow.xl,
      },

      zIndex: Object.fromEntries(
        Object.entries(zIndex).map(([k, v]) => [k, String(v)]),
      ),

      transitionDuration: {
        fast: "150ms",
        normal: "200ms",
        slow: "500ms",
      },

      transitionTimingFunction: {
        smooth: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
};

export default preset;
