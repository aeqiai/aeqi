import type { QuestRuntime } from "./runtime";

export type EntityType = "company" | "human" | "agent" | "fund" | "dao" | "holding" | "protocol";

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  status: "active" | "paused" | "archived";
  avatar?: string;
  color?: string;
  budget_usd?: number;
  created_at: string;
  last_active?: string;
  /** On-chain TRUST identity (bytes32 hex). NULL until DAO bridge fires. */
  trust_id?: string;
  /** On-chain TRUST proxy address. NULL until indexer-confirmed. */
  trust_address?: string;
  /** EOA that created this Entity's on-chain TRUST mirror. */
  creator_address?: string;
  /** Root agent UUID for this entity. Surfaced by the platform's
   *  `/api/entities` payload as `agent_id` so per-entity surfaces (`/me/*`,
   *  AgentPage) can resolve the root without an entity-scoped agents fetch. */
  agent_id?: string;
  /** Placement type — `"host"`, `"sandbox"`, `"vps"`, or `"unknown"`. */
  placement_type?: string;
  /** One-line description rendered in the entity hero strip on Overview. */
  tagline?: string;
  /** When true, `<host>/<slug>` returns a public profile page. */
  public?: boolean;
  /** Per-Company billing plan ID (`free`, `starter`, `growth`). */
  plan?: string;
  /** Current platform-side provisioning status for the placement. */
  placement_status?: string;
  /** Launch-progress state exposed while a new organization is being provisioned. */
  launch_state?: string;
  /** Launch-progress error exposed if provisioning fails. */
  launch_error?: string;
}

export interface Agent {
  id: string;
  name: string;
  entity_id?: string | null;
  status: string;
  model?: string;
  session_id?: string;
  color?: string;
  avatar?: string;
  created_at?: string;
  last_active?: string;
  session_count?: number;
  total_tokens?: number;
  /**
   * Running USD cost across every inference call attributed to this
   * agent. Denormalized from the `inference_calls` audit table by
   * `record_inference_call` at the end of each turn. Surfaced in the
   * agents-list Spend column and the agent Treasury tab's Lifetime
   * Spend stat.
   */
  lifetime_cost_usd?: number;
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

/**
 * One row from the runtime's `inference_calls` audit table — returned
 * by `GET /api/agents/{id}/inference-calls`. Powers the per-agent
 * Treasury tab's recent-calls ledger.
 */
export interface InferenceCallRow {
  id: string;
  agent_id: string;
  session_id: string | null;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  stop_reason: string | null;
  correlation_id: string | null;
  created_at: string;
}

export interface Checkpoint {
  timestamp: string;
  agent_name: string;
  progress: string;
  cost_usd: number;
  steps_used: number;
}

export type QuestStatus = "backlog" | "todo" | "in_progress" | "done" | "cancelled";
export type QuestPriority = "critical" | "high" | "normal" | "low";

export interface QuestOutcome {
  kind: string; // "done", "blocked", "failed", "handoff"
  summary: string;
  reason?: string;
  next_action?: string;
}

export interface Quest {
  id: string;
  /**
   * FK to the linked idea that owns the quest's editorial body. Always
   * set on the wire (the SQL column is `NOT NULL` post-phase 3); the
   * type leaves it nullable only for in-flight client-side construction.
   */
  idea_id?: string | null;
  /**
   * In-line idea snapshot returned alongside the quest by every endpoint
   * (`GET /quests`, `GET /quests/:id`, `POST /quests`,
   * `PUT /quests/:id`). UI surfaces editorial content via `quest.idea`
   * exclusively — there are no legacy `subject` / `description` /
   * `labels` fields on the wire any more.
   */
  idea?: Idea;
  /** Other quests pointing at the same idea — drives the "Shared spec · N quests" badge. */
  sibling_quest_ids?: string[];
  status: QuestStatus;
  priority: QuestPriority;
  scope?: ScopeValue;
  agent_id?: string;
  /**
   * Polymorphic responsibility pointer. `agent:<id>` | `user:<id>` |
   * `null` (unassigned). Distinct from `agent_id`, which anchors the
   * visibility tree — `assignee` is the social "who's doing this"
   * pointer and is the only field the assignee picker writes.
   */
  assignee?: string | null;
  cost_usd: number;
  created_at: string;
  updated_at?: string;
  closed_at?: string;
  /** Linear-style soft deadline. RFC3339 UTC string when set, null/absent
   * when no deadline. Phase-2 schema column. UI renders relative time
   * ("3d", "in 1h", "overdue 2d") and tints the chip red when past. */
  due_at?: string | null;
  checkpoints?: Checkpoint[];
  depends_on?: string[];
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
  // Tables-in-Ideas Phase 2.
  parent_idea_id?: string | null;
  properties?: Record<string, unknown> | null;
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
  /** Subscription state from the accounts table. Mirrors Stripe's
   *  subscription status. `"none"` means no active Company subscription;
   *  `"active"` is the standard monthly billing state. `"trialing"` is a
   *  legacy state — new subs ship with no trial period (first month is
   *  $19 via coupon, then $49/mo). Only grandfathered customers from the
   *  pre-coupon dual-product setup can still be in `"trialing"`. */
  subscription_status?: string;
  subscription_plan?: string;
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

// Blueprints — a pre-threaded bundle of seed agents / events / ideas /
// quests that spawns a ready-to-go company. Optional fields stay loose
// so a sparse Blueprint (no seed quests, no seed events) still renders
// cleanly.
export interface BlueprintSeedAgent {
  name: string;
  tagline?: string;
  role?: string;
  identity?: string;
  system_prompt?: string;
  model?: string;
  color?: string;
}

export interface BlueprintSeedEvent {
  pattern: string;
  name?: string;
  description?: string;
}

export interface BlueprintSeedIdea {
  name: string;
  tags?: string[];
  summary?: string;
}

export interface BlueprintSeedQuest {
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

export interface BlueprintSeedRole {
  key: string;
  title: string;
  /** seed_agent name (or "root") that fills this role at spawn time;
   *  null leaves the role vacant for the operator to fill. */
  default_occupant_agent?: string | null;
}

export interface BlueprintSeedRoleEdge {
  parent: string;
  child: string;
}

/** Operator-time override of a declared role's default occupant.
 *  `role_key` must match a `seed_roles[].key` in the template. The
 *  occupant variants mirror the runtime `OccupantKind`: `agent` swaps
 *  the default occupant for a different seed_agent (by name); `human`
 *  slots a user as the occupant; `vacant` leaves the role empty. */
export type RoleOverrideOccupant =
  | { kind: "agent"; agent: string }
  | { kind: "human"; user_id: string }
  | { kind: "vacant" };

export interface RoleOverride {
  role_key: string;
  occupant: RoleOverrideOccupant;
}

export type BlueprintCategory = "company" | "foundation" | "fund";
export type BlueprintTemplate = "entity" | "venture" | "foundation" | "fund";

/** Single-company blueprint — spawns one TRUST + runtime entity. */
export interface SingleBlueprint {
  kind?: "single";
  /** Opaque blueprint identifier used for launch/setup routes. Mirrors the
   *  shipped slug for v1 presets; future catalogs can decouple this from the
   *  human-readable slug without changing the UI contract. */
  id?: string;
  slug: string;
  name: string;
  tagline?: string;
  description?: string;
  /** User-facing display category. What the user picks: company | foundation | fund. */
  category?: BlueprintCategory;
  /** On-chain template slug registered on the Factory. Immutable once deployed.
   *  company blueprints map to entity or venture; foundation → foundation; fund → fund. */
  template?: BlueprintTemplate;
  tags?: string[];
  root?: RootAgentSpec;
  seed_agents?: BlueprintSeedAgent[];
  seed_events?: BlueprintSeedEvent[];
  seed_ideas?: BlueprintSeedIdea[];
  seed_quests?: BlueprintSeedQuest[];
  /** Declared role structure. When present, the org-chart preview
   *  reads from here; when absent, falls back to the implicit
   *  root → flat seed_agents shape. Declared roles must mirror the
   *  agent tree 1:1 to keep the preview honest with what spawns. */
  seed_roles?: BlueprintSeedRole[];
  seed_role_edges?: BlueprintSeedRoleEdge[];
}

/** One company slot within a StackBlueprint. */
export interface StackComponent {
  slot: string;
  blueprint_id: string;
  display_name_default: string;
}

/** Cross-company directed edge within a stack. */
export interface StackEdge {
  from_slot: string;
  to_slot: string;
  relationship: StackRelationship;
}

export type StackRelationship =
  | { type: "token_ownership"; percent_bps: number }
  | { type: "role_assignment"; role_type: string }
  | { type: "treasury_flow"; amount_usd: number; schedule_seconds: number };

/** Multi-company stack blueprint — spawns N TRUSTs + cross-company edges. */
export interface StackBlueprint {
  kind: "stack";
  id: string;
  name: string;
  tagline: string;
  description: string;
  umbrella_slot?: string;
  component_count: number;
  edge_count: number;
  components: StackComponent[];
}

/** Union discriminator: single-company blueprint or multi-company stack. */
export type Blueprint = SingleBlueprint | StackBlueprint;

/** Narrow to single blueprint — use on routes that only handle `kind:"single"`. */
export function isSingleBlueprint(bp: Blueprint): bp is SingleBlueprint {
  return !bp.kind || bp.kind === "single";
}

/** Narrow to stack blueprint. */
export function isStackBlueprint(bp: Blueprint): bp is StackBlueprint {
  return bp.kind === "stack";
}

/** Per-component outcome from POST /api/start/stack. */
export interface StackComponentOutcome {
  slot: string;
  entity_id: string;
  trust_id_hex?: string;
  trust_address?: string;
  status: "ok" | "failed";
  error?: string;
}

/** Per-edge outcome from POST /api/start/stack. */
export interface StackEdgeOutcome {
  from_slot: string;
  to_slot: string;
  relationship_type: string;
  status: "ok" | "skipped" | "failed";
  error?: string;
}

/** Full response from POST /api/start/stack. */
export interface StackProvisionResult {
  ok: boolean;
  stack_id: string;
  components: StackComponentOutcome[];
  edge_results: StackEdgeOutcome[];
}

export type OccupantKind = "human" | "agent" | "vacant";

export type RoleType = "director" | "operational" | "advisor";

/** A single org-chart slot inside an entity. Occupant is a human, an
 *  agent, or vacant ("we're hiring"). Authority is resolved by transitive
 *  closure over `RoleEdge` (DAG, not tree). */
export interface Role {
  id: string;
  entity_id: string;
  title: string;
  occupant_kind: OccupantKind;
  occupant_id: string | null;
  /** Display name for a human occupant, injected by the platform proxy.
   *  Null when the occupant is an agent, vacant, or the user record is
   *  not found. Prefer this over deriving a name from `occupant_id`. */
  occupant_name?: string | null;
  /** Avatar URL for a human occupant, injected by the platform proxy.
   *  Null when the occupant is an agent, vacant, or the user has no photo. */
  occupant_avatar_url?: string | null;
  role_type: RoleType;
  founder: boolean;
  grants: string[];
  created_at: string;
  updated_at?: string | null;
}

export interface RoleEdge {
  parent_role_id: string;
  child_role_id: string;
}

export interface RoleInvitation {
  token: string;
  entity_id: string;
  role_id: string;
  inviter_user_id: string;
  target_kind: "email" | "slug" | "open";
  target_email: string | null;
  target_entity_id: string | null;
  welcome_note: string | null;
  created_at: string;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by_user_id: string | null;
  declined_at: string | null;
  /** `false` for invitations created with skip_email=true (seed/dry-run). */
  email_sent: boolean;
}

/** Public invitation detail — returned by GET /api/invitations/:token.
 *  Note: entity_id is NOT in the platform response; entity_display_name is.
 *  role_id is included for cross-referencing. */
export interface InvitationDetail {
  token: string;
  role_title?: string;
  role_id: string;
  entity_id?: string;
  entity_display_name: string;
  inviter_name: string;
  target_kind?: "email" | "slug" | "open";
  target_email: string | null;
  welcome_note: string | null;
  expires_at: string;
  status: "pending" | "redeemed" | "declined" | "expired";
}
