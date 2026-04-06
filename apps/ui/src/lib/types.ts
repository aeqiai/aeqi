import type { TaskRuntime } from "./runtime";

export interface Agent {
  id: string;
  name: string;
  display_name?: string;
  parent_id?: string | null;
  status: string;
  model?: string;
  prompts?: Record<string, string>;
  capabilities?: string[];
  project?: string;
  template?: string;
  session_id?: string;
  color?: string;
  avatar?: string;
  created_at?: string;
}

export interface AgentRef {
  id: string;
  name: string;
  display_name?: string;
  model?: string;
}

export interface Checkpoint {
  timestamp: string;
  worker: string;
  progress: string;
  cost_usd: number;
  turns_used: number;
}

export type QuestStatus = "pending" | "in_progress" | "done" | "blocked" | "cancelled";
export type QuestPriority = "critical" | "high" | "normal" | "low";

export interface QuestOutcome {
  kind: string;      // "done", "blocked", "failed", "handoff"
  summary: string;
  reason?: string;
  next_action?: string;
}

export interface Quest {
  id: string;
  subject: string;
  description: string;
  status: QuestStatus;
  priority: QuestPriority;
  assignee?: string;
  agent_id?: string;
  skill?: string;
  labels: string[];
  cost_usd: number;
  created_at: string;
  updated_at?: string;
  closed_at?: string;
  closed_reason?: string;
  checkpoints?: Checkpoint[];
  depends_on?: string[];
  blocks?: string[];
  acceptance_criteria?: string;
  retry_count?: number;
  locked_by?: string;
  locked_at?: string;
  metadata?: Record<string, unknown>;
  runtime?: TaskRuntime;
}

export interface Event {
  id: string | number;
  timestamp: string;
  event_type: string;
  agent?: string;
  summary: string;
  quest_id?: string;
  metadata?: Record<string, unknown>;
}

export interface Insight {
  id: string;
  key: string;
  content: string;
  category?: string;
  scope?: string;
  agent_id?: string;
  created_at: string;
}

export interface AuditEntry {
  id: number;
  timestamp: string;
  created_at?: string;
  company: string;
  decision_type: string;
  summary: string;
  agent?: string;
  task_id?: string;
  metadata?: Record<string, unknown>;
}

export interface DaemonStatus {
  running: boolean;
  uptime_secs: number;
  active_workers: number;
  total_cost_usd: number;
}

export interface DashboardStats {
  active_workers: number;
  total_cost_today: number;
  tasks_completed_24h: number;
  recent_activity: AuditEntry[];
  active_agents: Agent[];
}

export interface ThreadEvent {
  id: number;
  chat_id: number;
  event_type: string;
  role: string;
  content: string;
  timestamp: string;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ChatThreadState {
  chatId?: number;
}

export type TriggerType =
  | { Schedule: { expr: string } }
  | { Once: { at: string } }
  | { Event: { pattern: string; cooldown_secs: number } }
  | { Webhook: { public_id: string } };

export interface Trigger {
  id: string;
  agent_id: string;
  name: string;
  trigger_type: TriggerType;
  skill: string;
  enabled: boolean;
  max_budget_usd?: number;
  created_at: string;
  last_fired?: string;
  fire_count: number;
  total_cost_usd: number;
}
