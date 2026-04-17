import { forwardRef } from "react";
import styles from "./Card.module.css";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Background: default (bg-base), surface (bg-surface nested), flat (transparent). */
  variant?: "default" | "surface" | "flat";
  /** Padding step. Use "none" when composing with CardHeader/Body/Footer. */
  padding?: "none" | "sm" | "md" | "lg";
  /** Hover/focus lift for clickable cards. Does NOT make the card a button —
   *  if you need keyboard/click semantics, wrap in <button> or use IconButton. */
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "default", padding = "md", interactive = false, className, children, ...rest },
  ref,
) {
  const padClass =
    padding === "none"
      ? styles.padNone
      : padding === "sm"
        ? styles.padSm
        : padding === "lg"
          ? styles.padLg
          : styles.padMd;

  const cls = [
    styles.card,
    styles[variant],
    padClass,
    interactive ? styles.interactive : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div ref={ref} className={cls} {...rest}>
      {children}
    </div>
  );
});

Card.displayName = "Card";

export function CardHeader({
  title,
  actions,
  className,
  children,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={[styles.header, className].filter(Boolean).join(" ")}>
      {title && <span className={styles.title}>{title}</span>}
      {children}
      {actions}
    </div>
  );
}

export function CardFooter({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={[styles.footer, className].filter(Boolean).join(" ")}>{children}</div>;
}
