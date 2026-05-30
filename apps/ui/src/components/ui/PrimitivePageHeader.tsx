import { forwardRef, type HTMLAttributes, type ReactNode } from "react";
import PinCurrentViewButton from "./internal/PinCurrentViewButton";
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
    const defaultPinnedLabel = typeof title === "string" ? title : undefined;
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
        <div className={styles.actions}>
          <PinCurrentViewButton defaultLabel={defaultPinnedLabel} />
          {actions}
        </div>
      </header>
    );
  },
);

PrimitivePageHeader.displayName = "PrimitivePageHeader";
