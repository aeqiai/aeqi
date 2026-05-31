/**
 * Pure formatters for the day-30 health dashboard interpretation copy.
 *
 * Every metric on `/company/<addr>/health` renders a single sentence that
 * tells the operator whether the substrate is compounding. These functions
 * take the trailing-7d count + the previous-7d count and return that
 * sentence — pure inputs → pure string output so the hook layer never
 * has to worry about phrasing and so the language stays consistent across
 * every metric.
 *
 * The trend delta is the ratio `current / previous`, computed in the
 * hook. When `previous` is 0 we report the absolute count instead
 * (a 7d→7d ratio of "Infinity" reads like a bug, not a signal).
 */

export type TrendDirection = "up" | "down" | "flat" | "fresh";

export interface TrendDelta {
  /** Count over the trailing 7d window. */
  current: number;
  /** Count over the 7d window before the current one. */
  previous: number;
  /** `current / previous` when `previous > 0`; `null` otherwise. */
  ratio: number | null;
  direction: TrendDirection;
}

/**
 * Build a TrendDelta from two counts. The ratio is `null` when the
 * previous window had no activity; direction collapses to "fresh" in
 * that case so the copy can lean on the absolute number instead of
 * narrating a ratio that isn't meaningful.
 */
export function buildTrendDelta(current: number, previous: number): TrendDelta {
  if (previous === 0 && current === 0) {
    return { current, previous, ratio: null, direction: "flat" };
  }
  if (previous === 0) {
    return { current, previous, ratio: null, direction: "fresh" };
  }
  const ratio = current / previous;
  // Within ±10% reads as flat — the noise floor for a 7d window with
  // small absolute counts. Outside that band the substrate is moving.
  if (ratio >= 0.9 && ratio <= 1.1) {
    return { current, previous, ratio, direction: "flat" };
  }
  return {
    current,
    previous,
    ratio,
    direction: ratio > 1 ? "up" : "down",
  };
}

/** ASCII arrow for the trend slot in MetricCard. Stays text-only so it
 *  composes inside the muted .metricTrend slot without inventing icons. */
export function trendArrow(direction: TrendDirection): string {
  if (direction === "up") return "↑";
  if (direction === "down") return "↓";
  return "→";
}

/** Format a ratio as "2.4×" — the most-scannable form for week-on-week
 *  velocity copy. Returns `null` when no ratio is available. */
function formatRatio(ratio: number | null): string | null {
  if (ratio === null) return null;
  if (ratio >= 10) return `${Math.round(ratio)}×`;
  return `${ratio.toFixed(1)}×`;
}

/** Format a delta-percent like "30%" for "dropped 30%". */
function formatDropPercent(ratio: number): string {
  const pct = Math.round((1 - ratio) * 100);
  return `${pct}%`;
}

export function interpretQuests(delta: TrendDelta): string {
  if (delta.current === 0 && delta.previous === 0) {
    return "No quests closed yet — get one in flight to start the loop.";
  }
  if (delta.direction === "fresh") {
    const noun = delta.current === 1 ? "quest" : "quests";
    return `${delta.current} ${noun} closed this week — first signal of throughput.`;
  }
  if (delta.direction === "up") {
    const ratio = formatRatio(delta.ratio);
    return `Quests are closing ${ratio} faster this week than last.`;
  }
  if (delta.direction === "down") {
    return `Quest closes dropped ${formatDropPercent(delta.ratio ?? 1)} — something stuck?`;
  }
  return "Quest closes are flat week-over-week.";
}

export function interpretAgentActions(delta: TrendDelta): string {
  if (delta.current === 0 && delta.previous === 0) {
    return "No agent activity this week — the runtime is asleep.";
  }
  if (delta.direction === "fresh") {
    const noun = delta.current === 1 ? "action" : "actions";
    return `${delta.current} agent ${noun} this week — agents are awake.`;
  }
  if (delta.direction === "up") {
    const ratio = formatRatio(delta.ratio);
    return `Agents are ${ratio} more active this week than last.`;
  }
  if (delta.direction === "down") {
    return `Agent activity dropped ${formatDropPercent(delta.ratio ?? 1)} — check if the loop stalled.`;
  }
  return "Agent activity is steady week-over-week.";
}

export function interpretIdeaGrowth(delta: TrendDelta): string {
  if (delta.current === 0 && delta.previous === 0) {
    return "The idea graph is empty — capture the first decision.";
  }
  if (delta.direction === "fresh") {
    const noun = delta.current === 1 ? "idea" : "ideas";
    return `${delta.current} new ${noun} this week — the graph is forming.`;
  }
  if (delta.direction === "up") {
    const ratio = formatRatio(delta.ratio);
    return `Idea graph is growing ${ratio} faster this week than last.`;
  }
  if (delta.direction === "down") {
    return `Idea growth slowed ${formatDropPercent(delta.ratio ?? 1)} — fewer durable lessons captured.`;
  }
  return "Idea graph growth is steady week-over-week.";
}

/**
 * Decision-log length is a cumulative total, not a rate — the trend
 * compares the absolute log size to the size 7d ago. "How much heavier
 * has the record gotten?" is the right question, not "are decisions
 * accelerating?" — that's what the quests metric is for.
 */
export function interpretDecisionLog(totalSinceGenesis: number, decisionsThisWeek: number): string {
  if (totalSinceGenesis === 0) {
    return "No decisions logged yet — the record starts with your first.";
  }
  if (decisionsThisWeek === 0) {
    const noun = totalSinceGenesis === 1 ? "decision" : "decisions";
    return `${totalSinceGenesis} ${noun} on record — nothing added this week.`;
  }
  const totalNoun = totalSinceGenesis === 1 ? "decision" : "decisions";
  return `${totalSinceGenesis} ${totalNoun} on record · +${decisionsThisWeek} this week.`;
}
