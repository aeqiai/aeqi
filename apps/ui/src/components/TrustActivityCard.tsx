import { useMemo } from "react";
import { useTrustHealthMetrics } from "@/hooks/useTrustHealthMetrics";

interface TrustActivityCardProps {
  trustAddress: string | null | undefined;
}

const SERIES_CONFIG = [
  { key: "questsClosed" as const, label: "Quests closed", cumulative: false },
  { key: "agentActions" as const, label: "Agent actions", cumulative: false },
  { key: "ideaGrowth" as const, label: "Ideas filed", cumulative: false },
  { key: "decisionLog" as const, label: "Decisions logged", cumulative: true },
];

/**
 * Full-width "Activity" card on the trust overview. Four inline
 * sparklines sourced from the same `useTrustHealthMetrics` rollup the
 * Health page consumes — quests closed, agent actions, ideas filed,
 * cumulative decision log. The card is the one that has to *feel*
 * powerful at a glance: line chart per primitive, big tabular-num
 * trailing value, label above. No empty-state lecture — flat lines
 * are fine while a fresh TRUST gathers signal.
 */
export default function TrustActivityCard({ trustAddress }: TrustActivityCardProps) {
  const { metrics } = useTrustHealthMetrics(trustAddress);

  return (
    <section
      className="trust-cockpit-card trust-cockpit-card--wide"
      aria-labelledby="trust-activity-heading"
    >
      <header className="trust-cockpit-card-header">
        <h2 id="trust-activity-heading" className="trust-cockpit-card-title">
          Activity
        </h2>
        <span className="trust-cockpit-card-sub">Last 30 days</span>
      </header>
      <div className="trust-activity-grid">
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
    <div className="trust-activity-cell">
      <span className="trust-activity-cell-label">{label}</span>
      <span className="trust-activity-cell-value">{formatInteger(headline)}</span>
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
      className={`trust-activity-svg${isEmpty ? " trust-activity-svg--empty" : ""}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Sparkline, last ${series.length} days`}
    >
      {!isEmpty && <path d={area} className="trust-activity-area" />}
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

function formatInteger(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);
}
