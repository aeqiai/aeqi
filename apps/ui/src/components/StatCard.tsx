interface StatCardProps {
  label: string;
  value: string | number;
  trend?: { value: string; positive: boolean };
  icon?: React.ReactNode;
}

export default function StatCard({ label, value, trend, icon }: StatCardProps) {
  return (
    <div className="stat-card">
      <div className="stat-card-header">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      {trend && (
        <div
          className="stat-trend"
          style={{
            color: trend.positive ? "var(--success)" : "var(--error)",
          }}
        >
          {trend.positive ? "\u2191" : "\u2193"} {trend.value}
        </div>
      )}
    </div>
  );
}
