/**
 * `useTrustHealthMetrics(addr, windowDays)` — operator day-30 health.
 *
 * Computes four substrate-compound metrics for a TRUST, plus 30d
 * sparklines, by aggregating data the daemon store already loads
 * (`quests`, `events`, `agents`) and a per-mount `listIdeas` call.
 *
 * Why client-side, not a new endpoint:
 *   - Quests, events, and the agent subtree are already in `useDaemonStore`
 *     for the same shell render. The Overview tab does the same aggregation
 *     today (cf. `EntityOverviewTab.tsx`).
 *   - Ideas need a single `listIdeas` call scoped to the entity's default
 *     agent. The default scope returns the entity-visible ideas, mirroring
 *     `AgentIdeasTab(scope="entity")`.
 *   - Adding a `/api/trust/<addr>/health-metrics` endpoint would push the
 *     same aggregation server-side without unlocking new data. Re-deferred
 *     until per-role / cross-entity comparisons land (V2 per the brief).
 *
 * The hook returns memoized aggregates so the four MetricCard re-renders
 * and the four sparkline polylines don't recompute on every parent
 * render.
 */
import { useEffect, useMemo, useState } from "react";
import { useDaemonStore } from "@/store/daemon";
import { listActivityStream } from "@/api/activity";
import { listIdeas } from "@/api/ideas";
import type { ActivityEntry, Idea, Quest } from "@/lib/types";
import { buildTrendDelta, type TrendDelta } from "./formatHealthCopy";

/** Default trailing window for the dashboard. The brief locks 30. */
export const DEFAULT_HEALTH_WINDOW_DAYS = 30;

/** ms in one day — used everywhere bucketing happens. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Decision-type substrings that count as a "decision" or status change
 *  event for the decision-log metric. Mirrors `events.ts` lifecycle
 *  matchers so the operator's mental model stays consistent. */
const DECISION_LIKE_PATTERNS = [
  "quest_created",
  "create_quest",
  "task_created",
  "create_task",
  "quest_started",
  "start_quest",
  "task_started",
  "start_task",
  "quest_completed",
  "complete_quest",
  "close_quest",
  "task_completed",
  "complete_task",
  "close_task",
  "quest_blocked",
  "block_quest",
  "task_blocked",
  "block_task",
  "quest_cancelled",
  "cancel_quest",
  "task_cancelled",
  "cancel_task",
  "mission_created",
  "mission_decomposed",
  "decision",
];

/**
 * Pull this many activity events for the metric backfill. 30 days at
 * heavy load is well under this cap; the daemon store's 30-event mount
 * fetch is for the cockpit's "last 24h" card and doesn't cover us.
 */
const HEALTH_EVENT_FETCH_LIMIT = 1000;

/**
 * Pull this many ideas for the graph-growth backfill. Ideas are
 * cumulative, so we need a window large enough that 30d's worth of new
 * ideas is captured even for noisy entities.
 */
const HEALTH_IDEA_FETCH_LIMIT = 500;

export interface HealthSparklines {
  /** Quests closed per day, length = windowDays, oldest first. */
  questsClosed: number[];
  /** Agent-attributed actions per day, length = windowDays, oldest first. */
  agentActions: number[];
  /** New ideas per day, length = windowDays, oldest first. */
  ideaGrowth: number[];
  /** Cumulative decision-log length per day, length = windowDays, oldest first. */
  decisionLog: number[];
}

export interface HealthMetrics {
  /** Quests closed in the trailing 7d window. */
  questsClosedPerWeek: number;
  /** Sum of agent-fired events + agent-stored ideas + agent-filed quests
   *  over the trailing 7d window. */
  agentActionsPerWeek: number;
  /** New ideas in the trailing 7d window. Decay isn't modeled (V2). */
  ideaGraphGrowth: number;
  /** Total decision-like events since genesis. Lifetime, not windowed. */
  decisionLogLength: number;
  /** Decision-like events fired in the trailing 7d window — supplements
   *  the lifetime total for the interpretation copy. */
  decisionsThisWeek: number;
  /** Agent-only quality metric: quest reopen-like events in the trailing
   *  28d divided by closed quests in the same period. Entity health
   *  callers can ignore it. */
  questReopenRate28d: {
    reopened: number;
    closed: number;
    rate: number;
  };
  /** Agent-only discipline metric. The label/tag convention is not
   *  formalized yet, so this reports observed overstep-like activity
   *  while marking the metric as convention-pending. */
  briefOverstepIncidence28d: {
    count: number;
    tracked: boolean;
  };
  /** Per-metric trend deltas (current 7d vs previous 7d). The decision
   *  log metric is cumulative so its trend compares lifetime totals
   *  7d apart. */
  trendDeltas: {
    questsClosed: TrendDelta;
    agentActions: TrendDelta;
    ideaGrowth: TrendDelta;
    decisionLog: TrendDelta;
  };
  sparklines: HealthSparklines;
  /** Earliest known activity timestamp (epoch ms) for the TRUST — drives
   *  the "too early to see compounding" empty state. `null` when no
   *  signal exists in any of the four sources yet. */
  earliestActivityMs: number | null;
}

export interface UseTrustHealthMetricsResult {
  metrics: HealthMetrics | null;
  isLoading: boolean;
  error: Error | null;
}

export interface TrustHealthMetricsOptions {
  /** Optional per-agent filter for `/trust/<addr>/agents/<agent>/health`. */
  agentId?: string | null;
}

interface InternalAggregationInput {
  windowDays: number;
  /** Now anchor for bucketing — pinned per render so two re-renders in
   *  the same render tick agree on the day boundaries. */
  nowMs: number;
  quests: Quest[];
  events: ActivityEntry[];
  ideas: Idea[];
  /** Set of agent names that belong to the entity subtree. Events match
   *  by `event.agent` (string name) per the existing Overview pattern. */
  agentNames: Set<string>;
  /** Set of agent ids that belong to the entity subtree. Quests and
   *  ideas attribute by `agent_id`. */
  agentIds: Set<string>;
}

/** Internal: build per-day bucket counts. Day 0 = today, oldest first
 *  in the returned array. Out-of-window timestamps drop silently. */
function bucketByDay(timestamps: number[], nowMs: number, windowDays: number): number[] {
  const buckets = new Array<number>(windowDays).fill(0);
  // Anchor the "today" bucket to the start of the operator's local day
  // so the last cell of the sparkline lines up with the calendar day
  // they're looking at, not the rolling 24h.
  const todayStart = startOfDay(nowMs);
  for (const ts of timestamps) {
    if (!Number.isFinite(ts)) continue;
    const dayDelta = Math.floor((todayStart - startOfDay(ts)) / DAY_MS);
    if (dayDelta < 0 || dayDelta >= windowDays) continue;
    // Oldest first: index 0 = oldest day, index N-1 = today.
    buckets[windowDays - 1 - dayDelta] += 1;
  }
  return buckets;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function isDecisionLike(decisionType: string | undefined): boolean {
  if (!decisionType) return false;
  const dt = decisionType.toLowerCase();
  return DECISION_LIKE_PATTERNS.some((p) => dt.includes(p));
}

function includesAnyNeedle(value: string | undefined, needles: string[]): boolean {
  if (!value) return false;
  const text = value.toLowerCase();
  return needles.some((needle) => text.includes(needle));
}

function parseTs(value: string | undefined): number {
  if (!value) return Number.NaN;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/**
 * Pure aggregation. Extracted so the hook body just composes data
 * fetching with this function — the bucketing math is the part worth
 * testing in isolation.
 */
export function computeHealthMetrics(input: InternalAggregationInput): HealthMetrics {
  const { windowDays, nowMs, quests, events, ideas, agentNames, agentIds } = input;
  const sevenDaysAgo = nowMs - 7 * DAY_MS;
  const fourteenDaysAgo = nowMs - 14 * DAY_MS;
  const twentyEightDaysAgo = nowMs - 28 * DAY_MS;

  // ── Quests closed: closed_at timestamps for done/cancelled, agent ∈ subtree.
  const closedQuestTimestamps: number[] = [];
  let questsClosed7d = 0;
  let questsClosed14d = 0;
  let questsClosed28d = 0;
  for (const q of quests) {
    if (q.status !== "done" && q.status !== "cancelled") continue;
    if (q.agent_id && !agentIds.has(q.agent_id)) continue;
    const ts = parseTs(q.closed_at ?? q.updated_at);
    if (!Number.isFinite(ts)) continue;
    closedQuestTimestamps.push(ts);
    if (ts >= sevenDaysAgo) questsClosed7d += 1;
    else if (ts >= fourteenDaysAgo) questsClosed14d += 1;
    if (ts >= twentyEightDaysAgo) questsClosed28d += 1;
  }

  // ── Agent actions: sum of (events fired by agent in subtree) +
  //    (ideas stored by agent in subtree) + (quests filed by agent in
  //    subtree, regardless of status). "Filed" = created_at.
  const agentActionTimestamps: number[] = [];
  let agentActions7d = 0;
  let agentActions14d = 0;

  for (const ev of events) {
    if (!ev.agent || !agentNames.has(ev.agent)) continue;
    const ts = parseTs(ev.timestamp);
    if (!Number.isFinite(ts)) continue;
    agentActionTimestamps.push(ts);
    if (ts >= sevenDaysAgo) agentActions7d += 1;
    else if (ts >= fourteenDaysAgo) agentActions14d += 1;
  }

  for (const idea of ideas) {
    if (idea.agent_id && !agentIds.has(idea.agent_id)) continue;
    const ts = parseTs(idea.created_at);
    if (!Number.isFinite(ts)) continue;
    agentActionTimestamps.push(ts);
    if (ts >= sevenDaysAgo) agentActions7d += 1;
    else if (ts >= fourteenDaysAgo) agentActions14d += 1;
  }

  for (const q of quests) {
    if (q.agent_id && !agentIds.has(q.agent_id)) continue;
    const ts = parseTs(q.created_at);
    if (!Number.isFinite(ts)) continue;
    agentActionTimestamps.push(ts);
    if (ts >= sevenDaysAgo) agentActions7d += 1;
    else if (ts >= fourteenDaysAgo) agentActions14d += 1;
  }

  // ── Idea growth: new ideas in window. Decay (negative side of the
  //    "new − decayed" brief) is a V2 — there's no decay marker on
  //    ideas today. We track absolute new ideas and call that out in
  //    the interpretation copy.
  const ideaTimestamps: number[] = [];
  let ideaGrowth7d = 0;
  let ideaGrowth14d = 0;
  for (const idea of ideas) {
    if (idea.agent_id && !agentIds.has(idea.agent_id)) continue;
    const ts = parseTs(idea.created_at);
    if (!Number.isFinite(ts)) continue;
    ideaTimestamps.push(ts);
    if (ts >= sevenDaysAgo) ideaGrowth7d += 1;
    else if (ts >= fourteenDaysAgo) ideaGrowth14d += 1;
  }

  // ── Decision-log length: every decision-like event in the subtree
  //    since genesis. Cumulative count of `decisionLike` events; sparkline
  //    is the cumulative curve so the operator sees the "record getting
  //    heavier" arc, not a per-day rate.
  const decisionTimestamps: number[] = [];
  let questReopenEvents28d = 0;
  let briefOverstepEvents28d = 0;
  for (const ev of events) {
    if (!ev.agent || !agentNames.has(ev.agent)) continue;
    const ts = parseTs(ev.timestamp);
    if (!Number.isFinite(ts)) continue;
    if (
      ts >= twentyEightDaysAgo &&
      (includesAnyNeedle(ev.decision_type, ["reopen", "re-open", "reopened"]) ||
        includesAnyNeedle(ev.summary, ["reopen", "re-open", "reopened"]))
    ) {
      questReopenEvents28d += 1;
    }
    if (
      ts >= twentyEightDaysAgo &&
      (includesAnyNeedle(ev.decision_type, ["overstep", "scope creep", "brief violation"]) ||
        includesAnyNeedle(ev.summary, ["overstep", "scope creep", "brief violation"]))
    ) {
      briefOverstepEvents28d += 1;
    }
    if (!isDecisionLike(ev.decision_type)) continue;
    decisionTimestamps.push(ts);
  }
  const decisionLogLength = decisionTimestamps.length;
  let decisions7d = 0;
  let decisions14d = 0;
  for (const ts of decisionTimestamps) {
    if (ts >= sevenDaysAgo) decisions7d += 1;
    else if (ts >= fourteenDaysAgo) decisions14d += 1;
  }

  // ── Sparklines. The first three are per-day counts; decision-log is
  //    cumulative — we bucket the per-day count then prefix-sum it
  //    against the start-of-window total so the line starts at the
  //    pre-window total and climbs.
  const questsClosedSpark = bucketByDay(closedQuestTimestamps, nowMs, windowDays);
  const agentActionsSpark = bucketByDay(agentActionTimestamps, nowMs, windowDays);
  const ideaGrowthSpark = bucketByDay(ideaTimestamps, nowMs, windowDays);
  const decisionPerDay = bucketByDay(decisionTimestamps, nowMs, windowDays);

  // Cumulative decision-log curve. Start anchor = decisions older than
  // the start of the window (the "before today's chart" baseline).
  const windowStartMs = startOfDay(nowMs - (windowDays - 1) * DAY_MS);
  let baseline = 0;
  for (const ts of decisionTimestamps) {
    if (ts < windowStartMs) baseline += 1;
  }
  const decisionLogSpark: number[] = new Array(windowDays).fill(0);
  let running = baseline;
  for (let i = 0; i < windowDays; i++) {
    running += decisionPerDay[i];
    decisionLogSpark[i] = running;
  }

  // ── Earliest activity = min(timestamp) across all four sources.
  const candidates: number[] = [];
  if (closedQuestTimestamps.length) candidates.push(Math.min(...closedQuestTimestamps));
  if (agentActionTimestamps.length) candidates.push(Math.min(...agentActionTimestamps));
  if (ideaTimestamps.length) candidates.push(Math.min(...ideaTimestamps));
  if (decisionTimestamps.length) candidates.push(Math.min(...decisionTimestamps));
  const earliestActivityMs = candidates.length ? Math.min(...candidates) : null;

  return {
    questsClosedPerWeek: questsClosed7d,
    agentActionsPerWeek: agentActions7d,
    ideaGraphGrowth: ideaGrowth7d,
    decisionLogLength,
    decisionsThisWeek: decisions7d,
    questReopenRate28d: {
      reopened: questReopenEvents28d,
      closed: questsClosed28d,
      rate: questsClosed28d > 0 ? questReopenEvents28d / questsClosed28d : 0,
    },
    briefOverstepIncidence28d: {
      count: briefOverstepEvents28d,
      tracked: false,
    },
    trendDeltas: {
      questsClosed: buildTrendDelta(questsClosed7d, questsClosed14d),
      agentActions: buildTrendDelta(agentActions7d, agentActions14d),
      ideaGrowth: buildTrendDelta(ideaGrowth7d, ideaGrowth14d),
      decisionLog: buildTrendDelta(decisions7d, decisions14d),
    },
    sparklines: {
      questsClosed: questsClosedSpark,
      agentActions: agentActionsSpark,
      ideaGrowth: ideaGrowthSpark,
      decisionLog: decisionLogSpark,
    },
    earliestActivityMs,
  };
}

/**
 * Subscribe to the daemon store's already-loaded quests / events /
 * agents, fetch a windowed activity stream + entity-scoped ideas list
 * on mount, then memoize the aggregation.
 *
 * `addr` is the canonical /trust/<addr> identifier. We resolve it to
 * an entity via the daemon store's entity list so the function caller
 * can use either the raw URL slug or a resolved trust_address.
 */
export function useTrustHealthMetrics(
  addr: string | null | undefined,
  windowDays: number = DEFAULT_HEALTH_WINDOW_DAYS,
  options: TrustHealthMetricsOptions = {},
): UseTrustHealthMetricsResult {
  const entities = useDaemonStore((s) => s.entities);
  const allAgents = useDaemonStore((s) => s.agents);
  const allQuests = useDaemonStore((s) => s.quests);
  const baseEvents = useDaemonStore((s) => s.events);

  // Resolve addr → entity. Match by trust_address first (canonical),
  // then by id as a fallback for callers that pass an entity id.
  const entity = useMemo(() => {
    if (!addr) return null;
    return (
      entities.find((e) => e.trust_address === addr) ?? entities.find((e) => e.id === addr) ?? null
    );
  }, [addr, entities]);

  const entityId = entity?.id ?? null;

  // Subtree agents = root + descendants (every agent whose entity_id is
  // this entity, plus the entity-as-agent itself when present). Mirrors
  // EntityOverviewTab's subtree derivation so the metric scope agrees
  // with the cockpit numbers.
  const subtreeAgents = useMemo(() => {
    if (!entityId) return [];
    return allAgents.filter((a) => a.entity_id === entityId || a.id === entityId);
  }, [allAgents, entityId]);

  const scopedAgents = useMemo(() => {
    if (!options.agentId) return subtreeAgents;
    const found = subtreeAgents.filter((a) => a.id === options.agentId);
    return found.length ? found : [];
  }, [subtreeAgents, options.agentId]);

  const agentNames = useMemo(
    () => new Set<string>(scopedAgents.map((a) => a.name)),
    [scopedAgents],
  );
  const agentIds = useMemo(() => {
    const ids = new Set<string>(scopedAgents.map((a) => a.id));
    if (options.agentId) ids.add(options.agentId);
    return ids;
  }, [scopedAgents, options.agentId]);

  // The daemon store's `events` only loads the most recent 30 — fine
  // for the cockpit "last 24h" card, not for a 30-day backfill. Fetch
  // a deeper slice on mount and merge against the store events by id.
  const [windowedEvents, setWindowedEvents] = useState<ActivityEntry[] | null>(null);
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch the 1000-event tail + the entity-scoped idea list on mount /
  // whenever the resolved entity changes. The brief allows poll-on-mount
  // + nav-to-tab; we deliberately do NOT subscribe to a live feed.
  useEffect(() => {
    if (!entityId) {
      setWindowedEvents(null);
      setIdeas(null);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    Promise.all([
      listActivityStream({ last: HEALTH_EVENT_FETCH_LIMIT }).catch((e: unknown) => {
        // Don't fail the whole page on activity errors — the store's
        // baseline events still give us a partial answer.
        if (e instanceof Error) setError(e);
        return { events: [] as ActivityEntry[] };
      }),
      listIdeas({ limit: HEALTH_IDEA_FETCH_LIMIT }).catch((e: unknown) => {
        if (e instanceof Error) setError(e);
        return { ideas: [] as Idea[] };
      }),
    ])
      .then(([activityRes, ideasRes]) => {
        if (cancelled) return;
        setWindowedEvents(activityRes.events ?? []);
        setIdeas(ideasRes.ideas ?? []);
        setIsLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof Error) setError(e);
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [entityId]);

  // Merge windowed events with the daemon-store events (the latter is
  // live-updated via the worker WS) so the metric reflects activity
  // since the page was first mounted.
  const mergedEvents = useMemo<ActivityEntry[]>(() => {
    const out = new Map<number, ActivityEntry>();
    if (windowedEvents) {
      for (const e of windowedEvents) out.set(e.id, e);
    }
    for (const e of baseEvents) out.set(e.id, e);
    return Array.from(out.values());
  }, [windowedEvents, baseEvents]);

  // Pin `nowMs` once per metric recompute so the day-boundary bucketing
  // doesn't shift midway through a render.
  const metrics = useMemo<HealthMetrics | null>(() => {
    if (!entityId) return null;
    if (isLoading) return null;
    const nowMs = Date.now();
    return computeHealthMetrics({
      windowDays,
      nowMs,
      quests: allQuests,
      events: mergedEvents,
      ideas: ideas ?? [],
      agentNames,
      agentIds,
    });
    // We intentionally exclude `nowMs` from deps — recomputing every
    // render tick would defeat the memo. The poll-on-mount contract
    // means a tab nav remount is the refresh signal.
  }, [entityId, isLoading, windowDays, allQuests, mergedEvents, ideas, agentNames, agentIds]);

  return { metrics, isLoading, error };
}
