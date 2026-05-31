import { useMemo } from "react";
import { useCompanyHealthMetrics } from "@/hooks/useCompanyHealthMetrics";
import { formatInteger } from "@/lib/i18n";

interface CompanyActivityCardProps {
  companyAddress: string | null | undefined;
}

const SERIES_CONFIG = [
  { key: "questsClosed" as const, label: "Quests closed", cumulative: false },
  { key: "agentActions" as const, label: "Agent actions", cumulative: false },
  { key: "ideaGrowth" as const, label: "Ideas filed", cumulative: false },
  { key: "decisionLog" as const, label: "Decisions logged", cumulative: true },
];

/**
 * Full-width "Activity" card on the company overview. Four inline
 * sparklines sourced from the same `useCompanyHealthMetrics` rollup the
 * Health page consumes — quests closed, agent actions, ideas filed,
 * cumulative decision log. The card is the one that has to *feel*
 * powerful at a glance: line chart per primitive, big tabular-num
 * trailing value, label above. No empty-state lecture — flat lines
 * are fine while a fresh COMPANY gathers signal.
 */
export default function CompanyActivityCard({ companyAddress }: CompanyActivityCardProps) {
  const { metrics } = useCompanyHealthMetrics(companyAddress);

  return (
    <section
      className="company-cockpit-card company-cockpit-card--wide"
      aria-labelledby="company-activity-heading"
    >
      <header className="company-cockpit-card-header">
        <h2 id="company-activity-heading" className="company-cockpit-card-title">
          Activity
        </h2>
        <span className="company-cockpit-card-sub">Last 30 days</span>
      </header>
      <div className="company-activity-grid">
        {SERIES_CONFIG.map((cfg) => (
          <ActivityCell
            key={cfg.key}
            label={cfg.label}
            series={metrics?.sparklines[cfg.key] ?? []}
            cumulative={cfg.cumulative}
          />
        ))}
      </div>
    </section>
  );
}

function ActivityCell({
  label,
  series,
  cumulative,
}: {
  label: string;
  series: number[];
  cumulative: boolean;
}) {
  const max = series.length ? Math.max(...series) : 0;
  const min = cumulative && series.length ? Math.min(...series) : 0;
  const isEmpty = max === min;
  const trailing = series[series.length - 1] ?? 0;
  const total = useMemo(() => series.reduce((a, b) => a + b, 0), [series]);
  const headline = cumulative ? trailing : total;

  return (
    <div className="company-activity-cell">
      <span className="company-activity-cell-label">{label}</span>
      <span className="company-activity-cell-value">{formatInteger(headline)}</span>
      <ActivityLine series={series} min={min} max={max} isEmpty={isEmpty} />
    </div>
  );
}

function ActivityLine({
  series,
  min,
  max,
  isEmpty,
}: {
  series: number[];
  min: number;
  max: number;
  isEmpty: boolean;
}) {
  const width = 220;
  const height = 56;
  const padding = 6;
  const innerH = height - padding * 2;

  const { line, area } = useMemo(() => {
    if (series.length === 0) {
      return { line: "", area: "" };
    }
    const flatY = height - padding;
    const range = max - min || 1;
    const pts = series.map((v, i) => {
      const x = (i / Math.max(series.length - 1, 1)) * width;
      const y = isEmpty ? flatY : height - padding - ((v - min) / range) * innerH;
      return [x, y] as const;
    });
    const linePath = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
    const areaPath = `M ${pts[0][0].toFixed(2)},${height} L ${pts
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(" L ")} L ${pts[pts.length - 1][0].toFixed(2)},${height} Z`;
    return { line: linePath, area: areaPath };
  }, [series, min, max, isEmpty, innerH]);

  return (
    <svg
      className={`company-activity-svg${isEmpty ? " company-activity-svg--empty" : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Sparkline, last ${series.length} days`}
    >
      {!isEmpty && <path d={area} className="company-activity-area" />}
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
