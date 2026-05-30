import { forwardRef, type ReactNode } from "react";
import PinCurrentViewButton from "./internal/PinCurrentViewButton";
import type { SpaceToken } from "./Stack";
import styles from "./Page.module.css";

export type PageWidth = "default" | "wide" | "full";
export type PagePadding = "none" | "md" | "lg";

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(" ");
}

export interface PageProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Content measure. Default keeps internal pages readable; full fills the parent. */
  width?: PageWidth;
  /** Outer padding around the page content. */
  padding?: PagePadding;
  /** Vertical rhythm between direct children. */
  gap?: SpaceToken;
}

export const Page = forwardRef<HTMLDivElement, PageProps>(function Page(
  { width = "default", padding = "md", gap = "6", className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx(styles.page, className)}
      data-width={width}
      data-padding={padding}
      data-gap={gap}
      {...rest}
    >
      {children}
    </div>
  );
});

Page.displayName = "Page";

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}

export const PageHeader = forwardRef<HTMLElement, PageHeaderProps>(function PageHeader(
  { title, description, meta, actions, className, children, ...rest },
  ref,
) {
  const defaultPinnedLabel = typeof title === "string" ? title : undefined;
  return (
    <header ref={ref} className={cx(styles.header, className)} {...rest}>
      <div className={styles.headerContent}>
        {meta && <div className={styles.headerMeta}>{meta}</div>}
        <h1 className={styles.title}>{title}</h1>
        {description && <p className={styles.description}>{description}</p>}
        {children}
      </div>
      <div className={styles.headerActions}>
        <PinCurrentViewButton defaultLabel={defaultPinnedLabel} />
        {actions}
      </div>
    </header>
  );
});

PageHeader.displayName = "PageHeader";

export interface PageBodyProps extends React.HTMLAttributes<HTMLDivElement> {
  gap?: SpaceToken;
}

export const PageBody = forwardRef<HTMLDivElement, PageBodyProps>(function PageBody(
  { gap = "6", className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cx(styles.body, className)} data-gap={gap} {...rest}>
      {children}
    </div>
  );
});

PageBody.displayName = "PageBody";

export interface PageSectionProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  gap?: SpaceToken;
}

export const PageSection = forwardRef<HTMLElement, PageSectionProps>(function PageSection(
  { title, description, actions, gap = "4", className, children, ...rest },
  ref,
) {
  const hasHeader = title || description || actions;

  return (
    <section ref={ref} className={cx(styles.section, className)} data-gap={gap} {...rest}>
      {hasHeader && (
        <header className={styles.sectionHeader}>
          <div className={styles.sectionHeading}>
            {title && <h2 className={styles.sectionTitle}>{title}</h2>}
            {description && <p className={styles.sectionDescription}>{description}</p>}
          </div>
          {actions && <div className={styles.sectionActions}>{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
});

PageSection.displayName = "PageSection";

export interface PageToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  actions?: ReactNode;
  /** Grow the leading chrome control, usually a search input, to consume available space. */
  grow?: boolean;
}

export const PageToolbar = forwardRef<HTMLDivElement, PageToolbarProps>(function PageToolbar(
  { actions, grow = false, className, children, "aria-label": ariaLabel = "Page toolbar", ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cx(styles.toolbar, className)}
      data-grow={grow ? "true" : undefined}
      role="toolbar"
      aria-label={ariaLabel}
      {...rest}
    >
      <div className={styles.toolbarChrome}>{children}</div>
      {actions && <div className={styles.toolbarActions}>{actions}</div>}
    </div>
  );
});

PageToolbar.displayName = "PageToolbar";

export interface MetricGridProps extends React.HTMLAttributes<HTMLDivElement> {
  columns?: 2 | 3 | 4;
}

export const MetricGrid = forwardRef<HTMLDivElement, MetricGridProps>(function MetricGrid(
  { columns, className, children, ...rest },
  ref,
) {
  return (
    <div ref={ref} className={cx(styles.metricGrid, className)} data-columns={columns} {...rest}>
      {children}
    </div>
  );
});

MetricGrid.displayName = "MetricGrid";

export interface MetricCardProps extends React.HTMLAttributes<HTMLElement> {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  trend?: ReactNode;
}

export const MetricCard = forwardRef<HTMLElement, MetricCardProps>(function MetricCard(
  { label, value, detail, trend, className, children, ...rest },
  ref,
) {
  return (
    <article ref={ref} className={cx(styles.metricCard, className)} {...rest}>
      <div className={styles.metricHeader}>
        <span className={styles.metricLabel}>{label}</span>
        {trend && <span className={styles.metricTrend}>{trend}</span>}
      </div>
      <div className={styles.metricValue}>{value}</div>
      {detail && <div className={styles.metricDetail}>{detail}</div>}
      {children}
    </article>
  );
});

MetricCard.displayName = "MetricCard";
