import type { QuestRuntime } from "./runtime";

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
  last_active?: string;
  session_count?: number;
  total_tokens?: number;
  budget_usd?: number;
  execution_mode?: string;
  workdir?: string;
  quest_prefix?: string;
  worker_timeout_secs?: number;
  prompt_ids?: string[];
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
  steps_used: number;
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
  /** @deprecated Use agent_id instead. Kept for backward compat with old data. */
  assignee?: string;
  agent_id?: string;
  skill?: string;
  labels: string[];
  cost_usd: number;
  created_at: string;
  updated_at?: string;
  closed_at?: string;
  /** @deprecated Use outcome.summary instead. Kept for backward compat with old data. */
  closed_reason?: string;
  checkpoints?: Checkpoint[];
  depends_on?: string[];
  /** @deprecated Removed in v2 (inverse of depends_on, redundant). */
  blocks?: string[];
  acceptance_criteria?: string;
  retry_count?: number;
  /** @deprecated Removed in v2 (scheduler handles concurrency). */
  locked_by?: string;
  /** @deprecated Removed in v2 (scheduler handles concurrency). */
  locked_at?: string;
  outcome?: QuestOutcome;
  metadata?: Record<string, unknown>;
  runtime?: QuestRuntime;
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

export interface Idea {
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
  quest_id?: string;
  /** @deprecated Use quest_id instead. Kept for backward compat with old data. */
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
  /** @deprecated Use session_id instead. Kept for backward compat with old data. */
  chat_id?: number | string;
  session_id?: string;
  event_type: string;
  role: string;
  content: string;
  timestamp: string;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ChatThreadState {
  /** @deprecated Use sessionId instead. */
  chatId?: number;
  sessionId?: string;
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
