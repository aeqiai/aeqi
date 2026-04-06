interface PanelProps {
  title?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  variant?: "default" | "detail";
  className?: string;
}

export default function Panel({
  title,
  actions,
  children,
  variant = "default",
  className,
}: PanelProps) {
  const base = variant === "detail" ? "detail-panel" : "dash-panel";
  const titleClass = variant === "detail" ? "detail-panel-title" : "dash-panel-title";

  return (
    <div className={`${base}${className ? ` ${className}` : ""}`}>
      {(title || actions) && (
        <div className="dash-panel-header">
          {title && <span className={titleClass}>{title}</span>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
