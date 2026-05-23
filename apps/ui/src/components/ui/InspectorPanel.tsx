import type { ReactNode } from "react";
import styles from "./InspectorPanel.module.css";

export interface InspectorPanelProps {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
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

export function InspectorPanel({
  children,
  className,
  ariaLabel = "Details",
}: InspectorPanelProps) {
  return (
    <aside className={[styles.panel, className].filter(Boolean).join(" ")} aria-label={ariaLabel}>
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

export function InspectorSection({ title, children, className }: InspectorSectionProps) {
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
