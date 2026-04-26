import { forwardRef } from "react";
import styles from "./Stack.module.css";

export type SpaceToken = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "8";
export type StackAlign = "start" | "center" | "end" | "stretch";

export interface StackProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Gap between children, mapped to a `--space-N` token. Default "3". */
  gap?: SpaceToken;
  /** Cross-axis alignment. Default "stretch". */
  align?: StackAlign;
  /** Render as a different element (e.g. `"section"`, `"ul"`, `"li"`). Default `"div"`. */
  as?: keyof React.JSX.IntrinsicElements;
}

export const Stack = forwardRef<HTMLDivElement, StackProps>(function Stack(
  { gap = "3", align = "stretch", as: As = "div", className, children, ...rest },
  ref,
) {
  const cls = [styles.stack, className].filter(Boolean).join(" ");

  return (
    // @ts-expect-error — polymorphic `as` prop; ref type is intentionally widened to HTMLDivElement
    <As ref={ref} className={cls} data-gap={gap} data-align={align} {...rest}>
      {children}
    </As>
  );
});

Stack.displayName = "Stack";
