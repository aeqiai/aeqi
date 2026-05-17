import { describe, expect, it } from "vitest";
import { computeHealthMetrics } from "@/hooks/useTrustHealthMetrics";
import type { ActivityEntry, Idea, Quest } from "@/lib/types";

const NOW = Date.parse("2026-05-17T12:00:00Z");
const day = 24 * 60 * 60 * 1000;

function quest(id: string, agentId: string, status: Quest["status"], daysAgo: number): Quest {
  const ts = new Date(NOW - daysAgo * day).toISOString();
  return {
    id,
    status,
    priority: "normal",
    agent_id: agentId,
    cost_usd: 0,
    created_at: ts,
    closed_at: status === "done" ? ts : undefined,
  };
}

function event(id: number, agent: string, decisionType: string, daysAgo: number): ActivityEntry {
  return {
    id,
    agent,
    decision_type: decisionType,
    summary: decisionType,
    timestamp: new Date(NOW - daysAgo * day).toISOString(),
  };
}

function idea(id: string, agentId: string, daysAgo: number): Idea {
  return {
    id,
    name: id,
    content: "",
    agent_id: agentId,
    created_at: new Date(NOW - daysAgo * day).toISOString(),
  };
}

describe("computeHealthMetrics", () => {
  it("filters substrate metrics to a single agent id and name", () => {
    const metrics = computeHealthMetrics({
      windowDays: 30,
      nowMs: NOW,
      quests: [
        quest("q-1", "agent-a", "done", 1),
        quest("q-2", "agent-b", "done", 1),
        quest("q-3", "agent-a", "todo", 1),
      ],
      events: [
        event(1, "Agent A", "quest_completed", 1),
        event(2, "Agent B", "quest_completed", 1),
        event(3, "Agent A", "quest_reopened", 2),
        event(4, "Agent A", "brief_overstep", 3),
      ],
      ideas: [idea("i-1", "agent-a", 1), idea("i-2", "agent-b", 1)],
      agentNames: new Set(["Agent A"]),
      agentIds: new Set(["agent-a"]),
    });

    expect(metrics.questsClosedPerWeek).toBe(1);
    expect(metrics.agentActionsPerWeek).toBe(6);
    expect(metrics.ideaGraphGrowth).toBe(1);
    expect(metrics.decisionLogLength).toBe(1);
    expect(metrics.questReopenRate28d).toEqual({ reopened: 1, closed: 1, rate: 1 });
    expect(metrics.briefOverstepIncidence28d).toEqual({ count: 1, tracked: false });
  });
});
