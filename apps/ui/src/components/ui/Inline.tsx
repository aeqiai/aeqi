import { forwardRef } from "react";
import styles from "./Inline.module.css";

export type { SpaceToken } from "./Stack";
import type { SpaceToken } from "./Stack";

export type InlineAlign = "start" | "center" | "end" | "baseline" | "stretch";
export type InlineJustify = "start" | "center" | "end" | "between" | "around";

export interface InlineProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap between children, mapped to a `--space-N` token. Default "3". */
  gap?: SpaceToken;
  /** Cross-axis alignment. Default "center" (most common for horizontal rows). */
  align?: InlineAlign;
  /** Main-axis distribution. Default "start". */
  justify?: InlineJustify;
  /** Allow wrap. Default false. */
  wrap?: boolean;
  /** Render as a different element. Default `"div"`. */
  as?: keyof React.JSX.IntrinsicElements;
}

export const Inline = forwardRef<HTMLDivElement, InlineProps>(function Inline(
  {
    gap = "3",
    align = "center",
    justify = "start",
    wrap = false,
    as: As = "div",
    className,
    children,
    ...rest
  },
  ref,
) {
  const cls = [styles.inline, className].filter(Boolean).join(" ");

  return (
    // @ts-expect-error — polymorphic `as` prop; ref type is intentionally widened to HTMLDivElement
    <As
      ref={ref}
      className={cls}
      data-gap={gap}
      data-align={align}
      data-justify={justify}
      data-wrap={wrap ? "true" : undefined}
      {...rest}
    >
      {children}
    </As>
  );
});

Inline.displayName = "Inline";
