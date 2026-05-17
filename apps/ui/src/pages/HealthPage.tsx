/**
 * `/trust/<addr>/health` — operator-facing day-30 substrate health.
 *
 * Four substrate-compound metrics over the trailing 7d window with a
 * one-sentence interpretation each, plus 30d sparklines below. The
 * page is the operator's "is this thing compounding?" surface — the
 * Overview tab answers "what's happening now," this answers "is the
 * loop turning over."
 *
 * Auth-gated (mounts inside the protected app shell) and dispatched
 * by CompanyPage on `tab === "health"`. Empty state covers the
 * day 1-3 case where there isn't enough signal to read trends.
 *
 * Data flow is client-side aggregation — `useTrustHealthMetrics`
 * subscribes to the daemon store's quests/events/agents, pulls a
 * deeper activity tail + entity-scoped ideas on mount, and returns
 * the four metrics with their trend deltas.
 */
import { useMemo } from "react";
import {
  Banner,
  EmptyState,
  MetricCard,
  MetricGrid,
  Page,
  PageBody,
  PageHeader,
  PageSection,
  Spinner,
} from "@/components/ui";
import { formatInteger } from "@/lib/i18n";
import { useCurrentCompany } from "@/hooks/useCurrentCompany";
import {
  useTrustHealthMetrics,
  DEFAULT_HEALTH_WINDOW_DAYS,
  type HealthMetrics,
} from "@/hooks/useTrustHealthMetrics";
import {
  interpretAgentActions,
  interpretDecisionLog,
  interpretIdeaGrowth,
  interpretQuests,
  trendArrow,
  type TrendDirection,
} from "@/hooks/formatHealthCopy";
import styles from "./HealthPage.module.css";

/** Minimum signal age before we treat trend deltas as meaningful. */
const COMPOUNDING_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

export default function HealthPage({ entityId }: { entityId: string }) {
  const { entity } = useCurrentCompany();
  // Prefer trust_address (canonical /trust/<addr>) when present; fall
  // back to the entity id for entities that haven't registered TRUST yet.
  const addr = entity?.trust_address ?? entityId;
  const { metrics, isLoading, error } = useTrustHealthMetrics(addr);

  // Fresh-TRUST gate: when the earliest known activity is less than a
  // week old, the trend math has no previous-week to compare against.
  // Show the metrics anyway (operator still wants to see the numbers)
  // but lead with an empty-state nudge so they know why the trends are
  // "fresh" / null.
  const isTooEarly = useMemo(() => {
    if (!metrics) return false;
    if (metrics.earliestActivityMs === null) return true;
    return Date.now() - metrics.earliestActivityMs < COMPOUNDING_GRACE_MS;
  }, [metrics]);

  if (isLoading) {
    return (
      <Page>
        <PageHeader title="Health" description="Is this TRUST compounding?" />
        <PageBody>
          <Spinner size="sm" />
        </PageBody>
      </Page>
    );
  }

  if (!metrics) {
    return (
      <Page>
        <PageHeader title="Health" description="Is this TRUST compounding?" />
        <PageBody>
          <EmptyState
            title="No TRUST in scope."
            description="Pick a TRUST from the sidebar to read its health."
          />
        </PageBody>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader title="Health" description="Is this TRUST compounding?" />
      <PageBody>
        {error && (
          <div className={styles.errorBanner}>
            <Banner kind="warning">
              Some signal couldn’t load. Numbers below may understate activity.
            </Banner>
          </div>
        )}

        {isTooEarly && (
          <EmptyState
            eyebrow="Day 1-3"
            title="Too early to see compounding — check back at day 7."
            description="The substrate needs a week of activity before trend deltas become meaningful. Numbers below are the current absolute counts."
          />
        )}

        <PageSection title="This week">
          <MetricGrid columns={4}>
            <MetricCard
              label="Quests closed / wk"
              value={
                <span className={styles.metricValueNumeric}>
                  {formatInteger(metrics.questsClosedPerWeek)}
                </span>
              }
              trend={<TrendBadge delta={metrics.trendDeltas.questsClosed} />}
              detail={
                <InterpretationLine
                  text={interpretQuests(metrics.trendDeltas.questsClosed)}
                  direction={metrics.trendDeltas.questsClosed.direction}
                />
              }
            />
            <MetricCard
              label="Agent actions / wk"
              value={
                <span className={styles.metricValueNumeric}>
                  {formatInteger(metrics.agentActionsPerWeek)}
                </span>
              }
              trend={<TrendBadge delta={metrics.trendDeltas.agentActions} />}
              detail={
                <InterpretationLine
                  text={interpretAgentActions(metrics.trendDeltas.agentActions)}
                  direction={metrics.trendDeltas.agentActions.direction}
                />
              }
            />
            <MetricCard
              label="Idea graph growth"
              value={
                <span className={styles.metricValueNumeric}>
                  {formatInteger(metrics.ideaGraphGrowth)}
                </span>
              }
              trend={<TrendBadge delta={metrics.trendDeltas.ideaGrowth} />}
              detail={
                <InterpretationLine
                  text={interpretIdeaGrowth(metrics.trendDeltas.ideaGrowth)}
                  direction={metrics.trendDeltas.ideaGrowth.direction}
                />
              }
            />
            <MetricCard
              label="Decision log"
              value={
                <span className={styles.metricValueNumeric}>
                  {formatInteger(metrics.decisionLogLength)}
                </span>
              }
              trend={<TrendBadge delta={metrics.trendDeltas.decisionLog} />}
              detail={
                <InterpretationLine
                  text={interpretDecisionLog(metrics.decisionLogLength, metrics.decisionsThisWeek)}
                  direction={metrics.trendDeltas.decisionLog.direction}
                />
              }
            />
          </MetricGrid>
        </PageSection>

        <PageSection
          title={`Trailing ${DEFAULT_HEALTH_WINDOW_DAYS} days`}
          description="Each line is a per-day count. Decision log is cumulative."
        >
          <SparklineGrid metrics={metrics} />
        </PageSection>
      </PageBody>
    </Page>
  );
}

export function TrendBadge({ delta }: { delta: HealthMetrics["trendDeltas"]["questsClosed"] }) {
  const arrow = trendArrow(delta.direction);
  const ratio = delta.ratio;
  // Label for the trend badge: "↑ 2.4×" / "↓ 30%" / "→ flat" / "↗ new"
  let label: string;
  if (delta.direction === "flat") {
    label = "flat";
  } else if (delta.direction === "fresh") {
    label = "new";
  } else if (ratio === null) {
    label = "—";
  } else if (delta.direction === "up") {
    label = ratio >= 10 ? `${Math.round(ratio)}×` : `${ratio.toFixed(1)}×`;
  } else {
    const pct = Math.round((1 - ratio) * 100);
    label = `${pct}%`;
  }
  return (
    <span className={styles.trendLabel} data-direction={delta.direction}>
      <span aria-hidden>{arrow}</span>
      <span>{label}</span>
    </span>
  );
}

export function InterpretationLine({
  text,
  direction,
}: {
  text: string;
  direction: TrendDirection;
}) {
  return (
    <p className={styles.metricInterpretation} data-direction={direction}>
      {text}
    </p>
  );
}

export function SparklineGrid({ metrics }: { metrics: HealthMetrics }) {
  return (
    <div className={styles.sparkGrid} data-columns={4}>
      <SparklineCell label="Quests closed" series={metrics.sparklines.questsClosed} />
      <SparklineCell label="Agent actions" series={metrics.sparklines.agentActions} />
      <SparklineCell label="Idea growth" series={metrics.sparklines.ideaGrowth} />
      <SparklineCell
        label="Decision log (cumulative)"
        series={metrics.sparklines.decisionLog}
        cumulative
      />
    </div>
  );
}

interface SparklineCellProps {
  label: string;
  series: number[];
  /** Cumulative sparklines pin the y-axis to [min(series), max(series)]
   *  so the climbing curve doesn't get crushed when the cumulative
   *  baseline is large relative to the within-window delta. */
  cumulative?: boolean;
}

function SparklineCell({ label, series, cumulative = false }: SparklineCellProps) {
  const max = series.length ? Math.max(...series) : 0;
  const min = cumulative && series.length ? Math.min(...series) : 0;
  // The "all zero" series gets a flat baseline rendered at the bottom of
  // the box. Avoids dividing by zero and lets the empty state stay
  // visually consistent with the other cells.
  const isEmpty = max === min;
  return (
    <div className={styles.sparkCell}>
      <span className={styles.sparkLabel}>{label}</span>
      <Sparkline series={series} min={min} max={max} isEmpty={isEmpty} />
      <div className={styles.sparkRange} aria-hidden>
        <span>−{series.length}d</span>
        <span>
          {cumulative ? `total ${formatInteger(series[series.length - 1] ?? 0)}` : "today"}
        </span>
      </div>
    </div>
  );
}

/**
 * Inline-SVG polyline sparkline. 30 data points, ~140×40 visually but
 * the viewBox is scaled so the cell can flex. Uses `currentColor` so
 * the line picks up the surrounding token color — no hex anywhere.
 */
function Sparkline({
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
  const width = 140;
  const height = 40;
  // 4px breathing room top/bottom so the line never hugs the SVG edge.
  const padding = 4;
  const innerH = height - padding * 2;

  const points = useMemo(() => {
    if (series.length === 0) return "";
    if (isEmpty) {
      // Flat line at the bottom of the box.
      const y = height - padding;
      return series
        .map((_, i) => {
          const x = (i / Math.max(series.length - 1, 1)) * width;
          return `${x.toFixed(2)},${y.toFixed(2)}`;
        })
        .join(" ");
    }
    const range = max - min || 1;
    return series
      .map((v, i) => {
        const x = (i / Math.max(series.length - 1, 1)) * width;
        // Invert: higher value → smaller y (closer to top).
        const y = height - padding - ((v - min) / range) * innerH;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");
  }, [series, min, max, isEmpty, innerH]);

  return (
    <svg
      className={[styles.sparkSvg, isEmpty ? styles.sparkSvgEmpty : ""].filter(Boolean).join(" ")}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Sparkline, last ${series.length} days`}
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
