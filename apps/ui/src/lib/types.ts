import type { QuestRuntime } from "./runtime";

export interface Agent {
  id: string;
  name: string;
  display_name?: string;
  parent_id?: string | null;
  status: string;
  model?: string;
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
  worker_timeout_secs?: number;
  idea_ids?: string[];
  tool_deny?: string[];
}

export interface AgentRef {
  id: string;
  name: string;
  display_name?: string;
  model?: string;
}

export interface Checkpoint {
  timestamp: string;
  agent_name: string;
  progress: string;
  cost_usd: number;
  steps_used: number;
}

export type QuestStatus = "pending" | "in_progress" | "done" | "blocked" | "cancelled";
export type QuestPriority = "critical" | "high" | "normal" | "low";

export interface QuestOutcome {
  kind: string; // "done", "blocked", "failed", "handoff"
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
  agent_id?: string;
  idea_ids?: string[];
  labels: string[];
  cost_usd: number;
  created_at: string;
  updated_at?: string;
  closed_at?: string;
  checkpoints?: Checkpoint[];
  depends_on?: string[];
  acceptance_criteria?: string;
  retry_count?: number;
  outcome?: QuestOutcome;
  worktree_branch?: string;
  worktree_path?: string;
  metadata?: Record<string, unknown>;
  runtime?: QuestRuntime;
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  event_type: string;
  agent_id?: string;
  session_id?: string;
  quest_id?: string;
  content?: Record<string, unknown>;
}

export interface Idea {
  id: string;
  name: string;
  content: string;
  tags?: string[];
  scope?: string;
  agent_id?: string;
  created_at?: string;
  score?: number;
}

export type IdeaRelation = "mentions" | "embeds" | "adjacent";

export interface IdeaLink {
  target_id: string;
  name: string | null;
  relation: IdeaRelation;
  strength: number;
}

export interface IdeaBacklink {
  source_id: string;
  name: string | null;
  relation: IdeaRelation;
  strength: number;
}

export interface IdeaEdges {
  ok: boolean;
  links: IdeaLink[];
  backlinks: IdeaBacklink[];
}

export interface ActivityEntry {
  id: number;
  timestamp: string;
  created_at?: string;
  decision_type: string;
  summary: string;
  agent?: string;
  quest_id?: string;
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
  quests_completed_24h: number;
  recent_activity: ActivityEntry[];
  active_agents: Agent[];
}

export interface ThreadEvent {
  id: number;
  session_id?: string;
  event_type: string;
  role: string;
  content: string;
  timestamp: string;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ChatThreadState {
  sessionId?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  email_verified?: boolean;
  roots?: string[];
  phone?: string;
  phishing_code?: string;
}

export interface SessionInfo {
  id: string;
  agent_id?: string;
  agent_name?: string;
  name?: string;
  session_type?: string;
  status: string;
  created_at: string;
  last_active?: string;
  message_count?: number;
  first_message?: string;
}

export interface AgentEvent {
  id: string;
  name: string;
  pattern: string;
  idea_ids: string[];
  enabled: boolean;
  cooldown_secs: number;
  fire_count: number;
  last_fired?: string;
  system: boolean;
}

export interface WorkerEvent {
  event_type: string;
  quest_id?: string;
  agent?: string;
  root?: string;
  steps?: number;
  cost_usd?: number;
  outcome?: string;
  confidence?: number;
  reason?: string;
  [key: string]: unknown;
}
