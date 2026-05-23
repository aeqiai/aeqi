import { useMemo } from "react";
import AgentSurfaceHeader from "@/components/AgentSurfaceHeader";
import {
  Banner,
  EmptyState,
  MetricCard,
  MetricGrid,
  Page,
  PageBody,
  PageSection,
  Loading,
} from "@/components/ui";
import { useCurrentTrust } from "@/hooks/useCurrentTrust";
import {
  DEFAULT_HEALTH_WINDOW_DAYS,
  useTrustHealthMetrics,
  type HealthMetrics,
} from "@/hooks/useTrustHealthMetrics";
import {
  interpretAgentActions,
  interpretDecisionLog,
  interpretIdeaGrowth,
  interpretQuests,
} from "@/hooks/formatHealthCopy";
import { useVisibleIdeas } from "@/queries/ideas";
import { useDaemonStore } from "@/store/daemon";
import { formatInteger, formatMediumDate } from "@/lib/i18n";
import type { Idea } from "@/lib/types";
import { InterpretationLine, SparklineGrid, TrendBadge } from "./HealthPage";
import styles from "./HealthPage.module.css";

export default function AgentHealthPage({ agentId }: { agentId: string }) {
  const { entity } = useCurrentTrust();
  const addr = entity?.trust_address ?? entity?.id ?? null;
  const agents = useDaemonStore((s) => s.agents);
  const agent = agents.find((a) => a.id === agentId);
  const { metrics, isLoading, error } = useTrustHealthMetrics(addr, DEFAULT_HEALTH_WINDOW_DAYS, {
    agentId,
  });
  const goalsQuery = useVisibleIdeas(true, entity?.id ?? null);

  const goals = useMemo(() => {
    return (goalsQuery.data ?? []).filter((idea) => isGoalForAgent(idea, agentId));
  }, [goalsQuery.data, agentId]);

  return (
    <div className="agent-page">
      <AgentSurfaceHeader agentId={agentId} />
      <Page>
        <PageBody>
          {error && (
            <div className={styles.errorBanner}>
              <Banner kind="warning">
                Some signal couldn’t load. Numbers below may understate activity.
              </Banner>
            </div>
          )}

          {isLoading ? (
            <Loading size="sm" />
          ) : !metrics ? (
            <EmptyState
              title="No health signal in scope."
              description="This agent has no visible substrate activity yet."
            />
          ) : (
            <>
              <PageSection
                title={`${agent?.name ?? "Agent"} health`}
                description="Per-agent substrate metrics over the trailing windows."
              >
                <AgentMetricGrid metrics={metrics} />
              </PageSection>

              <PageSection
                title={`Trailing ${DEFAULT_HEALTH_WINDOW_DAYS} days`}
                description="Each line is a per-day count. Decision log is cumulative."
              >
                <SparklineGrid metrics={metrics} />
              </PageSection>
            </>
          )}

          <PageSection title="Professional goals">
            {goalsQuery.isLoading ? (
              <Loading size="sm" />
            ) : goals.length === 0 ? (
              <EmptyState
                title="This agent has no professional goals filed."
                description="File one with goal.create."
              />
            ) : (
              <ul className={styles.agentGoalsList}>
                {goals.map((goal) => (
                  <AgentGoalRow key={goal.id} goal={goal} />
                ))}
              </ul>
            )}
          </PageSection>
        </PageBody>
      </Page>
    </div>
  );
}

function AgentMetricGrid({ metrics }: { metrics: HealthMetrics }) {
  return (
    <MetricGrid columns={3}>
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
      <MetricCard
        label="Quest re-open rate"
        value={
          <span className={styles.metricValueNumeric}>
            {formatPercent(metrics.questReopenRate28d.rate)}
          </span>
        }
        detail={`${formatInteger(metrics.questReopenRate28d.reopened)} re-open signals across ${formatInteger(metrics.questReopenRate28d.closed)} closed quests in 28d.`}
      />
      <MetricCard
        label="Brief oversteps"
        value={
          <span className={styles.metricValueNumeric}>
            {formatInteger(metrics.briefOverstepIncidence28d.count)}
          </span>
        }
        detail="Convention pending; counts only explicit overstep signals."
      />
    </MetricGrid>
  );
}

function AgentGoalRow({ goal }: { goal: Idea }) {
  const props = (goal.properties ?? {}) as Record<string, unknown>;
  const target = typeof props.target === "number" ? props.target : null;
  const current = typeof props.current === "number" ? props.current : 0;
  const unit = typeof props.unit === "string" ? props.unit : "";
  const deadline = typeof props.deadline === "string" ? props.deadline : null;
  const status = typeof props.status === "string" ? props.status : "active";

  return (
    <li className={styles.agentGoalRow}>
      <div className={styles.agentGoalMain}>
        <h3>{goal.name}</h3>
        {goal.content && <p>{goal.content}</p>}
      </div>
      <div className={styles.agentGoalChips}>
        {target !== null && (
          <span className={styles.agentGoalChip}>
            {formatInteger(current)}
            {unit} / {formatInteger(target)}
            {unit}
          </span>
        )}
        {deadline && <span className={styles.agentGoalChip}>by {formatDeadline(deadline)}</span>}
        <span className={styles.agentGoalChip}>{status}</span>
      </div>
    </li>
  );
}

function isGoalForAgent(idea: Idea, agentId: string): boolean {
  if ((idea.kind ?? "note") !== "goal") return false;
  if (idea.agent_id === agentId) return true;
  const props = (idea.properties ?? {}) as Record<string, unknown>;
  const candidates = [
    props.assignee,
    props.assignee_id,
    props.agent_id,
    props.owner_agent_id,
    props.responsible_agent_id,
  ];
  if (candidates.some((value) => value === agentId || value === `agent:${agentId}`)) return true;
  return (idea.tags ?? []).some((tag) => tag === `agent:${agentId}` || tag === agentId);
}

function formatDeadline(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return formatMediumDate(d);
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
