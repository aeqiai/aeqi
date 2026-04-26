import type { QuestRuntime } from "./runtime";

export interface Agent {
  id: string;
  name: string;
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
  can_ask_director?: boolean;
}

export interface AgentRef {
  id: string;
  name: string;
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
  scope?: ScopeValue;
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

export type ScopeValue = "self" | "siblings" | "children" | "branch" | "global";

export interface Idea {
  id: string;
  name: string;
  content: string;
  tags?: string[];
  scope?: ScopeValue;
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

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export interface AgentEvent {
  id: string;
  agent_id?: string | null;
  scope?: ScopeValue;
  name: string;
  pattern: string;
  idea_ids: string[];
  query_template?: string | null;
  query_top_k?: number | null;
  query_tag_filter?: string[] | null;
  tool_calls?: ToolCall[] | null;
  enabled: boolean;
  cooldown_secs: number;
  fire_count: number;
  last_fired?: string;
  total_cost_usd: number;
  system: boolean;
}

export interface EventInvocationRow {
  id: number;
  session_id: string;
  pattern: string;
  event_name: string | null;
  caller_kind: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  error: string | null;
  tool_calls_json: string;
}

export interface InvocationStepRow {
  id: number;
  invocation_id: number;
  step_index: number;
  tool_name: string;
  args_json: string;
  started_at: string;
  finished_at: string | null;
  result_summary: string | null;
  status: string;
  error: string | null;
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

// Company templates — a pre-threaded bundle of seed agents / events / ideas /
// quests that spawns a ready-to-go root agent. The shape mirrors Stream C's
// `/api/templates` contract; optional fields stay loose so a sparse template
// (no seed quests, no seed events) still renders cleanly.
export interface TemplateSeedAgent {
  name: string;
  tagline?: string;
  role?: string;
  identity?: string;
}

export interface TemplateSeedEvent {
  pattern: string;
  name?: string;
  description?: string;
}

export interface TemplateSeedIdea {
  name: string;
  tags?: string[];
  summary?: string;
}

export interface TemplateSeedQuest {
  subject: string;
  description?: string;
  priority?: string;
}

export interface RootAgentSpec {
  name: string;
  model?: string;
  color?: string;
  avatar?: string;
  system_prompt?: string;
}

export interface CompanyTemplate {
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  tags?: string[];
  root?: RootAgentSpec;
  seed_agents?: TemplateSeedAgent[];
  seed_events?: TemplateSeedEvent[];
  seed_ideas?: TemplateSeedIdea[];
  seed_quests?: TemplateSeedQuest[];
}
