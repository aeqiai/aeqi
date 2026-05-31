import type { QuestMetadata, QuestRuntime } from "./runtime";

/**
 * Single-variant alias for the on-the-wire `type` field on a Company.
 * Legacy payloads used `"company"`; the UI normalizes current payloads to
 * `"company"` at the API boundary.
 */
export type CompanyType = "company";

export interface Company {
  id: string;
  name: string;
  type: CompanyType;
  status: "active" | "paused" | "archived";
  avatar?: string;
  color?: string;
  budget_usd?: number;
  created_at: string;
  last_active?: string;
  /** On-chain COMPANY identity (bytes32 hex). NULL until COMPANY bridge fires. */
  company_id?: string;
  /** On-chain COMPANY proxy address. NULL until indexer-confirmed. */
  company_address?: string;
  /** Public website slug. When present, `https://<slug>.aeqi.ai/` is the public site. */
  slug?: string;
  /** Canonical company email identity, usually `hello@<slug>.aeqi.ai`. */
  email_address?: string;
  /** EOA that created this Company's on-chain COMPANY mirror. */
  creator_address?: string;
  /** Default agent UUID for this company. Surfaced by the platform's
   *  `/api/companies` payload as `agent_id` so company-scoped surfaces (`/me/*`,
   *  AgentPage) can resolve the entry agent without an entity-scoped fetch. */
  agent_id?: string;
  /** Placement type — `"host"`, `"sandbox"`, `"vps"`, or `"unknown"`. */
  placement_type?: string;
  /** One-line description rendered in the entity hero strip on Overview. */
  tagline?: string;
  /** When true, the company's public subdomain returns a public website. */
  public?: boolean;
  /** Organization billing plan ID (`starter` for Standard, `growth` for Pro). */
  plan?: string;
  /** Current platform-side provisioning status for the placement. */
  placement_status?: string;
  /** Launch-progress state exposed while a new organization is being provisioned. */
  launch_state?: string;
  /** Launch-progress error exposed if provisioning fails. */
  launch_error?: string;
}

export interface CapTableEntry {
  id: string;
  company_id: string;
  allocation_key: string;
  holder_kind: string;
  holder_id?: string | null;
  security_type: string;
  basis_points: number;
  vesting_months?: number | null;
  cliff_months?: number | null;
  created_at: string;
}

export type EntityViewKind = "route" | "dashboard";
export type EntityViewScope = "private" | "public";
export type EntityViewWidgetKind =
  | "identity"
  | "sessions"
  | "agents"
  | "quests"
  | "ideas"
  | "apps"
  | "events"
  | "economy"
  | "website";

export interface EntityViewLayout {
  widgets?: EntityViewWidgetKind[];
  [key: string]: unknown;
}

export interface EntityView {
  id: string;
  company_id: string;
  owner_user_id?: string | null;
  key: string;
  label: string;
  kind: EntityViewKind;
  scope: EntityViewScope;
  path?: string | null;
  search?: string | null;
  layout_json?: EntityViewLayout | null;
  pinned: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface EntityViewUpsert {
  id?: string;
  key: string;
  label: string;
  kind?: EntityViewKind;
  scope?: EntityViewScope;
  path?: string | null;
  search?: string | null;
  layout_json?: EntityViewLayout | null;
  pinned?: boolean;
  sort_order?: number;
}

export interface Agent {
  id: string;
  name: string;
  company_id?: string | null;
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

export type QuestStatus = "backlog" | "todo" | "in_progress" | "in_review" | "done" | "cancelled";
export type QuestPriority = "critical" | "high" | "normal" | "low";

export interface QuestOutcome {
  /** Current minimum terminal outcome contract; see docs/quest-evidence-contract.md. */
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
  project?: string;
  /**
   * Structural identity. Canonical: 'task' (default — atomic claimable work)
   * or 'project' (container of sub-Quests + retrospective on completion).
   * Custom kinds may use a 'custom:<name>' prefix. See
   * architecture/kind-taxonomy-and-the-structural-vs-categorical-rule.
   */
  kind?: string;
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
  metadata?: QuestMetadata;
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
  // Kind taxonomy (Phase 1 of ae-002). Canonical: 'note' (default), 'file', 'goal'.
  // Open enum — `custom:<name>` allowed for company-specific kinds.
  // See architecture/kind-taxonomy-and-the-structural-vs-categorical-rule.
  kind?: string;
  // When kind='file', binary blob row id in the orchestrator's files table.
  file_id?: string | null;
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

export interface ActivityEntryMetadata {
  /** Project / root entity attribution surfaced as the activity-project chip. */
  root?: string;
  [key: string]: unknown;
}

export interface ActivityEntry {
  id: number;
  timestamp: string;
  created_at?: string;
  decision_type: string;
  summary: string;
  agent?: string;
  quest_id?: string;
  metadata?: ActivityEntryMetadata;
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
  /** Primary auth provider (`"google"` / `"github"` / `"email"` /
   *  `"passkey"` / `"wallet"`). Surfaced by /auth/me so the settings
   *  panel can render which provider the active session was created
   *  with. */
  provider?: string;
  /** Every auth method linked to the account, in addition to `provider`.
   *  Used by Settings/SecurityPanel to render Connect / Connected
   *  status per provider. */
  auth_methods?: Array<{ kind?: string }>;
  /** Wallet bindings — populated only by the WalletsPanel `/me`
   *  refresh path. Each row is the public wallet shape from the
   *  platform's `wallets` table. */
  wallets?: Array<Record<string, unknown>>;
  /** Subscription state from the accounts table. Mirrors Stripe's
   *  subscription status. `"none"` means no active organization
   *  subscription; `"active"` is the standard monthly billing state.
   *  `"trialing"` can appear while intro pricing is in effect or from
   *  grandfathered subscriptions. */
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
  template_id?: string | null;
  name: string;
  tagline?: string;
  role?: string;
  identity?: string;
  system_prompt?: string;
  model?: string;
  color?: string;
}

export interface BlueprintSeedEvent {
  owner?: string;
  pattern: string;
  name?: string;
  description?: string;
}

export interface BlueprintSeedIdea {
  owner?: string;
  key?: string;
  parent?: string;
  name: string;
  content?: string;
  tags?: string[];
  summary?: string;
}

export interface BlueprintSeedQuest {
  owner?: string;
  key?: string;
  parent?: string;
  subject: string;
  description?: string;
  priority?: string;
  labels?: string[];
}

export interface BlueprintSeedView {
  key: string;
  label: string;
  /** Absolute route or entity-relative path, e.g. "sessions". */
  path: string;
  /** Optional query string. May include the leading "?". */
  search?: string;
  /** When true, the shell should install the view into the pinned set. */
  pinned?: boolean;
}

export interface AgentTemplate {
  id: string;
  name: string;
  tagline?: string;
  role?: string;
  model?: string;
  color?: string;
  avatar?: string;
  system_prompt?: string;
  seed_events?: BlueprintSeedEvent[];
  seed_ideas?: BlueprintSeedIdea[];
  seed_quests?: BlueprintSeedQuest[];
}

export interface DefaultAgentSpec {
  name: string;
  model?: string;
  color?: string;
  avatar?: string;
  system_prompt?: string;
}

export interface BlueprintSeedRole {
  key: string;
  title: string;
  /** seed_agent name (or "default") that fills this role at spawn time;
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

/** Single-company blueprint — spawns one COMPANY + runtime entity. */
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
  root?: DefaultAgentSpec;
  agent_template_refs?: Array<{
    id: string;
    owner?: string;
    name?: string;
    role?: string;
  }>;
  seed_views?: BlueprintSeedView[];
  seed_agents?: BlueprintSeedAgent[];
  seed_events?: BlueprintSeedEvent[];
  seed_ideas?: BlueprintSeedIdea[];
  seed_quests?: BlueprintSeedQuest[];
  /** Declared role structure. When present, the org-chart preview
   *  reads from here; when absent, falls back to one default role plus
   *  flat seed_agents. Role edges carry hierarchy; agents are occupants. */
  seed_roles?: BlueprintSeedRole[];
  seed_role_edges?: BlueprintSeedRoleEdge[];
}

/** Union discriminator: single-company blueprint. */
export type Blueprint = SingleBlueprint;

/** Narrow to single blueprint — use on routes that only handle `kind:"single"`. */
export function isSingleBlueprint(bp: Blueprint): bp is SingleBlueprint {
  return !bp.kind || bp.kind === "single";
}

export type OccupantKind = "human" | "agent" | "company" | "vacant";

/**
 * Role tier in the three-tier authority model.
 *
 *   "owner"       — Ownership rights only. Holds equity, distributions,
 *                   and reserved votes; does not operate. NEW 2026-05-20
 *                   under the Owners/Directors/Operators pivot; backend
 *                   schema work outstanding (see
 *                   .observations/roles-iteration/DECISION-three-tier-role-model.md).
 *   "director"    — Constitutional bridge: holds ownership AND operations
 *                   rights, governs the boundary between them.
 *   "operational" — Operator. Operations rights only — executes work
 *                   within delegated limits. (Wire value stays
 *                   "operational"; UI renders "Operator".)
 *   "advisor"     — Read-only legacy tier. Slated for retirement once the
 *                   Owner migration ships.
 */
export type RoleType = "owner" | "director" | "operational" | "advisor";

/** A single org-chart slot inside an entity. Occupant is a human, an
 *  agent, or vacant ("we're hiring"). Authority is resolved by transitive
 *  closure over `RoleEdge` (DAG, not tree). */
export interface Role {
  id: string;
  company_id: string;
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
  /** Latest human account activity known to the platform proxy.
   *  Null when the occupant is an agent, vacant, or the user record is
   *  not available in the accounts database. */
  occupant_last_active?: string | null;
  /** Idea ID of this role's charter — the canonical "what this role
   *  can decide, execute, or delegate" document. Surfaces in the
   *  RoleInspector Mandate section as a clickable chip linking to the
   *  idea detail page. Null when the role has no charter yet. */
  description_idea_id?: string | null;
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
  company_id: string;
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
 *  Note: company_id is NOT in the platform response; entity_display_name is.
 *  role_id is included for cross-referencing. */
export interface InvitationDetail {
  token: string;
  role_title?: string;
  role_id: string;
  company_id?: string;
  entity_display_name: string;
  inviter_name: string;
  target_kind?: "email" | "slug" | "open";
  target_email: string | null;
  welcome_note: string | null;
  expires_at: string;
  status: "pending" | "redeemed" | "declined" | "expired";
}
