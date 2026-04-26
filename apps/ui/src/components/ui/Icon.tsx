import { forwardRef } from "react";
import type { LucideIcon } from "lucide-react";
import styles from "./Icon.module.css";

export type { LucideIcon as IconComponent };

export interface IconProps extends Omit<React.SVGAttributes<SVGSVGElement>, "ref"> {
  /** Lucide icon component (import explicitly: `import { Plus } from "lucide-react"`). */
  icon: LucideIcon;
  /** Size scale — pinned to ink-rhythm, not arbitrary px. */
  size?: "xs" | "sm" | "md" | "lg";
  /** Decorative icons should be aria-hidden. Default true. */
  decorative?: boolean;
  /** When `decorative=false`, supply a label for screen readers. */
  label?: string;
}

const SIZE_MAP: Record<NonNullable<IconProps["size"]>, number> = {
  xs: 12,
  sm: 14,
  md: 16,
  lg: 20,
};

export const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
  {
    icon: IconComponent,
    size = "md",
    decorative = true,
    label,
    className,
    strokeWidth = 1.5,
    color = "currentColor",
    ...rest
  },
  ref,
) {
  const px = SIZE_MAP[size];
  const cls = [styles.icon, className].filter(Boolean).join(" ");

  if (import.meta.env.DEV && !decorative && !label) {
    console.warn(
      "[Icon] When `decorative` is false, a `label` prop is required for screen readers. " +
        "Either provide `label` or set `decorative={true}`.",
    );
  }

  const a11yProps = decorative
    ? { "aria-hidden": true as const }
    : { role: "img" as const, "aria-label": label };

  return (
    <IconComponent
      ref={ref}
      width={px}
      height={px}
      strokeWidth={strokeWidth}
      color={color}
      className={cls}
      {...a11yProps}
      {...rest}
    />
  );
});

Icon.displayName = "Icon";
