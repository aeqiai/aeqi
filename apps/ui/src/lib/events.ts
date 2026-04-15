import type { Checkpoint, ActivityEntry } from "./types";

export type TimelineEventType =
  | "message"
  | "quest_created"
  | "quest_started"
  | "quest_checkpoint"
  | "quest_blocked"
  | "quest_completed"
  | "quest_cancelled"
  | "activity";

export interface TimelineItem {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  summary?: string;
  agent?: string;
  // Message fields
  role?: string;
  content?: string;
  // Quest fields
  questId?: string;
  questSubject?: string;
  questStatus?: string;
  checkpoint?: Checkpoint;
  // Activity fields
  activityEntry?: ActivityEntry;
}

export function checkpointsToTimeline(checkpoints: Checkpoint[], questId: string): TimelineItem[] {
  return checkpoints.map((cp, i) => ({
    id: `cp-${questId}-${i}`,
    type: "quest_checkpoint" as const,
    timestamp: cp.timestamp,
    summary: cp.progress,
    agent: cp.agent_name,
    questId,
    checkpoint: cp,
  }));
}

export function activityToTimeline(entries: ActivityEntry[]): TimelineItem[] {
  return entries.map((e) => {
    let type: TimelineEventType = "activity";
    const dt = (e.decision_type || "").toLowerCase();
    if (
      dt.includes("quest_created") ||
      dt.includes("create_quest") ||
      dt.includes("task_created") ||
      dt.includes("create_task")
    )
      type = "quest_created";
    else if (
      dt.includes("quest_started") ||
      dt.includes("start_quest") ||
      dt.includes("task_started") ||
      dt.includes("start_task")
    )
      type = "quest_started";
    else if (
      dt.includes("quest_completed") ||
      dt.includes("complete_quest") ||
      dt.includes("close_quest") ||
      dt.includes("task_completed") ||
      dt.includes("complete_task") ||
      dt.includes("close_task")
    )
      type = "quest_completed";
    else if (
      dt.includes("quest_blocked") ||
      dt.includes("block_quest") ||
      dt.includes("task_blocked") ||
      dt.includes("block_task")
    )
      type = "quest_blocked";
    else if (
      dt.includes("quest_cancelled") ||
      dt.includes("cancel_quest") ||
      dt.includes("task_cancelled") ||
      dt.includes("cancel_task")
    )
      type = "quest_cancelled";

    return {
      id: `activity-${e.id}`,
      type,
      timestamp: e.timestamp,
      summary: e.summary,
      agent: e.agent,
      questId: e.quest_id,
      activityEntry: e,
    };
  });
}

export function mergeTimelines(...timelines: TimelineItem[][]): TimelineItem[] {
  return timelines.flat().sort((a, b) => {
    const ta = new Date(a.timestamp).getTime();
    const tb = new Date(b.timestamp).getTime();
    return ta - tb;
  });
}
