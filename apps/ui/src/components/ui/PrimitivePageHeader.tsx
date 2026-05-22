import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import styles from "./PrimitivePageHeader.module.css";

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

export interface PrimitivePageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  actions?: ReactNode;
  padding?: "standard" | "none";
}

export const PrimitivePageHeader = forwardRef<HTMLElement, PrimitivePageHeaderProps>(
  function PrimitivePageHeader(
    { title, actions, padding = "standard", className, children, ...rest },
    ref,
  ) {
    return (
      <header ref={ref} className={cx(styles.header, className)} data-padding={padding} {...rest}>
        <h1 className={styles.title}>{title}</h1>
        {children}
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
    );
  },
);

PrimitivePageHeader.displayName = "PrimitivePageHeader";
