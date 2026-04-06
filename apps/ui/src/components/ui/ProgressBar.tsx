interface ProgressBarProps {
  value: number;
  max?: number;
  label?: string;
}

export default function ProgressBar({ value, max = 100, label }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;

  return (
    <>
      <div className="progress-bar-bg">
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      {label && <span className="progress-text">{label}</span>}
    </>
  );
}
