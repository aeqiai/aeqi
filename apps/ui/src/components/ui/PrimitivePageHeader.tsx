import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import styles from "./PrimitivePageHeader.module.css";

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

export interface PrimitivePageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  actions?: ReactNode;
  padding?: "standard" | "none";
  titleVariant?: "chip" | "plain";
}

export const PrimitivePageHeader = forwardRef<HTMLElement, PrimitivePageHeaderProps>(
  function PrimitivePageHeader(
    { title, actions, padding = "standard", titleVariant = "plain", className, children, ...rest },
    ref,
  ) {
    const hasChrome = Boolean(children);
    return (
      <header
        ref={ref}
        className={cx(styles.header, className)}
        data-padding={padding}
        data-has-chrome={hasChrome ? "true" : undefined}
        data-title-variant={titleVariant}
        {...rest}
      >
        <h1 className={styles.title}>{title}</h1>
        {children && <div className={styles.chrome}>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </header>
    );
  },
);

PrimitivePageHeader.displayName = "PrimitivePageHeader";
