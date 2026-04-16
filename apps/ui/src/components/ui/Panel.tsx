import styles from "./Panel.module.css";

export interface PanelProps {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  variant?: "default" | "detail";
  className?: string;
}

export function Panel({ title, actions, children, variant = "default", className }: PanelProps) {
  const panelCls = [variant === "detail" ? styles.detail : styles.panel, className]
    .filter(Boolean)
    .join(" ");
  const titleCls = variant === "detail" ? styles.detailTitle : styles.title;

  return (
    <div className={panelCls}>
      {(title || actions) && (
        <div className={styles.header}>
          {title && <span className={titleCls}>{title}</span>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

Panel.displayName = "Panel";
