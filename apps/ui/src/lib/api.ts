import { ApiError, apiRequest as request, RateLimitedError } from "@/api/client";
import type { AppMode } from "@/lib/appMode";
import type { LaunchPlanId } from "@/lib/pricing";
import type {
  Agent,
  AgentEvent,
  AgentTemplate,
  Blueprint,
  EventInvocationRow,
  Idea,
  InferenceCallRow,
  InvitationDetail,
  InvocationStepRow,
  OccupantKind,
  Role,
  RoleEdge,
  RoleInvitation,
  RoleOverride,
  RoleType,
  Quest,
  ScopeValue,
  User,
} from "@/lib/types";
import type { AllowedChat } from "@/api/channels";
export { RateLimitedError };

export const api = {
  getAuthMode: () =>
    request<{
      app_mode?: AppMode;
      mode: string;
      google_oauth: boolean;
      github_oauth: boolean;
      waitlist: boolean;
    }>("/auth/mode"),

  login: (secret: string) =>
    request<{ ok: boolean; token: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ secret }),
    }),

  loginWithEmail: (email: string, password: string) =>
    request<{
      ok: boolean;
      token: string;
      user?: Record<string, unknown>;
      pending_verification?: boolean;
      pending_2fa?: boolean;
      email?: string;
    }>("/auth/login/email", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  requestLoginCode: (email: string) =>
    request<{ ok: boolean }>("/auth/login/code/request", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  consumeLoginCode: (email: string, code: string) =>
    request<{ ok: boolean; token: string; user?: Record<string, unknown> }>(
      "/auth/login/code/consume",
      {
        method: "POST",
        body: JSON.stringify({ email, code }),
      },
    ),

  consumeMagicLink: (token: string) =>
    request<{ ok: boolean; token: string; user?: Record<string, unknown> }>(
      "/auth/login/magic/consume",
      {
        method: "POST",
        body: JSON.stringify({ token }),
      },
    ),

  signup: (
    email: string,
    password: string,
    name: string,
    inviteCode?: string,
    invitationToken?: string,
  ) =>
    request<{
      ok: boolean;
      token: string;
      user?: Record<string, unknown>;
      pending_verification?: boolean;
      invitation_token?: string;
    }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify({
        email,
        password,
        name,
        invite_code: inviteCode,
        ...(invitationToken ? { invitation_token: invitationToken } : {}),
      }),
    }),

  joinWaitlist: (email: string, honeypot: string = "") =>
    request<{ ok: boolean; message: string }>("/auth/waitlist", {
      method: "POST",
      body: JSON.stringify({ email, _hp: honeypot }),
    }),

  checkInviteCode: (code: string) =>
    request<{ ok: boolean; valid: boolean }>("/auth/invite/check", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  getInviteCodes: () =>
    request<{ ok: boolean; codes: Array<{ code: string; used: boolean }> }>("/auth/invite-codes"),

  createInviteCode: () =>
    request<{ ok: boolean; code: string }>("/auth/invite-codes", { method: "POST" }),

  getAdminOverview: () =>
    request<{
      ok: boolean;
      users: Array<Record<string, unknown>>;
      placements: Array<Record<string, unknown>>;
      invite_codes: Array<Record<string, unknown>>;
      waitlist: Array<Record<string, unknown>>;
      health?: Record<string, unknown>;
    }>("/admin/overview"),

  getMe: () => request<User>("/auth/me"),

  deleteAccount: () => request<{ ok: boolean }>("/auth/delete-account", { method: "DELETE" }),

  setupTotp: () => request<Record<string, unknown>>("/auth/totp/setup", { method: "POST" }),

  verifyTotp: (code: string) =>
    request<Record<string, unknown>>("/auth/totp/verify", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  loginTotp: (email: string, code: string) =>
    request<Record<string, unknown>>("/auth/totp/login", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }),

  disableTotp: (password: string, code: string) =>
    request<{ ok: boolean }>("/auth/totp/disable", {
      method: "POST",
      body: JSON.stringify({ password, code }),
    }),

  getActivity: () => request<Record<string, unknown>>("/auth/activity"),

  getAuthSessions: () => request<Record<string, unknown>>("/auth/sessions"),

  revokeAuthSession: (jti: string) =>
    request<{ ok: boolean }>("/auth/sessions/revoke", {
      method: "POST",
      body: JSON.stringify({ jti }),
    }),

  revokeOtherAuthSessions: () =>
    request<{ ok: boolean; revoked: number }>("/auth/sessions/revoke-others", {
      method: "POST",
    }),

  updateAvatar: (dataUrl: string) =>
    request<{ ok: boolean }>("/auth/update-avatar", {
      method: "POST",
      body: JSON.stringify({ avatar: dataUrl }),
    }),

  updateProfile: (first_name: string, last_name: string, phone: string) =>
    request<{ ok: boolean }>("/auth/update-profile", {
      method: "POST",
      body: JSON.stringify({ first_name, last_name, phone }),
    }),

  updatePhishingCode: (code: string) =>
    request<{ ok: boolean }>("/auth/phishing-code", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  changePassword: (current_password: string, new_password: string) =>
    request<{ ok: boolean }>("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password, new_password }),
    }),

  verifyEmail: (email: string, code: string) =>
    request<{ ok: boolean; token: string; user?: Record<string, unknown> }>("/auth/verify", {
      method: "POST",
      body: JSON.stringify({ email, code }),
    }),

  resendCode: (email: string) =>
    request<{ ok: boolean }>("/auth/resend-code", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  forgotPassword: (email: string) =>
    request<{ ok: boolean }>("/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: boolean }>("/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  getDashboard: () => request<Record<string, unknown>>("/dashboard"),

  getStatus: () => request<Record<string, unknown>>("/status"),

  getActivityEvents: (params?: { cursor?: number }) => {
    const query = new URLSearchParams();
    if (params?.cursor != null) query.set("cursor", String(params.cursor));
    const qs = query.toString();
    return request<Record<string, unknown>>(`/activity/events${qs ? `?${qs}` : ""}`);
  },

  getTrusts: () => request<Record<string, unknown>>("/trusts"),
  createTrust: (data: { name: string; tagline?: string; prefix?: string }) =>
    request<Record<string, unknown>>("/trusts", { method: "POST", body: JSON.stringify(data) }),
  getEntities: () => request<Record<string, unknown>>("/trusts"),
  createEntity: (data: { name: string; tagline?: string; prefix?: string }) =>
    request<Record<string, unknown>>("/trusts", { method: "POST", body: JSON.stringify(data) }),
  updateEntity: (
    name: string,
    data: {
      name?: string;
      tagline?: string;
      logo_url?: string;
      public?: boolean;
    },
  ) =>
    request<{ ok: boolean }>(`/trusts/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({
        ...data,
        ...(data.name ? { new_name: data.name } : {}),
      }),
    }),

  // Roles — the org-chart primitive. Returns the full set of roles +
  // edges for the entity so the caller can render either a flat list or
  // a DAG.
  getRoles: async (trustId: string) => {
    const r = await request<{
      ok: boolean;
      roles: Role[];
      edges: RoleEdge[];
    }>(`/roles?trust_id=${encodeURIComponent(trustId)}`);
    return {
      ok: r.ok,
      roles: r.roles,
      edges: r.edges,
    };
  },

  getRole: (roleId: string) =>
    request<{ ok: boolean; role: Role }>(`/roles/${encodeURIComponent(roleId)}`),

  createRole: (data: {
    trust_id: string;
    title: string;
    occupant_kind: OccupantKind;
    occupant_id?: string;
    parent_role_id?: string;
    role_type?: RoleType;
    grants?: string[];
  }) => {
    const wire = {
      trust_id: data.trust_id,
      title: data.title,
      occupant_kind: data.occupant_kind,
      ...(data.occupant_id ? { occupant_id: data.occupant_id } : {}),
      ...(data.parent_role_id ? { parent_role_id: data.parent_role_id } : {}),
      ...(data.role_type ? { role_type: data.role_type } : {}),
      ...(data.grants ? { grants: data.grants } : {}),
    };
    return request<{ ok: boolean; role: Role }>("/roles", {
      method: "POST",
      body: JSON.stringify(wire),
    });
  },

  updateRole: (roleId: string, patch: { title?: string; role_type?: string; grants?: string[] }) =>
    request<{ ok: boolean }>(`/roles/${encodeURIComponent(roleId)}/update`, {
      method: "POST",
      body: JSON.stringify(patch),
    }),

  archiveRole: (roleId: string) =>
    request<{ ok: boolean }>(`/roles/${encodeURIComponent(roleId)}/archive`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  assignRoleOccupant: (
    roleId: string,
    data: { occupant_kind: OccupantKind; occupant_id?: string },
  ) =>
    request<{ ok: boolean }>(`/roles/${encodeURIComponent(roleId)}/occupant`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getUserGrants: (trustId: string, userId: string) =>
    request<{ ok: boolean; grants: string[] }>(
      `/roles/grants?trust_id=${encodeURIComponent(trustId)}&user_id=${encodeURIComponent(userId)}`,
    ),

  // Invitation endpoints — platform-side, no trust scope in the path
  // for the public-facing ones.
  createRoleInvitation: (
    trustId: string,
    roleId: string,
    data: {
      target_kind: "email" | "slug" | "open";
      target_email?: string;
      target_entity_id?: string;
      welcome_note?: string;
    },
  ) =>
    request<{ ok: boolean; invitation: RoleInvitation }>(
      `/trusts/${encodeURIComponent(trustId)}/roles/${encodeURIComponent(roleId)}/invitations`,
      { method: "POST", body: JSON.stringify(data) },
    ),

  listEntityInvitations: (trustId: string) =>
    request<{ ok: boolean; invitations: RoleInvitation[] }>(
      `/trusts/${encodeURIComponent(trustId)}/invitations`,
    ),

  getInvitation: (token: string) =>
    request<{ ok: boolean; invitation: InvitationDetail }>(
      `/invitations/${encodeURIComponent(token)}`,
    ),

  acceptInvitation: (token: string, asEntityId: string) =>
    request<{ ok: boolean }>(`/invitations/${encodeURIComponent(token)}/accept`, {
      method: "POST",
      body: JSON.stringify({ as_entity_id: asEntityId }),
    }),

  declineInvitation: (token: string) =>
    request<{ ok: boolean }>(`/invitations/${encodeURIComponent(token)}/decline`, {
      method: "POST",
      body: JSON.stringify({}),
    }),

  getDirectedEntities: () =>
    request<{ ok: boolean; entities: Array<{ trust_id: string; display_name: string }> }>(
      `/me/directed-entities`,
    ),

  getQuests: (params?: { status?: string; root?: string }) => {
    const query = new URLSearchParams();
    if (params?.status) query.set("status", params.status);
    if (params?.root) query.set("root", params.root);
    const qs = query.toString();
    return request<{ ok: boolean; quests: Quest[] }>(`/quests${qs ? `?${qs}` : ""}`);
  },

  getAgents: (params?: { root?: boolean }) =>
    request<{ ok: boolean; agents: Agent[] }>(params?.root ? "/agents?root=true" : "/agents"),

  getAgentRecentInferenceCalls: (agentId: string, limit?: number) => {
    const qs = limit ? `?limit=${limit}` : "";
    return request<{ ok: boolean; calls?: InferenceCallRow[]; error?: string }>(
      `/agents/${encodeURIComponent(agentId)}/inference-calls${qs}`,
    );
  },

  getActivityStream: (params?: { last?: number; root?: string }) => {
    const query = new URLSearchParams();
    if (params?.last) query.set("last", String(params.last));
    if (params?.root) query.set("root", params.root);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/activity${qs ? `?${qs}` : ""}`);
  },

  getExpertise: (domain?: string) => {
    const query = new URLSearchParams();
    if (domain) query.set("domain", domain);
    const qs = query.toString();
    return request<Record<string, unknown>>(`/expertise${qs ? `?${qs}` : ""}`);
  },

  getCost: () => request<Record<string, unknown>>("/cost"),

  getIdeas: (params?: { root?: string; query?: string; limit?: number; agent_id?: string }) => {
    const q = new URLSearchParams();
    if (params?.root) q.set("root", params.root);
    if (params?.query) q.set("query", params.query);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.agent_id) q.set("agent_id", params.agent_id);
    const qs = q.toString();
    return request<Record<string, unknown>>(`/ideas${qs ? `?${qs}` : ""}`);
  },

  getSkills: () => request<Record<string, unknown>>("/ideas/search?tags=skill"),

  // Agent Channels — typed connector config, first-class rows in the
  // `channels` table. `config` is a tagged enum validated server-side.
  getAgentChannels: (agentId: string) =>
    request<Record<string, unknown>>(`/agents/${encodeURIComponent(agentId)}/channels`),
  createAgentChannel: (params: {
    agent_id: string;
    config: Record<string, unknown> & { kind: string };
  }) =>
    request<Record<string, unknown>>(`/agents/${encodeURIComponent(params.agent_id)}/channels`, {
      method: "POST",
      body: JSON.stringify({ config: params.config }),
    }),
  updateAgentChannel: (params: {
    agent_id: string;
    config: Record<string, unknown> & { kind: string };
  }) =>
    // Upsert replaces the existing row for (agent_id, kind).
    request<Record<string, unknown>>(`/agents/${encodeURIComponent(params.agent_id)}/channels`, {
      method: "POST",
      body: JSON.stringify({ config: params.config }),
    }),
  // Tenancy is resolved server-side from the row's owner — no agent_id body.
  deleteAgentChannel: (id: string) =>
    request<Record<string, unknown>>(`/channels/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  // Replace the channel's allowed_chats whitelist. Empty array = no
  // restriction. Writes to the dedicated `channel_allowed_chats` table —
  // does not touch the config blob. Each entry carries a `reply_allowed`
  // flag: `true` = auto-reply, `false` = read-only (receive but stay silent).
  // The IPC accepts either the legacy `string[]` or the typed shape; we
  // always send the typed shape going forward.
  setChannelAllowedChats: (id: string, chats: AllowedChat[]) =>
    request<Record<string, unknown>>(`/channels/${encodeURIComponent(id)}/allowed-chats`, {
      method: "PATCH",
      body: JSON.stringify({ chat_ids: chats }),
    }),
  // WhatsApp Baileys pairing: poll for QR + connection state. Returns
  // `{ status: null }` while the gateway task hasn't registered yet
  // (e.g., daemon just restarted).
  getChannelBaileysStatus: (id: string) =>
    request<{
      ok: boolean;
      status: null | {
        state: "spawning" | "connecting" | "awaiting_qr" | "ready" | "disconnected";
        qr: string | null;
        qr_data_url: string | null;
        last_reason: string | null;
        me: string | null;
      };
    }>(`/channels/${encodeURIComponent(id)}/baileys-status`),
  // Force-disconnect a Baileys channel and wipe its auth state on disk.
  // The user will need to re-scan a QR before it sends/receives again.
  logoutChannelBaileys: (id: string) =>
    request<{ ok: boolean; logged_out?: boolean }>(
      `/channels/${encodeURIComponent(id)}/baileys-logout`,
      { method: "POST" },
    ),
  getChannelSessions: (agentId: string) =>
    request<Record<string, unknown>>(`/channel-sessions?agent_id=${encodeURIComponent(agentId)}`),
  // Idea CRUD, graph, and edges live in `@/api/ideas`.

  getAgentIdentity: (name: string) => request<Record<string, unknown>>(`/agents/${name}/identity`),
  saveAgentFile: (name: string, filename: string, content: string) =>
    request<{ ok: boolean }>(`/agents/${name}/files`, {
      method: "POST",
      body: JSON.stringify({ filename, content }),
    }),

  getRateLimit: () => request<Record<string, unknown>>("/rate-limit"),

  getHealth: () => request<{ ok: boolean }>("/health"),

  createQuest: (data: {
    project: string;
    /**
     * Phase-2 unification: prefer one of the two `idea*` shapes over the
     * legacy `subject`/`description` flow.
     *
     *   • `idea: { name, content, scope?, agent_id?, tags? }` — Flow A
     *     mints a fresh idea row, then wraps a quest around it.
     *   • `idea_id: "..."` — Flow B wraps an existing idea.
     */
    idea?: {
      name: string;
      content?: string;
      scope?: string;
      agent_id?: string;
      tags?: string[];
    };
    idea_id?: string;
    /** Legacy. Subject/description are used only when idea/idea_id are absent. */
    subject?: string;
    description?: string;
    priority?: string;
    scope?: string;
    parent?: string;
    acceptance_criteria?: string;
    agent_id?: string;
    agent?: string;
  }) =>
    request<{ ok: boolean; quest: Quest; idea?: Idea; error?: string }>("/quests", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  createQuestPreset: (
    kind: "feature-dev" | "bug-fix" | "refactor",
    data: {
      subject: string;
      project: string;
      agent?: string;
      agent_id?: string;
      symptom?: string;
      motivation?: string;
    },
  ) =>
    request<Record<string, unknown>>(`/quests/presets/${kind}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  updateQuest: (
    id: string,
    data: {
      description?: string;
      status?: string;
      priority?: string;
      labels?: string[];
      agent_id?: string;
      /** Polymorphic. `agent:<id>` / `user:<id>` / `null` (unassign). */
      assignee?: string | null;
      scope?: string;
      /** RFC3339 UTC string to set, or `null` to clear the due-date. Omit
       * to leave unchanged. Phase-2 due_at column. */
      due_at?: string | null;
    },
  ) =>
    request<{ ok: boolean }>(`/quests/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  closeQuest: (id: string, data?: { reason?: string; root?: string }) =>
    request<{ ok: boolean }>(`/quests/${id}/close`, {
      method: "POST",
      body: JSON.stringify(data ? { reason: data.reason, root: data.root } : {}),
    }),

  // Assembles the system prompt without creating the quest — used by the
  // composer to preview what the agent will see before commit.
  questPreflight: (data: { agent_id: string; description: string; task_idea_ids?: string[] }) =>
    request<{ ok: boolean; system: string; tools: { allow: string[]; deny: string[] } }>(
      "/quests/preflight",
      { method: "POST", body: JSON.stringify(data) },
    ),

  getQuest: (id: string) => request<{ ok: boolean; quest: Quest; idea?: Idea }>(`/quests/${id}`),

  getSessions: (agentId?: string) => {
    const q = new URLSearchParams();
    if (agentId) q.set("agent_id", agentId);
    const qs = q.toString();
    return request<Record<string, unknown>>(`/sessions${qs ? `?${qs}` : ""}`);
  },
  createSession: (agentId: string) =>
    request<Record<string, unknown>>("/sessions", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId }),
    }),
  sendSessionMessage: (data: {
    message: string;
    agent?: string;
    agent_id?: string;
    session_id?: string;
    session_ideas?: string[];
    quest_id?: string;
    files?: Array<{ name: string; content: string }>;
  }) =>
    request<Record<string, unknown>>("/sessions/send", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Blueprints — pre-threaded company bundles. Spawn creates an entity
  // backed by a root agent today and returns the canonical entity id.
  getBlueprints: () =>
    request<{ ok: boolean; blueprints: Blueprint[]; agent_templates?: AgentTemplate[] }>(
      "/blueprints",
    ),

  // Full Template including seed_agents/events/ideas/quests arrays. The
  // list endpoint returns counts only to keep the catalog payload small;
  // the detail endpoint is what the store calls when a card is selected.
  getBlueprint: (blueprintId: string) =>
    request<{ ok: boolean; blueprint: Blueprint }>(
      `/blueprints/${encodeURIComponent(blueprintId)}`,
    ),

  // Resolves the operator-configured default Blueprint
  // (`[blueprints] default` in aeqi.toml).
  getDefaultBlueprint: () => request<{ ok: boolean; blueprint: Blueprint }>("/blueprints/default"),

  /** `role_overrides` lets the operator stage occupants before the spawn
   *  commits — swap a default agent for themselves (human), or leave a
   *  role vacant. Each override targets a `role_key` declared in the
   *  template's `seed_roles`. Unknown keys silently warn server-side. */
  spawnBlueprint: (data: {
    blueprint: string;
    display_name?: string;
    role_overrides?: RoleOverride[];
  }) =>
    request<{ ok: boolean; trust_id: string }>("/blueprints/spawn", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Spawn a Blueprint INTO an existing entity. Powers `+ New agent` (full
  // company merge) and Import-from-blueprint on Ideas / Quests (scoped
  // via `parts`). Server defaults to all four parts when `parts` is
  // omitted; pass e.g. `["ideas"]` to materialize only seed_ideas.
  spawnBlueprintIntoEntity: (data: { blueprint: string; trust_id: string; parts?: string[] }) =>
    request<{
      ok: boolean;
      spawned_agents: number;
      created_events: number;
      created_ideas: number;
      created_quests: number;
    }>("/blueprints/spawn-into", { method: "POST", body: JSON.stringify(data) }),

  // Platform-side launch — mints the canonical trust_id (UUID) on the
  // platform host and provisions a sandbox runtime. Only callable by users
  // with subscription_status="invited" (sandbox tier) or "active" (paid).
  // Anyone else gets 402 PAYMENT_REQUIRED — they go through Stripe via
  // createCheckoutSession instead.
  startLaunch: (data: {
    template: string;
    display_name: string;
    mission?: string;
    plan?: LaunchPlanId | string;
  }) =>
    request<{ ok: boolean; trust_id: string; display_name: string }>("/start/launch", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  checkLaunchName: (display_name: string) =>
    request<{
      ok: boolean;
      available: boolean;
      normalized_name?: string;
      reason?: string;
    }>("/start/check-name", {
      method: "POST",
      body: JSON.stringify({ display_name }),
    }),

  getLaunchStatus: (trustId: string) =>
    request<{
      ok: boolean;
      trust_id: string;
      display_name: string;
      placement_status: string;
      trust_status: string;
      trust_address: string | null;
      trust_error: string | null;
      runtime_error: string | null;
      org_lifecycle: string;
      milestones: {
        creating_trust: { reached: boolean; at: string | null };
        signing_on_solana: { reached: boolean; at: string | null };
        loading_roles: { reached: boolean; at: string | null };
        spawning_agent: { reached: boolean; at: string | null };
      };
      unifutures: {
        asset_mint: string;
        quote_mint: string;
        curve: string;
        curve_asset_vault: string;
        curve_quote_vault: string;
        buy_amount: number;
        max_cost: number;
      } | null;
    }>(`/start/launch/status/${encodeURIComponent(trustId)}`),

  tryUnifuturesFirstBuy: (data: { entity_id: string }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      buyer_pubkey_b58: string;
      buyer_asset_ta_b58: string;
      buyer_quote_ta_b58: string;
      asset_amount: number;
      max_cost: number;
    }>("/solana/first-buy", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Sell N LAUNCH back to the genesis curve. `token_amount` is in raw
   * u64 base units (matches the on-chain handler); `min_return` is the
   * slippage guard (default 0 = no slippage protection).
   *
   * 200 → CurveSellResponse with on-chain signature + tokens_sold echo.
   *   UI re-fetches getCurveState to update the marker.
   * 409 `curve_not_provisioned` → same platform-018 honesty shape.
   * 400 `token_amount must be > 0` → form-validation safety net.
   */
  curveSell: (data: { entity_id: string; token_amount: number; min_return?: number }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      seller_pubkey_b58: string;
      seller_asset_ta_b58: string;
      seller_quote_ta_b58: string;
      tokens_sold: number;
      min_return: number;
    }>("/solana/curve-sell", {
      method: "POST",
      body: JSON.stringify({ min_return: 0, ...data }),
    }),

  /**
   * Mint N LAUNCH to a recipient pubkey (placement owner only). On-chain
   * `mint_tokens` requires signer == trust.authority; platform gates via
   * placement owner. Idempotent ATA creation included.
   */
  tokenMint: (data: { entity_id: string; recipient_pubkey: string; amount: number }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      recipient_ta_b58: string;
      amount: number;
    }>("/solana/token-mint", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** Burn N LAUNCH from the caller's own ATA. */
  tokenBurn: (data: { entity_id: string; amount: number }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      burner_ta_b58: string;
      amount: number;
    }>("/solana/token-burn", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /** Transfer N LAUNCH from the caller's ATA to recipient's ATA (idempotent ATA create). */
  tokenTransfer: (data: { entity_id: string; recipient_pubkey: string; amount: number }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      from_ta_b58: string;
      to_ta_b58: string;
      amount: number;
    }>("/solana/token-transfer", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Grant a vesting position. position_id is generated server-side and
   * returned so the caller can look the position up on chain.
   * Schedule: start_time < end_time AND start_time <= cliff_time <= end_time
   * (unix-seconds i64).
   */
  vestingCreate: (data: {
    entity_id: string;
    recipient_pubkey: string;
    total_amount: number;
    start_time: number;
    cliff_time: number;
    end_time: number;
  }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      position_pubkey_b58: string;
      position_id_hex: string;
      recipient_b58: string;
      total_amount: number;
    }>("/solana/vesting-create", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * One-time per trust: allocate the BudgetModuleState PDA. Must be
   * called once before any budgetCreate against the same trust.
   * On-chain init rejects a second call with "account already in use".
   */
  budgetModuleInit: (data: { entity_id: string }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      module_state_pubkey_b58: string;
    }>("/solana/budget-module-init", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Trust authority grants a spending budget capped at `amount` against
   * a target role. `target_role_id` accepts hex (0x-prefixed 32-byte) OR
   * a free-text label which the platform hashes with keccak256.
   * `expiry = 0` means no expiry. `budget_label` similarly resolves to a
   * budget id (random if omitted).
   */
  budgetCreate: (data: {
    entity_id: string;
    target_role_id: string;
    amount: number;
    expiry?: number;
    parent_budget_id?: string | null;
    budget_label?: string;
  }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      budget_pubkey_b58: string;
      budget_id_hex: string;
      target_role_id_hex: string;
      amount: number;
    }>("/solana/budget-create", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * One-time per trust: allocate the FundingModuleState PDA. Must be
   * called before the trust is finalized (on-chain creation_mode guard).
   */
  fundingModuleInit: (data: { entity_id: string }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      module_state_pubkey_b58: string;
    }>("/solana/funding-module-init", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Declare a funding round. `kind`: 0 CommitmentSale, 1 BondingCurve,
   * 2 Exit. `budget_id` accepts hex (0x-prefixed 32-byte) OR free-text
   * label (keccak256-hashed); must reference an existing Budget PDA.
   * CommitmentSale-kind rounds require asset_amount > 0 AND
   * target_quote > 0; BondingCurve/Exit can pass 0 (their params land
   * in activation).
   */
  fundingRequestCreate: (data: {
    entity_id: string;
    kind: 0 | 1 | 2;
    budget_id: string;
    asset_amount: number;
    target_quote: number;
    request_label?: string;
  }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      request_pubkey_b58: string;
      request_id_hex: string;
      budget_id_hex: string;
      kind: number;
      asset_amount: number;
      target_quote: number;
    }>("/solana/funding-request-create", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Activate a previously-declared funding round. Three kind-specific
   * activation paths sit behind one client helper — the kind on the
   * declared FundingRequest determines which on-chain ix the platform
   * fires under the hood:
   *
   *   - kind 0 (CommitmentSale) → opens the deposit window, mints the
   *     escrow ATA at `target_quote`, accepts contributions until fill.
   *   - kind 1 (BondingCurve) → boots a NEW BondingCurve PDA (separate
   *     from the genesis curve); accepts on-chain Buy/Sell after this.
   *   - kind 2 (Exit) → opens pro-rata redemption from the treasury
   *     reserve into the activation quote token.
   *
   * Status: HONEST STUB. The platform handler does not exist yet — this
   * client surfaces a clear error pointing at the missing route name so
   * downstream sites (the Equity activate-round modal) can render an
   * accurate diagnostic rather than a generic network error.
   */
  fundingActivate: (data: { entity_id: string; request_id: string }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      request_id_hex: string;
      activation_pubkey_b58: string;
      kind: number;
    }>("/solana/funding-activate", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Claim vested tokens from a VestingPosition. `position_id` is the
   * hex-encoded 32-byte position id surfaced by `vesting-create`. The
   * platform handler validates that:
   *
   *   - `now >= cliff_time` (cliff has passed)
   *   - `vested_amount_at(now) > claimed_amount` (something to claim)
   *   - contribution gate satisfied (`contributionRequired == 0` OR
   *     `contributionPaid == true`)
   *
   * before firing the on-chain `claim_vested` ix. Returns the actual
   * amount transferred (`claimed_delta`) and the new `claimed_amount`
   * on the position.
   *
   * Status: HONEST STUB. The on-chain `claim_vested` ix EXISTS (see
   * `programs/aeqi-vesting/src/lib.rs`), but the platform-side route
   * `/api/solana/vesting-claim` does not. The client surfaces a clear
   * "route not implemented yet" error pointing at the path so the
   * Equity vesting-row Claim button can render an accurate diagnostic.
   */
  vestingClaim: (data: { entity_id: string; position_id: string }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      position_pubkey_b58: string;
      position_id_hex: string;
      claimed_delta: number;
      claimed_amount: number;
    }>("/solana/vesting-claim", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Transfer a pending vesting position to a new recipient. The on-chain
   * concept is: a position grants future tokens to a wallet that hasn't
   * fully vested yet — the recipient should be transferable (employees
   * leave, addresses rotate, ownership consolidates). The grantor (trust
   * authority) signs the rotation.
   *
   * Status: HONEST STUB. There is no `aeqi_vesting::transfer_position`
   * instruction yet — vesting positions on chain pin recipient at
   * `create_vesting_position` time and the program has no rotation path.
   * The platform-side `/api/solana/vesting-transfer` route is therefore
   * also missing. This client surface lets the UI present the right
   * gesture today; the request will fail with a clear "route not
   * implemented yet" error pointing at the path so operators see what
   * needs to ship next.
   *
   * iter-11: VestingSection wires a row-level "Transfer position" action
   * to this helper.
   */
  vestingTransfer: (data: {
    entity_id: string;
    position_id: string;
    new_recipient_pubkey: string;
  }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      position_pubkey_b58: string;
      position_id_hex: string;
      previous_recipient_b58: string;
      new_recipient_b58: string;
    }>("/solana/vesting-transfer", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Freeze a Solana on-chain budget. The on-chain `aeqi_budget::freeze`
   * instruction flips `account.frozen = true`, after which any
   * `spend_treasury` or `allocate_child_budget` call against the budget
   * is rejected by the program. Grantor (trust authority) signs.
   *
   * Status: HONEST STUB. The on-chain ix EXISTS (see
   * `programs/aeqi-budget/src/lib.rs` — `pub fn freeze`), but the
   * platform-side route `/api/solana/budget-freeze` does not. The client
   * surfaces a clear "route not implemented yet" error pointing at the
   * path so the Assets row-level Freeze button can render an accurate
   * diagnostic rather than a generic network error.
   */
  budgetFreeze: (data: { entity_id: string; budget_id: string }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      budget_pubkey_b58: string;
      budget_id_hex: string;
      frozen: boolean;
    }>("/solana/budget-freeze", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Unfreeze a previously-frozen on-chain budget. Reverses
   * `budgetFreeze`; the on-chain `aeqi_budget::unfreeze` instruction
   * flips `account.frozen = false`. Grantor (trust authority) signs.
   *
   * Status: HONEST STUB. Same shape as `budgetFreeze` above —
   * the on-chain ix exists but the platform route `/api/solana/budget-unfreeze`
   * is not implemented yet.
   */
  budgetUnfreeze: (data: { entity_id: string; budget_id: string }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      budget_pubkey_b58: string;
      budget_id_hex: string;
      frozen: boolean;
    }>("/solana/budget-unfreeze", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Allocate a child sub-budget under an existing parent budget. The
   * on-chain `aeqi_budget::allocate_child_budget` instruction creates
   * a Budget account whose `parent_budget_id` references the parent
   * and whose `amount` is debited from the parent's remaining allocation.
   *
   * Iter-8: this is a thin convenience wrapper around `budgetCreate`
   * with `parent_budget_id` set. The platform's existing `budget-create`
   * route accepts the parent reference and routes to the right on-chain
   * ix when the parent is non-zero, so we don't need a new route to
   * close the iter-7 NEXT gap. Once the platform exposes a dedicated
   * `/solana/budget-allocate-child` route with stricter parent-cap
   * accounting, this helper switches paths.
   */
  allocateChildBudget: (data: {
    entity_id: string;
    parent_budget_id: string;
    target_role_id: string;
    amount: number;
    expiry?: number;
    budget_label?: string;
  }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      budget_pubkey_b58: string;
      budget_id_hex: string;
      target_role_id_hex: string;
      amount: number;
    }>("/solana/budget-create", {
      method: "POST",
      body: JSON.stringify({
        entity_id: data.entity_id,
        target_role_id: data.target_role_id,
        amount: data.amount,
        expiry: data.expiry,
        parent_budget_id: data.parent_budget_id,
        budget_label: data.budget_label,
      }),
    }),

  /**
   * Read the live BondingCurve state for a TRUST's genesis curve. Prices
   * are u128 micro-USDC and come over the wire as decimal strings — the UI
   * caller parses to BigInt for math or renders them as labels.
   *
   * 200 → fully provisioned, full state below.
   * 409 → `curve_not_provisioned` (the platform-018 honesty contract; the
   *   chain doesn't back the derived addresses yet). UI hides the chart.
   * 403 / 404 / 503 → normal platform error shapes; treated as null below.
   */
  getCurveState: (trustId: string) =>
    request<{
      ok: true;
      trust_pubkey_b58: string;
      curve_pubkey_b58: string;
      asset_mint_b58: string;
      quote_mint_b58: string;
      creator_b58: string;
      curve_id_hex: string;
      curve_type: number;
      start_price: string;
      end_price: string;
      current_price: string;
      max_supply: number;
      current_supply: number;
      reserve_balance: string;
      reserve_ratio_ppm: number;
      proceeds_collected: string;
      // ja-017: recent trades projected by the indexer (curve_trades).
      // Up to 50 rows, ordered slot DESC. `recent_trades_unavailable`
      // flags the indexer-DB-missing case so the UI can hide trade dots
      // gracefully without losing the chart.
      recent_trades?: Array<{
        kind: "buy" | "sell";
        counterparty_b58: string;
        token_amount: string;
        quote_amount: string;
        slot: number;
        signature_b58: string;
        log_index: number;
      }>;
      recent_trades_unavailable?: boolean;
    }>(`/curves/${encodeURIComponent(trustId)}/state`),

  /**
   * Open a new proposal against a registered governance config.
   *
   * Honest stub: the platform-side handler does not exist yet. The
   * intended Solana ix is `aeqi_governance::propose` (PDA seeded
   * `[b"proposal", trust, proposal_id]`); a sibling quest owns the
   * `/api/solana/proposal-create` endpoint and the gateway → governance
   * program wire-up (anchor builder, snapshotSlot capture, IPFS pin of
   * title + description as the `ipfs_cid` field).
   *
   * For now the UI POSTs to the canonical path so the network panel
   * surfaces the call shape exactly as it will land in production. The
   * platform returns 404 with `endpoint_unimplemented` until shipped;
   * callers should treat that error code as "platform-side TBD" and
   * surface it to the operator instead of silently swallowing it.
   *
   * `governance_config_id_hex` is a 0x-prefixed 32-byte hex string
   * (the on-chain `governance_config_id` field). `vote_duration_seconds`
   * and `execution_delay_seconds` are i64 unix-second deltas; the
   * platform will compose them with `clock.unix_timestamp` to produce
   * the proposal's vote window.
   */
  proposalCreate: (data: {
    entity_id: string;
    governance_config_id_hex: string;
    title: string;
    description: string;
    vote_duration_seconds: number;
    execution_delay_seconds: number;
    /**
     * Optional pre-uploaded IPFS CID. When supplied, the platform skips
     * its own IPFS pin and writes the CID straight into the on-chain
     * `ipfs_cid` field. Pairs with `api.ipfsUpload` so the modal can
     * surface the pinned CID to the operator before the on-chain ix
     * fires — they confirm what they&apos;re committing to.
     */
    ipfs_cid?: string;
  }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      proposal_pubkey_b58: string;
      proposal_id_hex: string;
      ipfs_cid?: string;
      /** Honest TBD marker — present until the platform handler ships. */
      platform_side_tbd?: boolean;
    }>("/solana/proposal-create", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Pre-upload proposal text (title + description) to IPFS and return
   * the pinned CID. The modal calls this when the operator hits
   * "Pin payload"; the returned CID is then shown inline and passed
   * straight through to `proposalCreate` as `ipfs_cid` so the platform
   * doesn&apos;t need to re-pin.
   *
   * Honest stub: the platform-side handler does not exist yet. The
   * canonical endpoint is `/api/ipfs/pin-proposal`; the platform returns
   * 404 with `endpoint_unimplemented` until shipped. Until then the
   * modal surfaces the TBD plainly so the operator knows the pin
   * didn&apos;t actually happen, and still lets them open the proposal
   * (the platform will pin it server-side at create time as a fallback).
   *
   * The payload shape is content-first — keep it generic enough to
   * pin any proposal-like blob (title + description + arbitrary
   * metadata) without re-shaping when the platform ships.
   */
  ipfsUpload: (data: {
    entity_id: string;
    kind: "proposal" | "role-description" | "operating-agreement";
    content: { title?: string; description?: string; metadata?: Record<string, unknown> };
  }) =>
    request<{
      ok: boolean;
      cid: string;
      gateway_url: string;
      size_bytes: number;
      /** Honest TBD marker — present until the platform handler ships. */
      platform_side_tbd?: boolean;
    }>("/ipfs/pin-proposal", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Cast a vote on an open proposal.
   *
   * Honest stub: the platform-side handler does not exist yet. The
   * intended Solana ix is `aeqi_governance::cast_vote_token` (for the
   * canonical token-mode sentinel) or `cast_vote_role` (for role-mode);
   * both create a `VoteRecord` PDA per (proposal, voter) pair and bump
   * the proposal's for/against/abstain tally. A sibling quest owns the
   * `/api/solana/proposal-vote` endpoint with the Merkle proof packaging
   * for token-mode and the RoleVoteCheckpoint pickup for role-mode.
   *
   * `choice`: 0 = against, 1 = for, 2 = abstain (matches the on-chain
   * `VoteChoice` enum discriminant). The platform returns 404 with
   * `endpoint_unimplemented` until shipped; treat that as TBD.
   */
  castVote: (data: { entity_id: string; proposal_id_hex: string; choice: 0 | 1 | 2 }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      vote_record_pubkey_b58: string;
      choice: 0 | 1 | 2;
      weight: string;
      /** Honest TBD marker — present until the platform handler ships. */
      platform_side_tbd?: boolean;
    }>("/solana/proposal-vote", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Execute a proposal that has succeeded.
   *
   * Honest stub: the platform-side handler does not exist yet. The
   * intended Solana ix is `aeqi_governance::execute_proposal` — it
   * validates the vote window has ended, that quorum + support
   * thresholds are met, and flips `Proposal.executed → true`. The
   * dispatch of the proposal's actual ix payload (via `remaining_accounts`)
   * is reserved for a follow-up ship.
   *
   * The platform returns 404 with `endpoint_unimplemented` until shipped;
   * treat that as TBD.
   */
  proposalExecute: (data: { entity_id: string; proposal_id_hex: string }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      proposal_pubkey_b58: string;
      executed_at: number;
      /** Honest TBD marker — present until the platform handler ships. */
      platform_side_tbd?: boolean;
    }>("/solana/proposal-execute", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  /**
   * Cancel a proposal that has not yet been executed.
   *
   * Honest stub: the platform-side handler does not exist yet, and the
   * `aeqi_governance` program itself does not yet expose a `cancel`
   * instruction — the intent is to add one that's callable only by the
   * proposer (or a privileged role) during the `pending` and `active`
   * windows. Flips `Proposal.canceled → true`.
   *
   * The platform returns 404 with `endpoint_unimplemented` until shipped;
   * treat that as TBD.
   */
  proposalCancel: (data: { entity_id: string; proposal_id_hex: string; reason?: string }) =>
    request<{
      ok: boolean;
      signature_b58: string;
      proposal_pubkey_b58: string;
      canceled_at: number;
      /** Honest TBD marker — present until the platform handler ships. */
      platform_side_tbd?: boolean;
    }>("/solana/proposal-cancel", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  spawnAgent: (data: {
    name: string;
    template?: string;
    project?: string;
    parent_agent_id?: string;
    system_prompt?: string;
  }) =>
    request<{
      ok: boolean;
      agent: { id: string; name: string; trust_id?: string | null; status?: string };
      warnings?: string[];
    }>("/agents/spawn", { method: "POST", body: JSON.stringify(data) }),

  // Delete Agent — cascade wipes the subtree; reparent (default) promotes
  // children to the grandparent. Returns { ok, deleted, cascade } on success.
  deleteAgent: (agentId: string, opts?: { cascade?: boolean }) =>
    request<{ ok: boolean; deleted?: number; cascade?: boolean; error?: string }>(
      `/agents/${encodeURIComponent(agentId)}?cascade=${opts?.cascade ? "true" : "false"}`,
      { method: "DELETE" },
    ),

  closeSession: (sessionId: string) =>
    request<{ ok: boolean }>(`/sessions/${sessionId}/close`, { method: "POST" }),
  cancelSession: (sessionId: string) =>
    request<{ ok: boolean; cancelled: boolean }>(`/sessions/${sessionId}/cancel`, {
      method: "POST",
    }),
  isSessionActive: (sessionId: string) =>
    request<{ ok: boolean; active: boolean }>(`/sessions/${sessionId}/active`),
  forkSession: (sessionId: string, messageId: number) =>
    request<{ ok: boolean; session_id: string }>(`/sessions/${sessionId}/fork`, {
      method: "POST",
      body: JSON.stringify({ message_id: messageId }),
    }),

  setAgentModel: (agentId: string, model: string) =>
    request<{ ok: boolean }>(`/agents/${agentId}/model`, {
      method: "PUT",
      body: JSON.stringify({ model }),
    }),

  // Model catalog — provider-agnostic list for the agent model picker. Slugs
  // follow `{family}/{model-id}` (anthropic, google, deepseek, ollama, …).
  getModels: () =>
    request<{
      ok: boolean;
      models: Array<{
        id: string;
        display_name: string;
        family: string;
        tier: "free" | "cheap" | "balanced" | "premium";
        context_window: number;
        price_in: number;
        price_out: number;
        notes: string;
        recommended: boolean;
        tags: string[];
      }>;
    }>("/models"),

  setAgentTools: (agentId: string, toolDeny: string[]) =>
    request<{ ok: boolean }>(`/agents/${agentId}/tools`, {
      method: "PUT",
      body: JSON.stringify({ tool_deny: toolDeny }),
    }),

  setCanAskDirector: (agentId: string, value: boolean) =>
    request<{ ok: boolean; error?: string }>(
      `/agents/${encodeURIComponent(agentId)}/can-ask-director`,
      {
        method: "POST",
        body: JSON.stringify({ value }),
      },
    ),

  getIdeasByIds: (ids: string[]) =>
    request<{
      ok: boolean;
      ideas: Array<{
        id: string;
        name: string;
        content: string;
        tags: string[];
        agent_id?: string;
        scope?: ScopeValue;
      }>;
    }>("/ideas/by-ids", { method: "POST", body: JSON.stringify({ ids }) }),

  getAgentEvents: (agentId: string) =>
    request<Record<string, unknown>>(`/events?agent_id=${encodeURIComponent(agentId)}`),
  getEvent: (id: string) => request<{ ok: boolean; event: AgentEvent }>(`/events/${id}`),
  createEvent: (data: Record<string, unknown>) =>
    request<{ ok: boolean; event: AgentEvent }>("/events", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateEvent: (id: string, data: Record<string, unknown>) =>
    request<Record<string, unknown>>(`/events/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteEvent: (id: string) =>
    request<Record<string, unknown>>(`/events/${id}`, { method: "DELETE" }),

  triggerEvent: (
    agentRef: { agent: string } | { agent_id: string },
    pattern: string,
    extra?: Record<string, unknown>,
  ) =>
    request<{
      ok: boolean;
      agent_id: string;
      pattern: string;
      system_prompt: string;
      matched_events: Record<string, unknown>[];
    }>("/events/trigger", {
      method: "POST",
      body: JSON.stringify({ ...agentRef, pattern, ...extra }),
    }),

  listInvocations: (sessionId: string, limit = 50) =>
    request<{
      ok: boolean;
      invocations: EventInvocationRow[];
    }>(`/events/trace?session_id=${encodeURIComponent(sessionId)}&limit=${limit}`),
  listInvocationsForEvent: (eventName: string, pattern: string, limit = 50) =>
    request<{
      ok: boolean;
      invocations: EventInvocationRow[];
    }>(
      `/events/trace?event_name=${encodeURIComponent(eventName)}` +
        `&pattern=${encodeURIComponent(pattern)}&limit=${limit}`,
    ),
  getInvocationDetail: (invocationId: number) =>
    request<{
      ok: boolean;
      invocation: EventInvocationRow;
      steps: InvocationStepRow[];
    }>("/events/trace", {
      method: "POST",
      body: JSON.stringify({ invocation_id: invocationId }),
    }),

  getSessionChildren: (sessionId: string) =>
    request<Record<string, unknown>>(`/sessions/${sessionId}/children`),

  getSessionMessages: (sessionId: string, limit = 50) =>
    request<Record<string, unknown>>(`/sessions/${sessionId}/messages?limit=${limit}`),

  generateApiKey: () =>
    request<{ ok: boolean; id: string; api_key: string; rotated: boolean }>("/account/api-key", {
      method: "POST",
    }),

  getKeys: () =>
    request<{
      ok: boolean;
      keys: Array<{
        id: string;
        prefix: string;
        root: string;
        name: string;
        created_at: string;
        last_used_at: string | null;
      }>;
    }>("/keys"),

  createKey: (data: { root: string; name: string }) =>
    request<{ ok: boolean; id: string; secret_key: string }>("/keys", {
      method: "POST",
      body: JSON.stringify({ root: data.root, name: data.name }),
    }),

  revokeKey: (id: string) => request<{ ok: boolean }>(`/keys/${id}`, { method: "DELETE" }),

  // Runtime provisioning — turn a free TRUST into a paid one.
  // Backend: `aeqi-platform/src/routes/runtime.rs`.
  //
  //   POST /api/runtime/provision { trust_id, plan: "standard"|"pro" }
  //     → { ok, url, trust_id, plan }   — Stripe checkout URL.
  //   GET  /api/runtime/status?trust_id=<id>
  //     → { ok, has_runtime, plan, tier, host_active, … }
  //
  // `trust_id` here is the platform-side entity uuid (matches
  // `Trust.id` on the frontend), NOT the on-chain `trust_address`.
  provisionRuntime: (data: { trust_id: string; plan: "standard" | "pro" }) =>
    request<{ ok: boolean; url: string; trust_id: string; plan: string }>("/runtime/provision", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getRuntimeStatus: (trustId: string) =>
    request<{
      ok: boolean;
      has_runtime: boolean;
      plan: string | null;
      tier: string;
      host_active: boolean;
      placement_type: string;
      status: string;
      service_name: string | null;
    }>(`/runtime/status?trust_id=${encodeURIComponent(trustId)}`),

  // Stripe billing. Launch and resubscribe flows stamp Standard/Pro `plan`
  // metadata for provisioning and billing display.
  createCheckoutSession: (data: {
    blueprint?: string;
    // not trust_id — entity is minted post-checkout when launch resumes.
    display_name?: string;
    mission?: string;
    plan?: LaunchPlanId | string;
    launch?: boolean;
    role_overrides?: unknown[];
  }) =>
    request<{ url: string }>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({
        blueprint: data.blueprint,
        display_name: data.display_name,
        mission: data.mission,
        plan: data.plan,
        launch: data.launch,
        role_overrides: data.role_overrides,
      }),
    }),

  openBillingPortal: () => request<{ url: string }>("/billing/portal", { method: "POST" }),

  getBillingOverview: () =>
    request<{
      ok: boolean;
      total_monthly_cents: number;
      total_annual_cents: number;
      currency: string;
      payment_method_last4: string | null;
      companies: Array<{
        name: string;
        agent_id: string | null;
        plan: LaunchPlanId | string | null;
        stripe_subscription_id: string | null;
        status: "active" | "trialing" | "past_due" | "canceled";
        next_charge_at: string | null;
      }>;
    }>("/billing/overview"),

  // TODO: backend endpoint pending — used by /settings/billing per-Company actions.
  getCompanySubscription: (rootName: string) =>
    request<{
      name: string;
      plan: LaunchPlanId | string | null;
      status: string;
      stripe_subscription_id: string | null;
    }>(`/billing/companies/${encodeURIComponent(rootName)}`),

  // Notification suppression preferences (quest 67-189.2.1). Lists each
  // channel's status; stop/resume flip the binding. Today the only channel
  // exposed is `email`, keyed by the user's primary `users.email`.
  getAccountNotifications: () =>
    request<{
      ok: boolean;
      channels: Array<{ channel: string; address: string; suppressed: boolean }>;
    }>("/account/notifications"),

  stopAccountNotification: (channel: string) =>
    request<{ ok: boolean; channel: string; address: string; suppressed: boolean }>(
      "/account/notifications/stop",
      { method: "POST", body: JSON.stringify({ channel }) },
    ),

  resumeAccountNotification: (channel: string) =>
    request<{ ok: boolean; channel: string; address: string; suppressed: boolean }>(
      "/account/notifications/resume",
      { method: "POST", body: JSON.stringify({ channel }) },
    ),

  getInbox: () => request<{ ok: boolean; items: InboxItem[] }>("/inbox"),

  answerInbox: (sessionId: string, answer: string) =>
    request<{ ok: boolean; session_id?: string; error?: string }>(
      `/inbox/${encodeURIComponent(sessionId)}/answer`,
      {
        method: "POST",
        body: JSON.stringify({ answer }),
      },
    ),

  dismissInbox: (sessionId: string) =>
    request<{ ok: boolean; error?: string }>(`/inbox/${encodeURIComponent(sessionId)}/dismiss`, {
      method: "POST",
    }),

  // ── Budgets — the role-budget primitive (WS-B2 / B6 / canonical brief
  // architecture_role_budget_canonical.md). Reads require treasury.read at
  // the trust; mutations require occupant of the budget's owner role.
  // `idempotency_key` on mutations dedupes retries within an epoch.
  listBudgets: (
    trustId: string,
    filters: { ownerRoleId?: string; parentBudgetId?: string; isPrimary?: boolean } = {},
  ) => {
    const params = new URLSearchParams({ trust_id: trustId });
    if (filters.ownerRoleId) params.set("owner_role_id", filters.ownerRoleId);
    if (filters.parentBudgetId) params.set("parent_budget_id", filters.parentBudgetId);
    if (filters.isPrimary !== undefined) params.set("is_primary", String(filters.isPrimary));
    return request<{ ok: boolean; budgets: Budget[] }>(`/budgets?${params.toString()}`);
  },

  getBudget: (budgetId: string) =>
    request<{
      ok: boolean;
      budget: Budget;
      allowance: BudgetAllowance | null;
      policy: BudgetPolicy | null;
    }>(`/budgets/${encodeURIComponent(budgetId)}`),

  getBudgetTree: (trustId: string) =>
    request<{ ok: boolean; tree: { nodes: Budget[]; edges: [string, string][] } }>(
      `/budgets/tree?trust_id=${encodeURIComponent(trustId)}`,
    ),

  getBudgetAllowance: (budgetId: string) =>
    request<{ ok: boolean; allowance: BudgetAllowance | null }>(
      `/budgets/${encodeURIComponent(budgetId)}/allowance`,
    ),

  getBudgetHistory: (
    budgetId: string,
    opts: { eventType?: string; since?: string; limit?: number } = {},
  ) => {
    const params = new URLSearchParams();
    if (opts.eventType) params.set("event_type", opts.eventType);
    if (opts.since) params.set("since", opts.since);
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString() ? `?${params.toString()}` : "";
    return request<{ ok: boolean; events: TreasuryEvent[] }>(
      `/budgets/${encodeURIComponent(budgetId)}/history${qs}`,
    );
  },

  createBudget: (data: {
    trust_id: string;
    owner_role_id: string;
    name: string;
    kind?: BudgetKind;
    parent_budget_id?: string;
    as_role_id?: string;
    idempotency_key?: string;
  }) =>
    request<{ ok: boolean; budget_id?: string; code?: string; error?: string; roles?: string[] }>(
      "/budgets",
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),

  setBudgetPolicy: (
    budgetId: string,
    policy: {
      default_inference?: number;
      default_treasury?: number;
      default_suballoc?: number;
      default_hire?: number;
      epoch_period_secs?: number;
      rollover_mode?: "burn" | "rollover";
    },
    opts: { as_role_id?: string; idempotency_key?: string } = {},
  ) =>
    request<{ ok: boolean; code?: string; error?: string; roles?: string[] }>(
      `/budgets/${encodeURIComponent(budgetId)}/policy`,
      {
        method: "POST",
        body: JSON.stringify({ policy, ...opts }),
      },
    ),

  allocateBudget: (
    parentBudgetId: string,
    data: {
      child_budget_id: string;
      bundle: AllowanceBundle;
      as_role_id?: string;
      idempotency_key?: string;
    },
  ) =>
    request<{ ok: boolean; code?: string; error?: string; roles?: string[] }>(
      `/budgets/${encodeURIComponent(parentBudgetId)}/allocate`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),

  spendTreasury: (
    budgetId: string,
    data: {
      destination: string;
      amount: number;
      memo?: string;
      as_role_id?: string;
      idempotency_key?: string;
    },
  ) =>
    request<{ ok: boolean; code?: string; error?: string; roles?: string[] }>(
      `/budgets/${encodeURIComponent(budgetId)}/spend`,
      {
        method: "POST",
        body: JSON.stringify(data),
      },
    ),

  hireFromBudget: (
    parentBudgetId: string,
    data: {
      parent_role_id: string;
      new_role: {
        title: string;
        role_type?: "director" | "operational" | "advisor";
        occupant_kind?: "human" | "agent" | "trust" | "vacant";
        occupant_id?: string;
        grants?: string[];
      };
      bundle: AllowanceBundle;
      as_role_id?: string;
      idempotency_key?: string;
    },
  ) =>
    request<{
      ok: boolean;
      role_id?: string;
      primary_budget_id?: string;
      code?: string;
      error?: string;
      roles?: string[];
    }>(`/budgets/${encodeURIComponent(parentBudgetId)}/hire`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  refreshBudget: (budgetId: string) =>
    request<{ ok: boolean; allowance: BudgetAllowance | null }>(
      `/budgets/${encodeURIComponent(budgetId)}/refresh`,
      { method: "POST" },
    ),

  dissolveBudget: (budgetId: string, opts: { idempotency_key?: string } = {}) =>
    request<{ ok: boolean; code?: string; error?: string }>(
      `/budgets/${encodeURIComponent(budgetId)}/dissolve`,
      {
        method: "POST",
        body: JSON.stringify(opts),
      },
    ),

  pauseTreasury: (trustId: string, paused: boolean) =>
    request<{ ok: boolean; paused?: boolean; code?: string; error?: string; roles?: string[] }>(
      `/trusts/${encodeURIComponent(trustId)}/treasury/pause`,
      {
        method: "POST",
        body: JSON.stringify({ paused }),
      },
    ),

  initTreasuryConfig: (trustId: string, gateway: string, adminRoleId: string) =>
    request<{ ok: boolean; code?: string; error?: string }>(
      `/trusts/${encodeURIComponent(trustId)}/treasury/config`,
      {
        method: "POST",
        body: JSON.stringify({ inference_gateway: gateway, admin_role_id: adminRoleId }),
      },
    ),
};

// ── Budget primitive types — match the orchestrator's Rust serde shapes
//    in `aeqi-orchestrator/src/budget_registry.rs`.

export type BudgetKind = "primary" | "operating" | "hiring" | "project" | "discretionary";

export interface AllowanceBundle {
  inference_credits: number;
  treasury_cap: number;
  suballoc_cap: number;
  hire_cap: number;
}

export interface Budget {
  id: string;
  trust_id: string;
  parent_budget_id: string | null;
  owner_role_id: string;
  name: string;
  kind: BudgetKind;
  is_primary: boolean;
  created_by_role_id: string | null;
  created_at: string;
}

export interface BudgetAllowance {
  budget_id: string;
  epoch: number;
  caps: AllowanceBundle;
  spent_inference: number;
  spent_treasury: number;
  spent_suballoc: number;
  used_hire: number;
  last_event_at: string;
}

export interface BudgetPolicy {
  budget_id: string;
  defaults: AllowanceBundle;
  epoch_period_secs: number;
  rollover_mode: "burn" | "rollover";
  set_by_role_id: string | null;
  updated_at: string;
}

export interface TreasuryEvent {
  id: number;
  event_type: string;
  budget_id: string;
  acting_role_id: string;
  actor_agent_id: string | null;
  counter_budget_id: string | null;
  epoch: number;
  amount: number | null;
  request_hash: string | null;
  idempotency_key: string | null;
  created_at: string;
}

/// One row of the inbox query — see `crates/aeqi-orchestrator/src/ipc/inbox.rs`.
///
/// 2026-05-07: the inbox returns every session in the user's scope, not
/// just decision-requests. `awaiting_at` is `string` when the session is
/// waiting on a human reply, `null` otherwise — drives the awaiting-dot
/// indicator only, no longer used for filtering. `last_active` is the
/// recency anchor used for sort.
///
/// `agent_name` and `trust_id` are joined server-side; `last_agent_message`
/// is the truncated assistant message body.
export interface InboxItem {
  session_id: string;
  agent_id: string | null;
  agent_name: string | null;
  trust_id: string | null;
  session_name: string;
  awaiting_subject: string | null;
  awaiting_at: string | null;
  last_agent_message: string | null;
  last_active: string;
}

export { ApiError };
