import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import styles from "./InspectorPanel.module.css";

export interface InspectorPanelProps {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  surface?: "raised" | "embedded";
}

export interface InspectorHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  media?: ReactNode;
  actions?: ReactNode;
}

export interface InspectorSectionProps {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export interface InspectorFieldProps {
  label: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}

export interface InspectorChipsProps {
  children: ReactNode;
  className?: string;
}

export interface InspectorRowProps {
  label: ReactNode;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
  tone?: "raised" | "recessed" | "plain";
  onClick?: () => void;
}

export interface InspectorPillGroupProps {
  children: ReactNode;
  className?: string;
}

type InspectorPillBaseProps = {
  children: ReactNode;
  className?: string;
  tone?: "metadata" | "add" | "raised" | "recessed";
};

export type InspectorPillProps =
  | (InspectorPillBaseProps &
      HTMLAttributes<HTMLSpanElement> & {
        as?: "span";
      })
  | (InspectorPillBaseProps &
      ButtonHTMLAttributes<HTMLButtonElement> & {
        as: "button";
      });

export function InspectorPanel({
  children,
  className,
  ariaLabel = "Details",
  surface = "raised",
}: InspectorPanelProps) {
  return (
    <aside
      className={[styles.panel, className].filter(Boolean).join(" ")}
      data-surface={surface}
      aria-label={ariaLabel}
    >
      {children}
    </aside>
  );
}

export function InspectorHeader({
  eyebrow,
  title,
  subtitle,
  media,
  actions,
}: InspectorHeaderProps) {
  return (
    <header className={styles.header}>
      {media ? <span className={styles.media}>{media}</span> : null}
      <span className={styles.headerCopy}>
        {eyebrow ? <span className={styles.eyebrow}>{eyebrow}</span> : null}
        <h2>{title}</h2>
        {subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </span>
      {actions ? <span className={styles.actions}>{actions}</span> : null}
    </header>
  );
}

export function InspectorSection({
  title,
  children,
  className,
  collapsible = false,
  defaultOpen = true,
}: InspectorSectionProps) {
  if (collapsible) {
    return (
      <details
        className={[styles.section, styles.sectionCollapsible, className].filter(Boolean).join(" ")}
        open={defaultOpen}
      >
        {title ? <summary>{title}</summary> : null}
        <div className={styles.sectionBody}>{children}</div>
      </details>
    );
  }

  return (
    <section className={[styles.section, className].filter(Boolean).join(" ")}>
      {title ? <h3>{title}</h3> : null}
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}

export function InspectorField({ label, children, action, className }: InspectorFieldProps) {
  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.fieldValue}>{children}</span>
      {action ? <span className={styles.fieldAction}>{action}</span> : null}
    </div>
  );
}

export function InspectorChips({ children, className }: InspectorChipsProps) {
  return <div className={[styles.chips, className].filter(Boolean).join(" ")}>{children}</div>;
}

export function InspectorRow({
  label,
  children,
  action,
  className,
  tone = "raised",
  onClick,
}: InspectorRowProps) {
  const content = (
    <>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue}>{children}</span>
      {action ? <span className={styles.rowAction}>{action}</span> : null}
    </>
  );
  const classNames = [styles.row, className].filter(Boolean).join(" ");
  if (onClick) {
    return (
      <button type="button" className={classNames} data-tone={tone} onClick={onClick}>
        {content}
      </button>
    );
  }
  return (
    <div className={classNames} data-tone={tone}>
      {content}
    </div>
  );
}

export function InspectorPillGroup({ children, className }: InspectorPillGroupProps) {
  return <div className={[styles.pillGroup, className].filter(Boolean).join(" ")}>{children}</div>;
}

export function InspectorPill(props: InspectorPillProps) {
  const { as = "span", children, className, tone = "metadata", ...rest } = props;
  const classNames = [styles.pill, className].filter(Boolean).join(" ");
  if (as === "button") {
    const buttonProps = rest as ButtonHTMLAttributes<HTMLButtonElement>;
    return (
      <button
        {...buttonProps}
        type={buttonProps.type ?? "button"}
        className={classNames}
        data-tone={tone}
      >
        {children}
      </button>
    );
  }
  const spanProps = rest as HTMLAttributes<HTMLSpanElement>;
  return (
    <span {...spanProps} className={classNames} data-tone={tone}>
      {children}
    </span>
  );
}
